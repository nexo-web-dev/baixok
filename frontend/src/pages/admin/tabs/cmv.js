/* CMV: uma linha por produto do cardápio, agrupado por categoria.
 *
 * Sem catálogo de insumo pra escolher — direto no produto: quantas gramas vai
 * numa porção vendida, quanto pesa o saco/pacote comprado e quanto custou. O
 * resto (rendimento, faturamento possível, custo da porção, CMV%) sai sozinho,
 * com o mesmo cálculo de "custo do saco / peso do saco * porção". */
import { el, render, $, delegar } from "../../../utils/dom.js";
import { reais } from "../../../utils/formato.js";
import { rotuloCategoria } from "../../../utils/categorias.js";
import { apiProdutos } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";

let busca = "";
/* Rascunho local por produto (porcao em g, saco em kg pra digitar do jeito
 * que a pessoa compra, custo em R$) — so vira gravado ao clicar Salvar. */
const rascunhos = new Map();

const normalizar = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

function rascunhoDe(produto) {
  if (!rascunhos.has(produto.id)) {
    rascunhos.set(produto.id, {
      portionG: produto.cmvPortionG || "",
      packageWeightKg: produto.cmvPackageWeightG ? produto.cmvPackageWeightG / 1000 : "",
      packageCost: produto.cmvPackageCost || ""
    });
  }
  return rascunhos.get(produto.id);
}

/* Mesma conta em cima do rascunho (ainda nao salvo) pra mostrar o resultado
 * na hora, sem precisar clicar em Salvar so pra ver quanto vai dar. */
function calcular(rascunho, price) {
  const portionG = Number(rascunho.portionG) || 0;
  const packageWeightG = (Number(rascunho.packageWeightKg) || 0) * 1000;
  const packageCost = Number(rascunho.packageCost) || 0;

  const rendimento = portionG > 0 ? packageWeightG / portionG : 0;
  const custoPorcao = rendimento > 0 ? packageCost / rendimento : 0;
  return {
    rendimento,
    faturamento: rendimento * price,
    custoPorcao,
    cmvPct: price > 0 ? (custoPorcao / price) * 100 : 0
  };
}

function textosResultado(resultado) {
  if (!(resultado.rendimento > 0)) {
    return { pill: "sem cálculo", linhas: [] };
  }
  return {
    pill: `CMV ${resultado.cmvPct.toFixed(1)}%`,
    linhas: [
      `Rende ${resultado.rendimento % 1 === 0 ? resultado.rendimento : resultado.rendimento.toFixed(1)} porções`,
      `Faturamento possível: ${reais(resultado.faturamento)}`,
      `Custo da porção: ${reais(resultado.custoPorcao)}`
    ]
  };
}

function atualizarLinha(produtoId) {
  const linha = document.querySelector(`.cmv-row[data-id="${CSS.escape(produtoId)}"]`);
  const produto = estado.produtos.find(item => item.id === produtoId);
  const rascunho = rascunhos.get(produtoId);
  if (!linha || !produto || !rascunho) return;

  const resultado = calcular(rascunho, produto.price);
  const { pill, linhas } = textosResultado(resultado);
  const pillEl = linha.querySelector(".cmv-pill");
  if (pillEl) pillEl.textContent = pill;
  const resultadoEl = linha.querySelector(".cmv-result-linhas");
  if (resultadoEl) render(resultadoEl, ...linhas.map(texto => el("span", {}, texto)));
}

