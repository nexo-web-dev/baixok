/* Pizza de 2 sabores e combos.
 *
 * As duas coisas moram na mesma aba porque sao a mesma ideia por baixo: um
 * item vendido por um preco fechado, composto de produtos que ja existem no
 * cardapio. A combinacao de sabores e sempre digitada pelo lojista — sem
 * preco configurado para o par, ele simplesmente nao aparece como opcao para
 * o cliente (nada de media ou "sabor mais caro" calculado sozinho). */
import { el, render, $, delegar, mostrar } from "../../../utils/dom.js";
import { reais, paraNumero } from "../../../utils/formato.js";
import { rotuloCategoria } from "../../../utils/categorias.js";
import { apiCombos, apiCombinacoesSabores } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";

const rascunhoCombo = { id: null, itens: [] };

function erroDoFormulario(id, mensagem) {
  const alvo = $(`#${id}`);
  if (!alvo) return;
  alvo.textContent = mensagem || "";
  mostrar(alvo, Boolean(mensagem));
}

function produtoPorId(id) {
  return estado.produtos.find(produto => produto.id === id);
}

function fotoProduto(produto, classe = "") {
  if (!produto?.image) return el("div.combo-product-thumb.no-photo", { class: classe }, "Sem foto");
  return el("span.combo-product-thumb.fit-media", { class: classe },
    el("img.fit-media-bg", {
      src: produto.image,
      alt: "",
      loading: "lazy",
      decoding: "async",
      "aria-hidden": "true"
    }),
    el("img.fit-media-main", {
      src: produto.image,
      alt: produto.name || "Produto",
      loading: "lazy",
      decoding: "async",
      onerror: evento => evento.target.closest(".fit-media")?.replaceWith(el("div.combo-product-thumb.no-photo", { class: classe }, "Sem foto"))
    })
  );
}

function cardProdutoCombo(produto, rotuloVazio = "Escolha um produto") {
  return el("div.combo-product-preview", { class: produto ? "" : "empty" },
    fotoProduto(produto),
    el("div.combo-product-info", {},
      el("strong", {}, produto?.name || rotuloVazio),
      el("span", {}, produto
        ? `${rotuloCategoria(produto.category)} · ${reais(produto.price)}`
        : "A foto cadastrada aparece aqui para conferir antes de salvar.")
    )
  );
}

function desenharPreviewSelectProduto(selectId, previewId, rotuloVazio) {
  const select = $(`#${selectId}`);
  if (!select) return;
  let alvo = $(`#${previewId}`);
  if (!alvo) {
    alvo = el("div", { id: previewId });
    select.closest(".field-row")?.insertAdjacentElement("afterend", alvo);
  }
  render(alvo, cardProdutoCombo(produtoPorId(select.value), rotuloVazio));
}

function desenharPreviewsCombos() {
  desenharPreviewSelectProduto("sabor-combo-a", "sabor-combo-a-preview", "Primeiro sabor");
  desenharPreviewSelectProduto("sabor-combo-b", "sabor-combo-b-preview", "Segundo sabor");
  desenharPreviewSelectProduto("combo-item-product", "combo-item-product-preview", "Produto do combo");
}

// ------------------------------------------------------ combinacoes de sabores ---
function produtosSaborPizza() {
  return estado.produtos.filter(produto => produto.saborPizza);
}

function linhaSaborCombo(combinacao) {
  const produtoA = produtoPorId(combinacao.produtoAId);
  const produtoB = produtoPorId(combinacao.produtoBId);
  return el("div.promo-row", {},
    el("div.combo-mini-pair", {},
      fotoProduto(produtoA, "mini"),
      fotoProduto(produtoB, "mini")
    ),
    el("div", {},
      el("strong", {}, `${combinacao.nomeA} + ${combinacao.nomeB}`),
      el("span", {}, reais(combinacao.preco))
    ),
    el("button.ghost.small", {
      type: "button",
      dataset: {
        acao: "editar-sabor-combo",
        a: combinacao.produtoAId, b: combinacao.produtoBId, preco: String(combinacao.preco)
      }
    }, "Editar"),
    el("button.danger.small", {
      type: "button",
      dataset: { acao: "remover-sabor-combo", a: combinacao.produtoAId, b: combinacao.produtoBId }
    }, "Remover")
  );
}

function desenharSelectsSabor() {
  const sabores = produtosSaborPizza();
  for (const id of ["sabor-combo-a", "sabor-combo-b"]) {
    const select = $(`#${id}`);
    if (!select) continue;
    const escolhido = select.value;
    render(select,
      el("option", { value: "" }, sabores.length ? "Escolha o sabor" : "Nenhum produto marcado como sabor de pizza"),
      ...sabores.map(produto => el("option", { value: produto.id }, produto.name))
    );
    if (escolhido) select.value = escolhido;
  }
  desenharPreviewsCombos();
}

