/* Cardapio do cliente.
 *
 * Este arquivo e a unica coisa que o navegador de um cliente carrega alem dos
 * seus proprios modulos. O painel — cadastro, precos, dashboard, impressao,
 * configuracao de entrega — nao entra neste bundle e portanto nao chega ao
 * aparelho de quem esta so pedindo uma pizza. */
import "../../styles/index.css";
import { $, delegar, ligarModal, mostrar } from "../../utils/dom.js";
import { toast, toastFalha } from "../../components/toast.js";
import { apiPublica } from "../../services/api.js";
import { conectarEventos } from "../../services/realtime.js";
import { registrarPwa } from "../../services/pwa.js";
import { desenharDestaques, desenharFiltros, desenharGrade } from "./catalogo.js";
import { carrinho, aoMudarCarrinho } from "./carrinho-store.js";
import {
  desenharCarrinho, aplicarCupom, removerCupom, revalidarCupom,
  limparEstadoCupom, codigoAplicado
} from "./carrinho.js";
import * as entrega from "./entrega.js";
import { mesaDaUrl, sessaoMesa, iniciarModoMesa, mostrarVista, atualizarMesa } from "./mesa.js";

const estado = {
  produtos: [],
  produtosPorId: new Map(),
  loja: {},
  categoria: "todos",
  busca: "",
  modalidade: "retirada"
};

// ------------------------------------------------------------------ dados ---
async function carregarCardapio() {
  try {
    const { produtos, loja } = await apiPublica.cardapio();
    estado.produtos = produtos;
    estado.produtosPorId = new Map(produtos.map(produto => [produto.id, produto]));
    estado.loja = loja || {};
    return true;
  } catch (erro) {
    toastFalha(erro, "Cardapio");
    return false;
  }
}

function redesenhar() {
  if (estado.categoria !== "todos" && !estado.produtos.some(produto => produto.category === estado.categoria)) {
    estado.categoria = "todos";
  }
  desenharDestaques(estado.produtos);
  desenharFiltros(estado.produtos, estado.categoria);
  desenharGrade(estado.produtos, { categoria: estado.categoria, busca: estado.busca });
  return desenharCarrinho({
    produtosPorId: estado.produtosPorId,
    modalidade: estado.modalidade,
    cotacao: entrega.cotacao,
    modoMesa: Boolean(sessaoMesa.n)
  });
}

// ------------------------------------------------------------ interacoes ---
function definirCategoria(categoria) {
  estado.categoria = categoria;
  desenharFiltros(estado.produtos, categoria);
  desenharGrade(estado.produtos, { categoria, busca: estado.busca });
}

function definirModalidade(modo) {
  estado.modalidade = modo;
  $("#mode-retirada")?.classList.toggle("active", modo === "retirada");
  $("#mode-entrega")?.classList.toggle("active", modo === "entrega");

  const faixa = $("#pickup-banner");
  if (faixa) faixa.textContent = modo === "retirada" ? "RETIRADA" : "ENTREGA";
  mostrar($("#place-label"), modo === "entrega");

  if (modo === "entrega") entrega.montarWidget(redesenhar);
  else entrega.limparWidget();

  redesenhar();
}

