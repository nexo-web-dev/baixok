/* Painel lateral do pedido: itens, cupom e totais.
 *
 * Todo valor mostrado aqui e PREVIA. O total cobrado e o que o servidor calcula
 * ao registrar o pedido, com o cardapio da casa. Deixar isso explicito importa:
 * o sistema antigo tratava o total do carrinho como verdade e mandava junto no
 * corpo do pedido. */
import { el, render, $, mostrar } from "../../utils/dom.js";
import { dinheiro, reais } from "../../utils/formato.js";
import { carrinho, cupomGuardado } from "./carrinho-store.js";
import { apiPublica } from "../../services/api.js";
import { toast } from "../../components/toast.js";
import { marcarProporcaoImagem } from "../../utils/fotos.js";

/* Ultimo resultado da validacao do cupom, vindo do servidor. */
let cupomAplicado = null;

export const descontoAtual = () => (cupomAplicado?.valido ? Number(cupomAplicado.desconto) : 0);
export const codigoAplicado = () => (cupomAplicado?.valido ? cupomGuardado.ler() : "");

function avisoCupom(mensagem, ok = false) {
  const alvo = $("#coupon-feedback");
  if (!alvo) return;
  alvo.textContent = mensagem || "";
  alvo.classList.toggle("hidden", !mensagem);
  alvo.classList.toggle("ok", ok);
}

function fotoCarrinho(item) {
  if (!item?.image) return el("div.no-photo", {}, "Sem foto");
  return el("span.fit-media", {},
    el("img.fit-media-bg", {
      src: item.image,
      alt: "",
      loading: "lazy",
      decoding: "async",
      "aria-hidden": "true"
    }),
    el("img.fit-media-main", {
      onload: marcarProporcaoImagem,
      src: item.image,
      alt: item.name || "Produto",
      loading: "lazy",
      decoding: "async",
      onerror: evento => evento.target.closest(".fit-media")?.replaceWith(el("div.no-photo", {}, "Sem foto"))
    })
  );
}

function linhaItem(item) {
  return el("div.cart-row", { dataset: { chave: item.chave } },
    el("div.cart-thumb", {}, fotoCarrinho(item)),
    el("div.cart-row-body", {},
      el("div.price-row", {},
        el("strong", {}, `${item.qty}x ${item.name}`),
        el("span", {}, reais(item.price * item.qty))
      ),
      el("div.qty-actions", {},
        el("button", {
          type: "button", dataset: { acao: "qtd", chave: item.chave, delta: "-1" },
          "aria-label": `Remover uma unidade de ${item.name}`
        }, "-"),
        el("button", {
          type: "button", dataset: { acao: "qtd", chave: item.chave, delta: "1" },
          "aria-label": `Adicionar uma unidade de ${item.name}`
        }, "+")
      )
    )
  );
}

/* Previa do que o servidor vai conceder de brinde ao fechar o pedido — a
 * mesma soma que `aplicarBrindes()` faz no backend, so que aqui e so exibicao:
 * quem decide de verdade e o servidor, na hora de gravar o pedido. Combo e
 * pizza de 2 sabores nao entram na regra, igual do lado de la. */
function brindesGanhos(linhas, produtosPorId) {
  const qtyPorProduto = new Map();
  for (const item of linhas) {
    if (item.comboId || item.id2 || !item.id) continue;
    qtyPorProduto.set(item.id, (qtyPorProduto.get(item.id) || 0) + item.qty);
  }
  if (!qtyPorProduto.size) return [];

  const ganhos = [];
  for (const [produtoId, qty] of qtyPorProduto) {
    for (const brinde of produtosPorId?.get(produtoId)?.brindesPromocionais || []) {
      const vezes = Math.floor(qty / brinde.buyQty);
      if (vezes < 1) continue;
      ganhos.push({ ...brinde, qty: vezes * brinde.giftQty });
    }
  }
  return ganhos;
}

function linhaBrindeGanho(brinde) {
  return el("div.cart-gift-row", {},
    brinde.giftImage
      ? el("img.cart-gift-photo", {
          src: brinde.giftImage, alt: "", loading: "lazy", decoding: "async",
          onerror: evento => evento.target.remove()
        })
      : null,
    el("span", {}, `Você vai ganhar: ${brinde.qty}x ${brinde.giftName} de brinde`)
  );
}