function desenharCombinacoesSabores() {
  const alvo = $("#sabor-combo-list");
  if (!alvo) return;
  render(alvo, estado.combinacoesSabores.length
    ? estado.combinacoesSabores.map(linhaSaborCombo)
    : el("p.faint", {}, "Nenhuma combinação configurada ainda."));
  desenharSelectsSabor();
}

// ---------------------------------------------------------------------- combos ---
function resumoItensCombo(itens) {
  return itens.map(item => `${item.quantity}x ${item.name}`).join(", ");
}

function linhaCombo(combo) {
  return el("div.promo-row", { class: combo.active ? "" : "muted" },
    el("div", {},
      el("strong", {}, combo.name),
      el("span", {}, `${reais(combo.price)} · ${resumoItensCombo(combo.items) || "sem itens"}`)
    ),
    el("button.ghost.small", { type: "button", dataset: { acao: "editar-combo", id: combo.id } }, "Editar"),
    el("button.ghost.small", { type: "button", dataset: { acao: "alternar-combo", id: combo.id } },
      combo.active ? "Pausar" : "Ativar"),
    el("button.danger.small", { type: "button", dataset: { acao: "remover-combo", id: combo.id } }, "Excluir")
  );
}

function desenharListaCombos() {
  const alvo = $("#combo-list");
  if (!alvo) return;
  render(alvo, estado.combos.length
    ? estado.combos.map(linhaCombo)
    : el("p.faint", {}, "Nenhum combo cadastrado."));
}

function desenharSelectItemCombo() {
  const select = $("#combo-item-product");
  if (!select) return;
  const escolhido = select.value;
  render(select, ...estado.produtos.map(produto => el("option", { value: produto.id }, produto.name)));
  if (escolhido) select.value = escolhido;
}

function chipItemCombo(item, indice) {
  return el("span.chip", {},
    `${item.quantity}x ${item.name}`,
    el("button", { type: "button", "aria-label": `Remover ${item.name}`, dataset: { acao: "remover-item-combo", indice: String(indice) } }, "×")
  );
}

function desenharItensCombo() {
  const alvo = $("#combo-items-list");
  if (!alvo) return;
  render(alvo, rascunhoCombo.itens.length
    ? rascunhoCombo.itens.map(chipItemCombo)
    : el("span.faint.small", {}, "Nenhum produto adicionado ainda."));
}

function limparFormularioCombo() {
  rascunhoCombo.id = null;
  rascunhoCombo.itens = [];
  $("#combo-name").value = "";
  $("#combo-description").value = "";
  $("#combo-price").value = "";
  $("#combo-image").value = "";
  $("#combo-active").checked = true;
  $("#combo-item-qty").value = "1";
  $("#combo-form-title").textContent = "Novo combo";
  $("#save-combo").textContent = "Cadastrar combo";
  erroDoFormulario("combo-error", "");
  desenharItensCombo();
}

function editarCombo(id) {
  const combo = estado.combos.find(item => item.id === id);
  if (!combo) return;
  rascunhoCombo.id = combo.id;
  rascunhoCombo.itens = combo.items.map(item => ({ productId: item.productId, name: item.name, quantity: item.quantity }));
  $("#combo-name").value = combo.name;
  $("#combo-description").value = combo.description || "";
  $("#combo-price").value = String(combo.price);
  $("#combo-image").value = combo.image || "";
  $("#combo-active").checked = combo.active;
  $("#combo-form-title").textContent = `Editando: ${combo.name}`;
  $("#save-combo").textContent = "Salvar alterações";
  erroDoFormulario("combo-error", "");
  desenharItensCombo();
  $("#combo-name").focus();
}

export function desenharCombos() {
  desenharCombinacoesSabores();
  desenharListaCombos();
  desenharSelectItemCombo();
  desenharItensCombo();
}

