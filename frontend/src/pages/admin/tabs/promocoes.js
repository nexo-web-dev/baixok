/* Promocoes e cupons.
 *
 * A lista de cupons so existe aqui, e a rota que a alimenta exige papel admin.
 * No sistema antigo ela vinha junto do estado publico e qualquer visitante do
 * cardapio conseguia ler todos os codigos no devtools. */
import { el, render, $, delegar, mostrar } from "../../../utils/dom.js";
import { reais, paraNumero } from "../../../utils/formato.js";
import { rotuloCategoria } from "../../../utils/categorias.js";
import { apiPromocoes, apiCupons } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";

let tipoCupom = "pct";
let usoUnico = false;

function erroDoFormulario(id, mensagem) {
  const alvo = $(`#${id}`);
  if (!alvo) return;
  alvo.textContent = mensagem || "";
  mostrar(alvo, Boolean(mensagem));
}

function produtoPorId(id) {
  return estado.produtos.find(produto => produto.id === id);
}

function preencherSelectProdutos(select) {
  if (!select) return;
  const escolhido = select.value;
  render(select, ...estado.produtos.map(produto =>
    el("option", { value: produto.id }, `${produto.name} - ${reais(produto.price)}`)
  ));
  if (escolhido && estado.produtos.some(produto => produto.id === escolhido)) select.value = escolhido;
  if (!select.value && estado.produtos[0]) select.value = estado.produtos[0].id;
}

// ------------------------------------------------------------- promocoes ---
function fotoProduto(produto) {
  if (!produto?.image) return el("span.promo-product-thumb.no-photo", {}, "Sem foto");
  return el("span.fit-media.promo-product-thumb", {},
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
      onerror: evento => evento.target.closest(".promo-product-thumb")?.replaceWith(el("span.promo-product-thumb.no-photo", {}, "Sem foto"))
    })
  );
}

function produtoPromocaoSelecionado() {
  const id = $("#promo-product")?.value;
  return produtoPorId(id);
}

function garantirPreviewPromocao() {
  const select = $("#promo-product");
  if (!select) return null;

  let alvo = $("#promo-product-preview");
  if (!alvo) {
    alvo = el("div#promo-product-preview.promo-product-preview", { "aria-live": "polite" });
    select.insertAdjacentElement("afterend", alvo);
  }
  return alvo;
}

function desenharPreviewPromocao() {
  const alvo = garantirPreviewPromocao();
  if (!alvo) return;

  const produto = produtoPromocaoSelecionado();
  if (!produto) {
    render(alvo,
      el("span.promo-product-thumb.no-photo", {}, "Sem foto"),
      el("div.promo-product-info", {},
        el("strong", {}, "Escolha um produto"),
        el("span", {}, "A foto cadastrada aparece aqui antes de ativar a promocao.")
      )
    );
    return;
  }

  render(alvo,
    fotoProduto(produto),
    el("div.promo-product-info", {},
      el("strong", {}, produto.name),
      el("span", {}, `${rotuloCategoria(produto.category)} - preco normal ${reais(produto.price)}`),
      el("small", { class: produto.active ? "ok-text" : "danger-text" }, produto.active ? "Ativo no cardapio" : "Pausado no cardapio")
    )
  );
}

function linhaPromocao(promocao) {
  const produto = produtoPorId(promocao.productId);
  const economia = produto ? produto.price - promocao.price : 0;

  return el("div.promo-row", {},
    fotoProduto(produto),
    el("div", {},
      el("strong", {}, produto?.name || "Produto removido"),
      el("span", {}, `${reais(promocao.price)} · economia de ${reais(economia)}${promocao.until ? ` · até ${promocao.until}` : ""}`)
    ),
    el("button.ghost.small", { type: "button", dataset: { acao: "remover-promo", id: promocao.id } }, "Encerrar")
  );
}

function cardProdutoPreview(produto, titulo) {
  return el("div.gift-preview-card", {},
    fotoProduto(produto),
    el("div", {},
      el("span", {}, titulo),
      el("strong", {}, produto?.name || "Escolha um produto"),
      el("small", {}, produto ? `${rotuloCategoria(produto.category)} - ${reais(produto.price)}` : "A foto cadastrada aparece aqui.")
    )
  );
}

function desenharPreviewBrinde() {
  const alvo = $("#gift-product-preview");
  if (!alvo) return;
  render(alvo,
    cardProdutoPreview(produtoPorId($("#gift-buy-product")?.value), "Produto comprado"),
    cardProdutoPreview(produtoPorId($("#gift-free-product")?.value), "Produto de brinde")
  );
}