function linhaProduto(produto) {
  const rascunho = rascunhoDe(produto);
  const resultado = calcular(rascunho, produto.price);
  const { pill, linhas } = textosResultado(resultado);

  return el("article.cmv-row", { dataset: { id: produto.id } },
    el("div.cmv-row-head", {},
      el("div", {},
        el("strong", {}, produto.name),
        el("span.small.faint", {}, rotuloCategoria(produto.category))
      ),
      el("span.price", {}, reais(produto.price)),
      el("span.pill.cmv-pill", {}, pill)
    ),
    el("div.cmv-inputs", {},
      el("label.field-col", {}, el("span.field-label", {}, "Porção vendida (g)"),
        el("input", {
          type: "number", min: "0", step: "1", placeholder: "Ex: 400", value: rascunho.portionG,
          dataset: { acao: "cmv-porcao", produto: produto.id }
        })),
      el("label.field-col", {}, el("span.field-label", {}, "Peso do saco (kg)"),
        el("input", {
          type: "number", min: "0", step: "0.01", placeholder: "Ex: 2", value: rascunho.packageWeightKg,
          dataset: { acao: "cmv-saco-peso", produto: produto.id }
        })),
      el("label.field-col", {}, el("span.field-label", {}, "Custo do saco (R$)"),
        el("input", {
          type: "number", min: "0", step: "0.01", placeholder: "Ex: 20,00", value: rascunho.packageCost,
          dataset: { acao: "cmv-saco-custo", produto: produto.id }
        }))
    ),
    el("div.cmv-result", {},
      el("div.cmv-result-linhas", {}, ...linhas.map(texto => el("span", {}, texto))),
      el("button.primary.small", { type: "button", dataset: { acao: "cmv-salvar", produto: produto.id } }, "Salvar")
    )
  );
}

function produtosFiltrados() {
  const termo = normalizar(busca);
  return estado.produtos.filter(produto =>
    !termo || normalizar(`${produto.name} ${produto.category || ""}`).includes(termo));
}

function produtosAgrupados(produtos) {
  const grupos = new Map();
  for (const produto of produtos) {
    const categoria = String(produto.category || "Sem categoria").trim();
    if (!grupos.has(categoria)) grupos.set(categoria, []);
    grupos.get(categoria).push(produto);
  }
  return [...grupos].sort(([a], [b]) => a.localeCompare(b));
}

export function desenharCmv() {
  const alvo = $("#cmv-table");
  if (!alvo) return;
  const grupos = produtosAgrupados(produtosFiltrados());

  render(alvo, grupos.length
    ? grupos.map(([categoria, produtos]) =>
        el("section.cmv-category-group", {},
          el("h3", {}, rotuloCategoria(categoria)),
          el("div.cmv-category-list", {}, produtos.map(linhaProduto))
        ))
    : el("p.faint.pad", {}, "Nenhum produto encontrado."));
}

async function salvarLinha(produtoId, botao) {
  const rascunho = rascunhos.get(produtoId);
  if (!rascunho) return;

  botao.disabled = true;
  try {
    await apiProdutos.ajustarCmv(produtoId, {
      portionG: Number(rascunho.portionG) || 0,
      packageWeightG: (Number(rascunho.packageWeightKg) || 0) * 1000,
      packageCost: Number(rascunho.packageCost) || 0
    });
    await carregar("produtos");
    desenharCmv();
    toast("CMV salvo.");
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

  delegar(alvo, "input", "[data-acao='cmv-porcao']", (_e, campo) => {
    const rascunho = rascunhos.get(campo.dataset.produto);
    if (rascunho) rascunho.portionG = campo.value;
    atualizarLinha(campo.dataset.produto);
  });
  delegar(alvo, "input", "[data-acao='cmv-saco-peso']", (_e, campo) => {
    const rascunho = rascunhos.get(campo.dataset.produto);
    if (rascunho) rascunho.packageWeightKg = campo.value;
    atualizarLinha(campo.dataset.produto);
  });
  delegar(alvo, "input", "[data-acao='cmv-saco-custo']", (_e, campo) => {
    const rascunho = rascunhos.get(campo.dataset.produto);
    if (rascunho) rascunho.packageCost = campo.value;
    atualizarLinha(campo.dataset.produto);
  });

  delegar(alvo, "click", "[data-acao='cmv-salvar']", (_e, botao) => salvarLinha(botao.dataset.produto, botao));
}
