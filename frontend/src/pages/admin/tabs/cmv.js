/* CMV: uma linha por produto, com a ficha tecnica (insumo + quantidade) ja
 * pronta pra preencher e o custo calculado na hora, sem precisar abrir o
 * cadastro do produto. O custo por unidade de cada insumo vem de Estoque
 * (preco pago no pacote / quanto ele rende) — aqui so se escolhe o insumo e
 * quanto uma porcao consome. */
import { el, render, $, delegar } from "../../../utils/dom.js";
import { reais } from "../../../utils/formato.js";
import { rotuloCategoria } from "../../../utils/categorias.js";
import { apiProdutos } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";

let busca = "";
/* Rascunho local por produto — so vira gravado quando a pessoa clica em
 * Salvar naquela linha, senao cada tecla chamaria a API. */
const rascunhos = new Map();

const normalizar = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

function rascunhoDe(produto) {
  if (!rascunhos.has(produto.id)) {
    rascunhos.set(produto.id, (produto.recipe || []).map(item => ({ insumoId: item.insumoId, qty: item.qty })));
  }
  return rascunhos.get(produto.id);
}

function opcoesInsumo(selecionado) {
  return [
    el("option", { value: "" }, "Insumo..."),
    ...(estado.insumos || [])
      .filter(insumo => insumo.active)
      .map(insumo => el("option", {
        value: String(insumo.id), selected: String(insumo.id) === String(selecionado)
      }, `${insumo.name} (${insumo.unit || "un"})`))
  ];
}

function custoDaLinha(item) {
  const insumo = (estado.insumos || []).find(i => String(i.id) === String(item?.insumoId));
  return insumo?.unitCost ? insumo.unitCost * Number(item.qty || 0) : 0;
}

function custoTotalDe(itens) {
  return itens.reduce((total, item) => total + custoDaLinha(item), 0);
}

function linhaReceita(produtoId, item, indice) {
  return el("div.recipe-row", {},
    el("select", { dataset: { acao: "cmv-insumo", produto: produtoId, indice: String(indice) } }, ...opcoesInsumo(item.insumoId)),
    el("input", {
      type: "number", min: "0", step: "0.001", placeholder: "Qtd",
      value: item.qty ?? "", dataset: { acao: "cmv-qty", produto: produtoId, indice: String(indice) }
    }),
    el("span.small.faint.cmv-linha-custo", {}, custoDaLinha(item) > 0 ? reais(custoDaLinha(item)) : ""),
    el("button.split-row-remove", {
      type: "button", title: "Remover", dataset: { acao: "cmv-remover-linha", produto: produtoId, indice: String(indice) }
    }, "×")
  );
}

function linhaProduto(produto) {
  const itens = rascunhoDe(produto);
  const custoTotal = custoTotalDe(itens);
  const cmvPct = produto.price > 0 ? (custoTotal / produto.price) * 100 : 0;

  return el("article.cmv-row", { dataset: { id: produto.id } },
    el("div.cmv-row-head", {},
      el("div", {},
        el("strong", {}, produto.name),
        el("span.small.faint", {}, rotuloCategoria(produto.category))
      ),
      el("span.price", {}, reais(produto.price)),
      el("span.pill.cmv-pill", {}, custoTotal > 0 ? `CMV ${cmvPct.toFixed(1)}%` : "sem custo")
    ),
    el("div.recipe-rows", {}, itens.map((item, indice) => linhaReceita(produto.id, item, indice))),
    el("div.recipe-actions", {},
      el("button.secondary.small", { type: "button", dataset: { acao: "cmv-adicionar-linha", produto: produto.id } }, "+ insumo"),
      el("span.money-text.cmv-custo-total", {}, custoTotal > 0 ? `Custo estimado: ${reais(custoTotal)}` : ""),
      el("button.primary.small", { type: "button", dataset: { acao: "cmv-salvar", produto: produto.id } }, "Salvar")
    )
  );
}