function linhaBrinde(brinde) {
  const compra = produtoPorId(brinde.buyProductId);
  const brindeProduto = produtoPorId(brinde.giftProductId);
  const validade = brinde.until ? ` - ate ${brinde.until}` : "";

  return el("div.promo-row.gift-rule-row", {},
    fotoProduto(compra),
    el("div", {},
      el("strong", {}, `Leve ${brinde.buyQty} ${compra?.name || "produto removido"}`),
      el("span", {}, `Ganha ${brinde.giftQty} ${brindeProduto?.name || "produto removido"}${validade}`)
    ),
    fotoProduto(brindeProduto),
    el("button.ghost.small", { type: "button", dataset: { acao: "remover-brinde", id: brinde.id } }, "Encerrar")
  );
}

function desenharBrindes() {
  const lista = $("#gift-promo-list");
  if (!lista) return;
  render(lista, estado.brindesPromocionais.length
    ? estado.brindesPromocionais.map(linhaBrinde)
    : el("p.faint", {}, "Nenhuma regra leve e ganhe ativa."));
}

export function desenharPromocoes() {
  const lista = $("#promo-list");
  if (lista) {
    render(lista, estado.promocoes.length
      ? estado.promocoes.map(linhaPromocao)
      : el("p.faint", {}, "Nenhuma promoção ativa."));
  }

  const select = $("#promo-product");
  if (select) {
    preencherSelectProdutos(select);
    desenharPreviewPromocao();
  }

  preencherSelectProdutos($("#gift-buy-product"));
  preencherSelectProdutos($("#gift-free-product"));
  desenharPreviewBrinde();
  desenharBrindes();

  desenharDicas();
}

/* Dicas simples a partir do estoque: item parado e candidato natural a
 * promocao. Antes eram calculadas sobre o banco inteiro no navegador. */
function desenharDicas() {
  const alvo = $("#promo-tips");
  if (!alvo) return;

  const parados = estado.produtos
    .filter(produto => produto.active && produto.stock > produto.minStock * 3)
    .slice(0, 3);

  render(alvo, ...parados.map(produto =>
    el("button.promo-tip", { type: "button", dataset: { acao: "usar-dica", id: produto.id } },
      fotoProduto(produto),
      el("span.promo-tip-info", {},
        el("strong", {}, produto.name),
      el("span", {}, `${produto.stock} em estoque · sugerir ${reais(produto.price * 0.85)}`)
    )
    )
  ));
}

// ---------------------------------------------------------------- cupons ---
function linhaCupom(cupom) {
  const partes = [
    cupom.kind === "pct" ? `${cupom.amount}% off` : `${reais(cupom.amount)} off`,
    cupom.min ? `min. ${reais(cupom.min)}` : "",
    cupom.once ? "uso único" : "",
    cupom.until ? `até ${cupom.until}` : "sem prazo",
    `${cupom.uses} usos`
  ].filter(Boolean);

  return el("div.coupon-row", { class: cupom.active ? "" : "muted" },
    el("code", {}, cupom.code),
    el("span", {}, partes.join(" · ")),
    el("button.ghost.small", { type: "button", dataset: { acao: "alternar-cupom", code: cupom.code } },
      cupom.active ? "Desativar" : "Ativar"),
    el("button.danger.small", { type: "button", dataset: { acao: "remover-cupom", code: cupom.code } }, "Excluir")
  );
}

export function desenharCupons() {
  const alvo = $("#coupon-list");
  if (!alvo) return;

  render(alvo, estado.cupons.length
    ? estado.cupons.map(linhaCupom)
    : el("p.faint", {}, "Nenhum cupom cadastrado."));
}

function definirTipoCupom(tipo) {
  tipoCupom = tipo;
  $("#coupon-kind-pct")?.classList.toggle("active", tipo === "pct");
  $("#coupon-kind-val")?.classList.toggle("active", tipo === "val");
  const campo = $("#coupon-amount");
  if (campo) campo.placeholder = tipo === "pct" ? "Desconto (%)" : "Desconto (R$)";
}

function alternarUsoUnico() {
  usoUnico = !usoUnico;
  const botao = $("#coupon-once");
  botao.classList.toggle("active", usoUnico);
  botao.textContent = usoUnico ? "✓ Uso único por cliente" : "Uso único por cliente";
}