function normalizarTroco(valor) {
  const numero = Number(String(valor ?? "").replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function atualizarCampoTroco() {
  const pagamento = $("#payment-method")?.value || "";
  const mostrarCampo = pagamento === "Dinheiro" && !sessaoMesa.n;
  mostrar($("#change-field"), mostrarCampo);
  if (!mostrarCampo && $("#change-for")) $("#change-for").value = "";
}

function adicionarAoCarrinho(id) {
  const produto = estado.produtosPorId.get(id);
  if (!produto) return toast("Item indisponivel.");
  carrinho.adicionar(id);
  document.body.classList.add("cart-open");
  toast("Item adicionado ao pedido.");
}

// -------------------------------------------------------------- checkout ---
function montarWhatsapp(pedido) {
  const numero = estado.loja.whatsapp;
  if (!numero) return;

  const linhas = [
    "Novo pedido de ENTREGA - Baixo K",
    `Pedido: #${String(pedido.id).slice(-5)}`,
    `Cliente: ${pedido.customer}`,
    ...pedido.items.map(item => `- ${item.qty}x ${item.name}`),
    `Total: R$ ${Number(pedido.total).toFixed(2)}`
  ];
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(linhas.join("\n"))}`, "_blank", "noopener");
}

async function enviarPedido() {
  const botao = $("#send-order");
  const linhas = carrinho.linhas();
  if (!linhas.length) return toast("Adicione pelo menos um item.");

  const cliente = $("#customer-name")?.value.trim() || "";
  const telefone = $("#customer-phone")?.value.trim() || "";
  const endereco = $("#customer-place")?.value.trim() || "";
  const pagamento = $("#payment-method")?.value || "";
  const trocoPara = normalizarTroco($("#change-for")?.value);
  const observacao = $("#order-note")?.value.trim() || "";
  const modoMesa = Boolean(sessaoMesa.n);

  if (!modoMesa) {
    if (!cliente || !pagamento) return toast("Preencha nome e forma de pagamento.");
    if (estado.modalidade === "entrega" && !endereco) return toast("Informe o endereco de entrega.");
    if (pagamento === "Dinheiro" && !trocoPara) return toast("Informe troco para quanto.");
  }

  const corpo = {
    customer: cliente || (modoMesa ? `Mesa ${sessaoMesa.n}` : "Cliente"),
    phone: telefone,
    place: modoMesa ? `Mesa ${sessaoMesa.n} - salao` : estado.modalidade === "entrega" ? endereco : "Retirada",
    payment: modoMesa ? "Pagar no balcao" : pagamento,
    trocoPara: modoMesa ? null : trocoPara,
    note: observacao,
    coupon: modoMesa ? "" : codigoAplicado(),
    fulfillment: modoMesa ? "mesa" : estado.modalidade,
    tableNumber: modoMesa ? sessaoMesa.n : null,
    /* So id e quantidade. Preco e total ficam de fora de proposito: sao decisao
     * do servidor, e mandar daqui seria oferecer um campo para adulterar. */
    items: linhas.map(linha => ({ id: linha.id, qty: linha.qty }))
  };

  botao.disabled = true;
  botao.textContent = "Enviando...";
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(new Error("timeout")), 20000);
  try {
    const { pedido } = await apiPublica.criarPedido(corpo, { sinal: controle.signal });

    carrinho.limpar();
    limparEstadoCupom();
    document.body.classList.remove("cart-open");
    for (const id of ["customer-name", "customer-phone", "order-note"]) {
      const campo = $(`#${id}`);
      if (campo) campo.value = "";
    }
    if ($("#payment-method")) $("#payment-method").value = "";
    if ($("#change-for")) $("#change-for").value = "";
    atualizarCampoTroco();
    entrega.limparWidget();

    if (modoMesa) {
      await atualizarMesa();
      mostrarVista("comanda");
      toast("Pedido enviado para a cozinha.");
    } else {
      if (estado.modalidade === "entrega") montarWhatsapp(pedido);
      toast(`Pedido ${String(pedido.id).slice(-5)} enviado para a cozinha.`);
    }
    redesenhar();
  } catch (erro) {
    /* A mensagem vem do servidor e e a que importa: "restam 2 unidades",
     * "endereco fora da area", "a comanda desta mesa nao esta aberta". */
    toastFalha(erro);
    await carregarCardapio();
    redesenhar();
  } finally {
    clearTimeout(tempo);
    botao.disabled = false;
    botao.textContent = modoMesa ? "Enviar para a cozinha" : "Enviar pedido";
  }
}