export function ligarCombos() {
  $("#save-sabor-combo")?.addEventListener("click", async () => {
    erroDoFormulario("sabor-combo-error", "");
    const produtoAId = $("#sabor-combo-a").value;
    const produtoBId = $("#sabor-combo-b").value;
    const preco = paraNumero($("#sabor-combo-preco").value);

    if (!produtoAId || !produtoBId) return erroDoFormulario("sabor-combo-error", "Escolha os dois sabores.");
    if (produtoAId === produtoBId) return erroDoFormulario("sabor-combo-error", "Escolha dois sabores diferentes.");
    if (preco <= 0) return erroDoFormulario("sabor-combo-error", "Informe o preço da combinação.");

    try {
      await apiCombinacoesSabores.salvar({ produtoAId, produtoBId, preco });
      await carregar("combinacoesSabores");
      desenharCombinacoesSabores();
      $("#sabor-combo-preco").value = "";
      const titulo = $("#sabor-combo-form-title");
      if (titulo) titulo.textContent = "Nova combinação";
      toast("Combinação salva.");
    } catch (erro) {
      erroDoFormulario("sabor-combo-error", erro.message);
    }
  });

  delegar($("#sabor-combo-list"), "click", "[data-acao='editar-sabor-combo']", (_e, botao) => {
    erroDoFormulario("sabor-combo-error", "");
    $("#sabor-combo-a").value = botao.dataset.a;
    $("#sabor-combo-b").value = botao.dataset.b;
    $("#sabor-combo-preco").value = botao.dataset.preco;
    const titulo = $("#sabor-combo-form-title");
    if (titulo) titulo.textContent = "Editando combinação";
    $("#sabor-combo-a").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  delegar($("#sabor-combo-list"), "click", "[data-acao='remover-sabor-combo']", async (_e, botao) => {
    if (!confirm("Remover essa combinação de sabores?")) return;
    try {
      await apiCombinacoesSabores.remover(botao.dataset.a, botao.dataset.b);
      await carregar("combinacoesSabores");
      desenharCombinacoesSabores();
      toast("Combinação removida.");
    } catch (erro) { toastFalha(erro); }
  });

  $("#combo-item-add")?.addEventListener("click", () => {
    const productId = $("#combo-item-product").value;
    const produto = estado.produtos.find(item => item.id === productId);
    if (!produto) return;
    const quantity = Math.max(1, Math.floor(paraNumero($("#combo-item-qty").value) || 1));
    const existente = rascunhoCombo.itens.find(item => item.productId === productId);
    if (existente) existente.quantity += quantity;
    else rascunhoCombo.itens.push({ productId, name: produto.name, quantity });
    $("#combo-item-qty").value = "1";
    desenharItensCombo();
  });

  delegar($("#combo-items-list"), "click", "[data-acao='remover-item-combo']", (_e, botao) => {
    rascunhoCombo.itens.splice(Number(botao.dataset.indice), 1);
    desenharItensCombo();
  });

  $("#save-combo")?.addEventListener("click", async () => {
    erroDoFormulario("combo-error", "");
    const corpo = {
      name: $("#combo-name").value.trim(),
      description: $("#combo-description").value.trim(),
      price: paraNumero($("#combo-price").value),
      image: $("#combo-image").value.trim(),
      active: $("#combo-active").checked,
      items: rascunhoCombo.itens.map(item => ({ productId: item.productId, quantity: item.quantity }))
    };
    if (!corpo.name) return erroDoFormulario("combo-error", "Dê um nome ao combo.");
    if (corpo.price <= 0) return erroDoFormulario("combo-error", "Informe o preço do combo.");
    if (!corpo.items.length) return erroDoFormulario("combo-error", "Adicione ao menos um produto ao combo.");

    try {
      if (rascunhoCombo.id) await apiCombos.atualizar(rascunhoCombo.id, corpo);
      else await apiCombos.criar(corpo);
      await carregar("combos");
      desenharListaCombos();
      limparFormularioCombo();
      toast("Combo salvo.");
    } catch (erro) {
      erroDoFormulario("combo-error", erro.message);
    }
  });

  $("#combo-reset")?.addEventListener("click", limparFormularioCombo);

  delegar($("#combo-list"), "click", "[data-acao='editar-combo']", (_e, botao) => editarCombo(botao.dataset.id));

  delegar($("#combo-list"), "click", "[data-acao='alternar-combo']", async (_e, botao) => {
    try {
      await apiCombos.alternarAtivo(botao.dataset.id);
      await carregar("combos");
      desenharListaCombos();
    } catch (erro) { toastFalha(erro); }
  });

  delegar($("#combo-list"), "click", "[data-acao='remover-combo']", async (_e, botao) => {
    const combo = estado.combos.find(item => item.id === botao.dataset.id);
    if (!confirm(`Excluir o combo "${combo?.name}"?`)) return;
    try {
      await apiCombos.remover(botao.dataset.id);
      await carregar("combos");
      desenharListaCombos();
      toast("Combo excluído.");
    } catch (erro) { toastFalha(erro); }
  });
}