function produtosFiltrados() {
  const termo = normalizar(busca);
  return [...estado.produtos]
    .filter(produto => !termo || normalizar(`${produto.name} ${produto.category || ""}`).includes(termo))
    .sort((a, b) =>
      String(a.category || "").localeCompare(String(b.category || "")) || a.name.localeCompare(b.name));
}

export function desenharCmv() {
  const alvo = $("#cmv-table");
  if (!alvo) return;
  const produtos = produtosFiltrados();
  render(alvo, produtos.length
    ? produtos.map(linhaProduto)
    : el("p.faint.pad", {}, "Nenhum produto encontrado."));
}

/* So atualiza os numeros da linha (nao redesenha o input) — senao a pessoa
 * perderia o foco a cada digito na quantidade. */
function atualizarTotaisLinha(produtoId) {
  const linha = document.querySelector(`.cmv-row[data-id="${CSS.escape(produtoId)}"]`);
  if (!linha) return;
  const produto = estado.produtos.find(item => item.id === produtoId);
  const itens = rascunhos.get(produtoId) || [];

  linha.querySelectorAll(".recipe-row").forEach((linhaDom, indice) => {
    const span = linhaDom.querySelector(".cmv-linha-custo");
    const custo = custoDaLinha(itens[indice]);
    if (span) span.textContent = custo > 0 ? reais(custo) : "";
  });

  const custoTotal = custoTotalDe(itens);
  const cmvPct = produto?.price > 0 ? (custoTotal / produto.price) * 100 : 0;
  const pill = linha.querySelector(".cmv-pill");
  if (pill) pill.textContent = custoTotal > 0 ? `CMV ${cmvPct.toFixed(1)}%` : "sem custo";
  const totalSpan = linha.querySelector(".cmv-custo-total");
  if (totalSpan) totalSpan.textContent = custoTotal > 0 ? `Custo estimado: ${reais(custoTotal)}` : "";
}

async function salvarLinha(produtoId, botao) {
  const itens = (rascunhos.get(produtoId) || [])
    .filter(item => item.insumoId && Number(item.qty) > 0)
    .map(item => ({ insumoId: Number(item.insumoId), qty: Number(item.qty) }));

  botao.disabled = true;
  try {
    await apiProdutos.definirFichaTecnica(produtoId, itens);
    await carregar("produtos");
    rascunhos.delete(produtoId);
    desenharCmv();
    toast("Ficha técnica salva.");
  } catch (erro) {
    toastFalha(erro, "CMV");
  } finally {
    botao.disabled = false;
  }
}

export function ligarCmv() {
  const alvo = $("#cmv-table");
  if (!alvo) return;

  $("#cmv-search")?.addEventListener("input", evento => {
    busca = evento.target.value;
    desenharCmv();
  });

  delegar(alvo, "click", "[data-acao='cmv-adicionar-linha']", (_e, botao) => {
    const itens = rascunhos.get(botao.dataset.produto) || [];
    itens.push({ insumoId: "", qty: "" });
    rascunhos.set(botao.dataset.produto, itens);
    desenharCmv();
  });

  delegar(alvo, "click", "[data-acao='cmv-remover-linha']", (_e, botao) => {
    const itens = rascunhos.get(botao.dataset.produto);
    if (itens) itens.splice(Number(botao.dataset.indice), 1);
    desenharCmv();
  });

  delegar(alvo, "change", "[data-acao='cmv-insumo']", (_e, campo) => {
    const item = rascunhos.get(campo.dataset.produto)?.[Number(campo.dataset.indice)];
    if (item) item.insumoId = campo.value;
    atualizarTotaisLinha(campo.dataset.produto);
  });

  delegar(alvo, "input", "[data-acao='cmv-qty']", (_e, campo) => {
    const item = rascunhos.get(campo.dataset.produto)?.[Number(campo.dataset.indice)];
    if (item) item.qty = campo.value;
    atualizarTotaisLinha(campo.dataset.produto);
  });

  delegar(alvo, "click", "[data-acao='cmv-salvar']", (_e, botao) => salvarLinha(botao.dataset.produto, botao));
}