// ------------------------------------------------------------------ ligacao ---
function ligarEventos() {
  /* Um ouvinte por container, com delegacao. Substitui os onclick= que estavam
   * no HTML e permite a CSP sem 'unsafe-inline'. */
  delegar(document.body, "click", "[data-acao='adicionar']", (_evento, alvo) => adicionarAoCarrinho(alvo.dataset.id));
  delegar(document.body, "click", "[data-acao='categoria']", (_evento, alvo) => {
    definirCategoria(alvo.dataset.categoria);
    $("#menu-shell")?.scrollIntoView({ behavior: "smooth" });
  });
  delegar(document.body, "click", "[data-acao='qtd']", (_evento, alvo) => {
    carrinho.mudarQuantidade(alvo.dataset.id, Number(alvo.dataset.delta));
  });
  delegar(document.body, "click", "[data-acao='escolher-endereco']", (_evento, alvo) => {
    entrega.escolherEndereco({
      texto: alvo.dataset.texto, lng: Number(alvo.dataset.lng), lat: Number(alvo.dataset.lat)
    }, redesenhar);
  });
  delegar(document.body, "click", "[data-view]", (_evento, alvo) => mostrarVista(alvo.dataset.view));

  $("#search")?.addEventListener("input", evento => {
    estado.busca = evento.target.value;
    desenharGrade(estado.produtos, { categoria: estado.categoria, busca: estado.busca });
  });

  $("#mode-retirada")?.addEventListener("click", () => definirModalidade("retirada"));
  $("#mode-entrega")?.addEventListener("click", () => definirModalidade("entrega"));
  $("#payment-method")?.addEventListener("change", atualizarCampoTroco);

  $("#customer-place")?.addEventListener("input", evento => entrega.buscarEndereco(evento.target.value, redesenhar));
  $("#apply-coupon")?.addEventListener("click", async () => {
    const { subtotal } = redesenhar();
    await aplicarCupom(subtotal, $("#customer-phone")?.value.trim());
    redesenhar();
  });
  $("#remove-coupon")?.addEventListener("click", () => {
    removerCupom();
    redesenhar();
  });

  $("#send-order")?.addEventListener("click", enviarPedido);
  $("#clear-cart")?.addEventListener("click", () => {
    carrinho.limpar();
    limparEstadoCupom();
    if ($("#change-for")) $("#change-for").value = "";
    redesenhar();
  });
  $("#open-cart")?.addEventListener("click", () => document.body.classList.add("cart-open"));
  $("#close-cart")?.addEventListener("click", () => document.body.classList.remove("cart-open"));

  const modalPagamento = $("#payment-modal");
  $("#open-payment-info")?.addEventListener("click", () => mostrar(modalPagamento, true));
  $("#close-payment-info")?.addEventListener("click", () => mostrar(modalPagamento, false));
  ligarModal(modalPagamento, () => mostrar(modalPagamento, false));

  /* Revalida o cupom quando o carrinho muda: um cupom com pedido minimo deixa
   * de valer se o cliente tirar itens, e o total tem que refletir na hora. */
  let timerCupom = null;
  window.addEventListener("baixok:carrinho", () => {
    clearTimeout(timerCupom);
    const { subtotal } = redesenhar();
    timerCupom = setTimeout(async () => {
      await revalidarCupom(subtotal, $("#customer-phone")?.value.trim());
      redesenhar();
    }, 250);
  });
}

// ------------------------------------------------------------------ inicio ---
async function iniciar() {
  const numeroMesa = mesaDaUrl();
  if (numeroMesa) iniciarModoMesa(numeroMesa);

  ligarEventos();
  atualizarCampoTroco();
  await carregarCardapio();
  redesenhar();

  if (numeroMesa) await atualizarMesa();
  else definirModalidade("retirada");

  /* Canal publico: o cliente so e avisado de mudanca no cardapio e nas mesas.
   * Nada da fila da cozinha chega aqui. */
  conectarEventos({
    canal: "publico",
    aoMudar: async assunto => {
      if (["produtos", "promocoes", "entrega", "retomada", "desconhecido"].includes(assunto)) {
        await carregarCardapio();
        redesenhar();
      }
      if (["mesas", "pedidos", "retomada", "desconhecido"].includes(assunto) && sessaoMesa.n) {
        await atualizarMesa();
      }
    }
  });

  registrarPwa();
}

/* O store avisa por evento no window para o resto da pagina nao precisar
 * conhecer o formato interno dele. */
aoMudarCarrinho(() => window.dispatchEvent(new Event("baixok:carrinho")));

iniciar();