export function desenharCarrinho({ produtosPorId, combosPorId, combinacoesMap, modalidade, cotacao, modoMesa }) {
  const alvo = $("#cart-items");
  if (!alvo) return { subtotal: 0, total: 0 };

  const { linhas, avisos } = carrinho.comCatalogo({ produtosPorId, combosPorId, combinacoesMap });
  if (avisos.length) toast(avisos[0]);

  render(alvo, linhas.length
    ? linhas.map(linhaItem)
    : el("p.faint", {}, "Nenhum item no pedido."));

  const ganhos = brindesGanhos(linhas, produtosPorId);
  render($("#cart-gifts"), ...ganhos.map(linhaBrindeGanho));

  const subtotal = linhas.reduce((soma, item) => soma + item.price * item.qty, 0);
  const desconto = Math.min(subtotal, descontoAtual());
  const frete = modalidade === "entrega" && cotacao?.dentro ? Number(cotacao.taxa) : 0;
  const total = Math.max(0, subtotal - desconto) + frete;

  /* No modo mesa nao ha cupom nem entrega: a conta e fechada no balcao. */
  mostrar($("#coupon-field"), !modoMesa);
  mostrar($("#coupon-applied"), Boolean(cupomAplicado?.valido));
  if (cupomAplicado?.valido) {
    $("#coupon-applied-code").textContent = cupomGuardado.ler();
    $("#coupon-applied-desc").textContent = cupomAplicado.descricao || "";
  }

  $("#cart-subtotal").textContent = dinheiro(subtotal);
  $("#cart-discount").textContent = dinheiro(desconto);
  $("#cart-delivery").textContent = dinheiro(frete);
  $("#cart-total").textContent = dinheiro(total);
  $("#mobile-total").textContent = dinheiro(total);
  $("#cart-count").textContent = String(linhas.reduce((soma, item) => soma + item.qty, 0));

  mostrar($("#delivery-line"), frete > 0);
  mostrar($("#discount-line"), desconto > 0);
  mostrar($("#subtotal-line"), desconto > 0 || frete > 0);

  return { subtotal, desconto, frete, total, linhas };
}

/* A validacao acontece no servidor.
 *
 * O painel antigo mandava a lista inteira de cupons para o navegador so para
 * conseguir responder "esse codigo existe?" — e com ela ia o valor de cada
 * campanha, inclusive as ainda nao divulgadas. Aqui perguntamos por um codigo
 * de cada vez e recebemos so o efeito no carrinho deste cliente. */
export async function aplicarCupom(subtotal, telefone) {
  const campo = $("#coupon-code-input");
  const code = (campo?.value || "").trim().toUpperCase();

  if (!code) return avisoCupom("Digite o código do cupom.");
  if (!carrinho.linhas().length) return avisoCupom("Adicione itens antes de aplicar o cupom.");

  try {
    const resposta = await apiPublica.validarCupom({ code, subtotal, phone: telefone || "" });
    if (!resposta.valido) {
      cupomAplicado = null;
      cupomGuardado.limpar();
      return avisoCupom(resposta.motivo || "Cupom inválido.");
    }
    cupomAplicado = resposta;
    cupomGuardado.gravar(code);
    if (campo) campo.value = "";
    avisoCupom("");
    toast("Cupom aplicado.");
  } catch (erro) {
    avisoCupom(erro.message || "Não foi possível validar o cupom agora.");
  }
}

export function removerCupom() {
  cupomAplicado = null;
  cupomGuardado.limpar();
  avisoCupom("");
}

/* Revalida o cupom guardado quando o carrinho muda de valor: um cupom com
 * pedido minimo deixa de valer se o cliente remover itens, e o total precisa
 * refletir isso na hora. */
export async function revalidarCupom(subtotal, telefone) {
  const code = cupomGuardado.ler();
  if (!code) {
    cupomAplicado = null;
    return;
  }
  try {
    const resposta = await apiPublica.validarCupom({ code, subtotal, phone: telefone || "" });
    cupomAplicado = resposta.valido ? resposta : null;
    if (!resposta.valido) avisoCupom(resposta.motivo || "");
  } catch {
    cupomAplicado = null;      // sem conexao: nao promete desconto que nao da
  }
}

export function limparEstadoCupom() {
  cupomAplicado = null;
  avisoCupom("");
}