// ---------------------------------------------------------------- ligacao ---
export function ligarPromocoes() {
  delegar($("#promo-list"), "click", "[data-acao='remover-promo']", async (_e, botao) => {
    try {
      await apiPromocoes.remover(botao.dataset.id);
      await carregar("promocoes");
      desenharPromocoes();
      toast("Promoção encerrada.");
    } catch (erro) { toastFalha(erro); }
  });

  delegar($("#gift-promo-list"), "click", "[data-acao='remover-brinde']", async (_e, botao) => {
    try {
      await apiPromocoes.removerBrinde(botao.dataset.id);
      await carregar("promocoes");
      desenharPromocoes();
      toast("Regra leve e ganhe encerrada.");
    } catch (erro) { toastFalha(erro); }
  });

  delegar($("#promo-tips"), "click", "[data-acao='usar-dica']", (_e, botao) => {
    const produto = produtoPorId(botao.dataset.id);
    if (!produto) return;
    $("#promo-product").value = produto.id;
    $("#promo-price").value = (produto.price * 0.85).toFixed(2);
    desenharPreviewPromocao();
  });

  $("#promo-product")?.addEventListener("change", desenharPreviewPromocao);
  $("#gift-buy-product")?.addEventListener("change", desenharPreviewBrinde);
  $("#gift-free-product")?.addEventListener("change", desenharPreviewBrinde);

  $("#save-promo")?.addEventListener("click", async () => {
    erroDoFormulario("promo-error", "");
    const productId = $("#promo-product").value;
    const price = paraNumero($("#promo-price").value);
    const produto = estado.produtos.find(item => item.id === productId);

    if (!productId) return erroDoFormulario("promo-error", "Escolha o produto.");
    if (price <= 0) return erroDoFormulario("promo-error", "Informe o preço promocional.");
    /* O servidor tambem valida. Aqui e so para responder na hora. */
    if (produto && price >= produto.price) {
      return erroDoFormulario("promo-error", `O preço promocional precisa ser menor que ${reais(produto.price)}.`);
    }

    try {
      await apiPromocoes.salvar({ productId, price, until: $("#promo-until").value.trim() });
      await carregar("promocoes");
      desenharPromocoes();
      $("#promo-price").value = "";
      $("#promo-until").value = "";
      toast("Promoção ativada.");
    } catch (erro) {
      erroDoFormulario("promo-error", erro.message);
    }
  });

  $("#save-gift-promo")?.addEventListener("click", async () => {
    erroDoFormulario("gift-error", "");
    const buyProductId = $("#gift-buy-product")?.value;
    const giftProductId = $("#gift-free-product")?.value;
    const buyQty = Math.max(1, Math.floor(Number($("#gift-buy-qty")?.value || 1)));
    const giftQty = Math.max(1, Math.floor(Number($("#gift-free-qty")?.value || 1)));
    const until = $("#gift-until")?.value.trim() || "";

    if (!buyProductId) return erroDoFormulario("gift-error", "Escolha o produto comprado.");
    if (!giftProductId) return erroDoFormulario("gift-error", "Escolha o produto de brinde.");
    if (buyProductId === giftProductId) return erroDoFormulario("gift-error", "Compra e brinde precisam ser produtos diferentes.");

    try {
      await apiPromocoes.salvarBrinde({ buyProductId, giftProductId, buyQty, giftQty, until, active: true });
      await carregar("promocoes");
      desenharPromocoes();
      $("#gift-buy-qty").value = "1";
      $("#gift-free-qty").value = "1";
      $("#gift-until").value = "";
      toast("Regra leve e ganhe salva.");
    } catch (erro) {
      erroDoFormulario("gift-error", erro.message);
    }
  });

  $("#coupon-kind-pct")?.addEventListener("click", () => definirTipoCupom("pct"));
  $("#coupon-kind-val")?.addEventListener("click", () => definirTipoCupom("val"));
  $("#coupon-once")?.addEventListener("click", alternarUsoUnico);

  $("#save-coupon")?.addEventListener("click", async () => {
    erroDoFormulario("coupon-error", "");
    const code = $("#coupon-code").value.trim().toUpperCase();
    const amount = paraNumero($("#coupon-amount").value);

    if (!code) return erroDoFormulario("coupon-error", "Dê um código ao cupom.");
    if (amount <= 0) return erroDoFormulario("coupon-error", "Informe o valor do desconto.");

    try {
      await apiCupons.criar({
        code,
        kind: tipoCupom,
        amount,
        min: paraNumero($("#coupon-min").value),
        once: usoUnico,
        until: $("#coupon-until").value.trim()
      });
      await carregar("cupons");
      desenharCupons();
      for (const id of ["coupon-code", "coupon-amount", "coupon-min", "coupon-until"]) $(`#${id}`).value = "";
      if (usoUnico) alternarUsoUnico();
      definirTipoCupom("pct");
      toast("Cupom criado.");
    } catch (erro) {
      erroDoFormulario("coupon-error", erro.message);
    }
  });

  delegar($("#coupon-list"), "click", "[data-acao='alternar-cupom']", async (_e, botao) => {
    try {
      await apiCupons.alternarAtivo(botao.dataset.code);
      await carregar("cupons");
      desenharCupons();
    } catch (erro) { toastFalha(erro); }
  });

  delegar($("#coupon-list"), "click", "[data-acao='remover-cupom']", async (_e, botao) => {
    if (!confirm(`Excluir o cupom ${botao.dataset.code}?`)) return;
    try {
      await apiCupons.remover(botao.dataset.code);
      await carregar("cupons");
      desenharCupons();
    } catch (erro) { toastFalha(erro); }
  });
}
