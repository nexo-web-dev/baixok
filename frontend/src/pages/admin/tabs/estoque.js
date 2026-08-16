/* Estoque: produtos do cardapio e insumos internos.
 *
 * Produto continua ligado ao cardapio: zerou, sai do ar. Insumo e controle de
 * operacao: queijo, bebida, embalagem, caixa, descartavel e compras internas. */
import { el, render, $, delegar } from "../../../utils/dom.js";
import { apiProdutos, apiInsumos } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";
import { controlaEstoqueCategoria } from "../../../utils/estoque.js";
import { dataHora } from "../../../utils/formato.js";

let insumoEmEdicao = null;

const numero = valor => {
  const n = Number(String(valor ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

const quantidade = valor => new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: Number.isInteger(Number(valor)) ? 0 : 1,
  maximumFractionDigits: 3
}).format(Number(valor || 0));

function cartaoProduto(produto) {
  const estoqueAtual = Number(produto.stock || 0);
  const estoqueMinimo = Number(produto.minStock || 0);
  const critico = estoqueAtual <= estoqueMinimo;

  return el("article.stock-card.beverage-stock", { class: critico ? "low" : "", dataset: { id: produto.id } },
    el("strong", {}, produto.name),
    critico ? el("span.stock-alert", {}, "ALERTA DE ESTOQUE") : null,
    el("span.stock-value", { class: critico ? "danger-text" : "" }, String(estoqueAtual)),
    el("div.counter", {},
      el("button", { type: "button", dataset: { acao: "estoque", id: produto.id, delta: "-1" }, "aria-label": `Tirar uma unidade de ${produto.name}` }, "-"),
      el("input", {
        type: "number", min: "0", value: String(produto.stock),
        dataset: { acao: "estoque-direto", id: produto.id },
        "aria-label": `Estoque de ${produto.name}`
      }),
      el("button", { type: "button", dataset: { acao: "estoque", id: produto.id, delta: "1" }, "aria-label": `Adicionar uma unidade de ${produto.name}` }, "+")
    ),
    el("div.stock-min-row", {},
      el("span.small", {}, "mínimo"),
      el("input.stock-min-input", {
        type: "number", min: "0", value: String(estoqueMinimo),
        dataset: { acao: "estoque-minimo-direto", id: produto.id },
        "aria-label": `Estoque mínimo de ${produto.name}`
      })
    ),
    produto.updatedAt ? el("span.small.faint", {}, `última alteração: ${dataHora(produto.updatedAt)}`) : null,
    !produto.active ? el("span.small.faint", {}, "pausado no cardápio") : null
  );
}

function cartaoInsumo(insumo) {
  const qtdAtual = Number(insumo.qty || 0);
  const qtdMinima = Number(insumo.minQty || 0);
  const critico = qtdAtual <= qtdMinima;

  return el("article.stock-card.insumo-card", { class: critico ? "low" : "", dataset: { id: String(insumo.id) } },
    el("div.stock-headline", {},
      el("strong", {}, insumo.name),
      el("span.pill", { class: insumo.active ? "is-active" : "is-paused" }, insumo.active ? "Ativo" : "Pausado")
    ),
    critico ? el("span.stock-alert", {}, "ALERTA DE INSUMO") : null,
    el("span.small", {}, `${insumo.category || "Geral"} | ${insumo.unit || "un"}`),
    el("span.stock-value", { class: critico ? "danger-text" : "" }, `${quantidade(qtdAtual)} ${insumo.unit || ""}`.trim()),
    el("span.small", {}, `minimo ${quantidade(qtdMinima)} ${insumo.unit || ""}`.trim()),
    el("div.counter", {},
      el("button", { type: "button", dataset: { acao: "insumo-estoque", id: String(insumo.id), delta: "-1" }, "aria-label": `Tirar uma unidade de ${insumo.name}` }, "-"),
      el("input", {
        type: "number", min: "0", step: "0.001", value: String(insumo.qty),
        dataset: { acao: "insumo-direto", id: String(insumo.id) },
        "aria-label": `Estoque de ${insumo.name}`
      }),
      el("button", { type: "button", dataset: { acao: "insumo-estoque", id: String(insumo.id), delta: "1" }, "aria-label": `Adicionar uma unidade de ${insumo.name}` }, "+")
    ),
    el("div.row-actions", { class: "left" },
      el("button.ghost.small", { type: "button", dataset: { acao: "editar-insumo", id: String(insumo.id) } }, "Editar"),
      el("button.danger.small", { type: "button", dataset: { acao: "remover-insumo", id: String(insumo.id) } }, "Excluir")
    )
  );
}

/* Rotulo fixo em cima do campo — o placeholder some assim que a pessoa
 * digita, e ai nao da mais pra saber qual campo e qual so de olhar. */
function campoRotulado(rotulo, input) {
  return el("label.field-col", {}, el("span.field-label", {}, rotulo), input);
}

function formularioInsumo() {
  const insumo = insumoEmEdicao || {};

  return el("form.insumo-form", { id: "insumo-form" },
    el("div.form-title-row", {},
      el("div", {},
        el("h2", {}, insumoEmEdicao ? "Editar insumo" : "Novo insumo"),
        el("p.small.faint", {}, "Ingredientes, bebidas, embalagens, descartaveis e compras internas.")
      ),
      insumoEmEdicao ? el("button.secondary.small", { type: "button", dataset: { acao: "novo-insumo" } }, "Novo") : null
    ),
    campoRotulado("Nome", el("input", { id: "insumo-name", required: true, maxlength: 80, placeholder: "Nome do insumo", value: insumo.name || "" })),
    el("div.field-row", {},
      campoRotulado("Categoria", el("input", { id: "insumo-category", maxlength: 60, placeholder: "Bebidas, Embalagens...", value: insumo.category || "" })),
      campoRotulado("Unidade", el("input", { id: "insumo-unit", maxlength: 20, placeholder: "un, kg, L", value: insumo.unit || "" }))
    ),
    el("div.field-row", {},
      campoRotulado("Quantidade atual", el("input", { id: "insumo-qty", type: "number", min: "0", step: "0.001", required: true, placeholder: "0", value: insumo.qty ?? "" })),
      campoRotulado("Mínimo de alerta", el("input", { id: "insumo-min", type: "number", min: "0", step: "0.001", required: true, placeholder: "0", value: insumo.minQty ?? "" }))
    ),
    el("label.check-field", {},
      el("input", { id: "insumo-active", type: "checkbox", checked: insumo.active ?? true }),
      "Ativo no controle"
    ),
    el("p.form-error.hidden", { id: "insumo-error", role: "alert" }),
    el("button.primary.wide", { type: "submit" }, insumoEmEdicao ? "Salvar insumo" : "Cadastrar insumo")
  );
}

export function desenharEstoque() {
  const alvo = $("#stock-grid");
  if (!alvo) return;

  const produtos = [...estado.produtos]
    .filter(produto => controlaEstoqueCategoria(produto.category))
    .sort((a, b) => (a.stock - a.minStock) - (b.stock - b.minStock));
  const insumos = [...(estado.insumos || [])].sort((a, b) =>
    (a.qty - a.minQty) - (b.qty - b.minQty));

  render(alvo,
    el("section.stock-section", {},
      el("div.section-head", { class: "compact" },
        el("div", {},
          el("h2", {}, "Bebidas do cardápio"),
          el("p", {}, "Controle refrigerante, drink e outras bebidas. Comida fica no cardápio enquanto estiver ativa; para tirar do ar, use Pausar em Produtos.")
        )
      ),
      el("div.stock-cards", {}, produtos.length
        ? produtos.map(cartaoProduto)
        : el("p.faint.pad", {}, "Nenhuma bebida cadastrada no cardápio."))
    ),
    el("section.stock-section", {},
      el("div.section-head", { class: "compact" },
        el("div", {},
          el("h2", {}, "Insumos da operacao"),
          el("p", {}, "Controle ingredientes, descartaveis, embalagens e compras internas.")
        )
      ),
      el("div.insumo-layout", {},
        formularioInsumo(),
        el("div.stock-cards", {}, insumos.length
          ? insumos.map(cartaoInsumo)
          : el("p.faint.pad", {}, "Nenhum insumo cadastrado."))
      )
    )
  );
}

async function ajustar(id, corpo) {
  try {
    await apiProdutos.ajustarEstoque(id, corpo);
    await carregar("produtos");
    desenharEstoque();
  } catch (erro) {
    toastFalha(erro);
    await carregar("produtos");
    desenharEstoque();
  }
}

async function ajustarInsumo(id, corpo) {
  try {
    await apiInsumos.ajustarEstoque(id, corpo);
    await carregar("insumos");
    desenharEstoque();
  } catch (erro) {
    toastFalha(erro);
    await carregar("insumos");
    desenharEstoque();
  }
}

async function salvarInsumo() {
  const erro = $("#insumo-error");
  const dados = {
    name: $("#insumo-name")?.value.trim() || "",
    category: $("#insumo-category")?.value.trim() || "Geral",
    unit: $("#insumo-unit")?.value.trim() || "un",
    qty: numero($("#insumo-qty")?.value),
    minQty: numero($("#insumo-min")?.value),
    active: $("#insumo-active")?.checked ?? true
  };

  try {
    if (insumoEmEdicao) await apiInsumos.atualizar(insumoEmEdicao.id, dados);
    else await apiInsumos.criar(dados);
    insumoEmEdicao = null;
    erro?.classList.add("hidden");
    await carregar("insumos");
    desenharEstoque();
    toast("Insumo salvo.");
  } catch (falha) {
    if (erro) {
      erro.textContent = falha.message;
      erro.classList.remove("hidden");
    } else {
      toastFalha(falha);
    }
  }
}

export function ligarEstoque() {
  const alvo = $("#stock-grid");
  if (!alvo) return;

  delegar(alvo, "click", "[data-acao='estoque']", (_e, botao) =>
    ajustar(botao.dataset.id, { delta: Number(botao.dataset.delta) }));
  delegar(alvo, "click", "[data-acao='insumo-estoque']", (_e, botao) =>
    ajustarInsumo(botao.dataset.id, { delta: Number(botao.dataset.delta) }));

  delegar(alvo, "change", "[data-acao='estoque-direto']", (_e, campo) => {
    const valor = Math.max(0, Math.floor(Number(campo.value) || 0));
    ajustar(campo.dataset.id, { valor });
  });
  delegar(alvo, "change", "[data-acao='estoque-minimo-direto']", (_e, campo) => {
    const minStock = Math.max(0, Math.floor(Number(campo.value) || 0));
    ajustar(campo.dataset.id, { minStock });
  });
  delegar(alvo, "change", "[data-acao='insumo-direto']", (_e, campo) => {
    ajustarInsumo(campo.dataset.id, { valor: numero(campo.value) });
  });
  delegar(alvo, "submit", "#insumo-form", evento => {
    evento.preventDefault();
    salvarInsumo();
  });
  delegar(alvo, "click", "[data-acao='editar-insumo']", (_e, botao) => {
    insumoEmEdicao = estado.insumos.find(item => String(item.id) === botao.dataset.id) || null;
    desenharEstoque();
    $("#insumo-name")?.focus();
  });
  delegar(alvo, "click", "[data-acao='novo-insumo']", () => {
    insumoEmEdicao = null;
    desenharEstoque();
  });
  delegar(alvo, "click", "[data-acao='remover-insumo']", async (_e, botao) => {
    const insumo = estado.insumos.find(item => String(item.id) === botao.dataset.id);
    if (!confirm(`Excluir insumo ${insumo?.name || ""}?`)) return;
    try {
      await apiInsumos.remover(botao.dataset.id);
      if (String(insumoEmEdicao?.id) === botao.dataset.id) insumoEmEdicao = null;
      await carregar("insumos");
      desenharEstoque();
      toast("Insumo removido.");
    } catch (erro) {
      toastFalha(erro);
    }
  });
}
