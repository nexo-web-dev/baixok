/* Cardapio do cliente.
 *
 * Este arquivo e a unica coisa que o navegador de um cliente carrega alem dos
 * seus proprios modulos. O painel — cadastro, precos, dashboard, impressao,
 * configuracao de entrega — nao entra neste bundle e portanto nao chega ao
 * aparelho de quem esta so pedindo uma pizza. */
import "../../styles/index.css";
import { $, el, render, delegar, ligarModal, mostrar, debounce } from "../../utils/dom.js";
import { toast, toastFalha } from "../../components/toast.js";
import { apiPublica } from "../../services/api.js";
import { conectarEventos } from "../../services/realtime.js";
import { registrarPwa } from "../../services/pwa.js";
import { reais, dataHora } from "../../utils/formato.js";
import { rotuloCategoria } from "../../utils/categorias.js";
import { controlaEstoqueCategoria } from "../../utils/estoque.js";
import { desenharDestaques, desenharFiltros, desenharGrade, categoriaInicial, foto, blocoBrindes } from "./catalogo.js";
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
  combosPorId: new Map(),
  combinacoesMap: new Map(),
  loja: { caixaAberto: false },
  categoria: "todos",
  busca: "",
  modalidade: "retirada"
};

/* Combo entra na mesma grade dos produtos — mesmo cartao, mesma busca, mesmo
 * filtro de categoria — marcado com `__combo` pra saber, na hora de adicionar
 * ao carrinho, que e um `comboId` e nao um `id` de produto normal. */
function comboComoProduto(combo) {
  return {
    id: combo.id, name: combo.name, description: combo.description,
    price: combo.price, image: combo.image, category: "combos", badge: "Combo",
    active: combo.active, saborPizza: false, disponivel: true,
    emPromocao: false, precoOriginal: null, brindesPromocionais: [], __combo: true
  };
}

const chaveCombinacao = (idA, idB) => [idA, idB].sort().join("|");
const fotosPrecarregadas = new Set();

function preCarregarFotos(produtos = []) {
  const urls = [...new Set(produtos.map(produto => produto?.image).filter(Boolean))];
  const carregar = url => {
    if (fotosPrecarregadas.has(url)) return;
    fotosPrecarregadas.add(url);
    const imagem = new Image();
    imagem.decoding = "async";
    imagem.loading = "eager";
    imagem.src = url;
  };

  urls.slice(0, 16).forEach(carregar);

  let indice = 16;
  function carregarLote() {
    const limite = Math.min(indice + 6, urls.length);
    for (; indice < limite; indice += 1) carregar(urls[indice]);
    if (indice < urls.length) window.setTimeout(carregarLote, 120);
  }
  if (indice < urls.length) window.setTimeout(carregarLote, 80);
}

// ------------------------------------------------------------------ dados ---
async function carregarCardapio() {
  try {
    const { produtos, combos, combinacoesSabores, loja } = await apiPublica.cardapio();
    const combosProdutos = (combos || []).map(comboComoProduto);
    estado.produtos = [...produtos, ...combosProdutos];
    /* So resolve uma vez — depois que o filtro ja abriu numa categoria de
     * verdade, "todos" nao volta a acontecer sozinho num recarregamento. */
    if (estado.categoria === "todos") estado.categoria = categoriaInicial(estado.produtos);
    estado.produtosPorId = new Map(estado.produtos.map(produto => [produto.id, produto]));
    estado.combosPorId = new Map((combos || []).map(combo => [combo.id, combo]));
    estado.combinacoesMap = new Map(
      (combinacoesSabores || []).map(c => [chaveCombinacao(c.produtoAId, c.produtoBId), c.preco])
    );
    estado.loja = loja || {};
    preCarregarFotos(estado.produtos);
    return true;
  } catch (erro) {
    estado.produtos = [];
    estado.produtosPorId = new Map();
    estado.combosPorId = new Map();
    estado.combinacoesMap = new Map();
    estado.loja = { ...estado.loja, caixaAberto: false };
    toastFalha(erro, "Cardápio");
    return false;
  }
}

let resumoCarrinhoAtual = { subtotal: 0, desconto: 0, frete: 0, total: 0, linhas: [] };
let desenhandoCarrinho = false;

function redesenharGradeAtual() {
  desenharGrade(estado.produtos, { categoria: estado.categoria, busca: estado.busca, lojaAberta: lojaAberta() });
}

function desenharCarrinhoEResumo() {
  if (desenhandoCarrinho) return resumoCarrinhoAtual;
  desenhandoCarrinho = true;
  try {
    const resumo = desenharCarrinho({
      produtosPorId: estado.produtosPorId,
      combosPorId: estado.combosPorId,
      combinacoesMap: estado.combinacoesMap,
      modalidade: estado.modalidade,
      cotacao: entrega.cotacao,
      modoMesa: Boolean(sessaoMesa.n)
    });
    resumoCarrinhoAtual = resumo;
    atualizarResumoTroco(resumo.total);
    atualizarStatusLoja();
    return resumo;
  } finally {
    desenhandoCarrinho = false;
  }
}

function redesenharCatalogo() {
  if (estado.categoria !== "todos" && !estado.produtos.some(produto => produto.category === estado.categoria)) {
    /* A categoria escolhida sumiu do catalogo (produto pausado/excluido) —
     * volta pro filtro inicial, nunca pra grade toda misturada. */
    estado.categoria = categoriaInicial(estado.produtos);
  }
  desenharDestaques(estado.produtos);
  desenharFiltros(estado.produtos, estado.categoria);
  redesenharGradeAtual();
}

function redesenhar() {
  redesenharCatalogo();
  return desenharCarrinhoEResumo();
}

// ------------------------------------------------------------ interacoes ---
function definirCategoria(categoria) {
  estado.categoria = categoria;
  desenharFiltros(estado.produtos, categoria);
  redesenharGradeAtual();
}

function definirModalidade(modo) {
  estado.modalidade = modo;
  $("#mode-retirada")?.classList.toggle("active", modo === "retirada");
  $("#mode-entrega")?.classList.toggle("active", modo === "entrega");

  const faixa = $("#pickup-banner");
  if (faixa) faixa.textContent = modo === "retirada" ? "RETIRADA" : "ENTREGA";
  mostrar($("#place-label"), modo === "entrega");

  if (modo === "entrega") entrega.montarWidget(desenharCarrinhoEResumo);
  else entrega.limparWidget();

  desenharCarrinhoEResumo();
}

function normalizarTroco(valor) {
  const numero = Number(String(valor ?? "").replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function totalAtualDaTela() {
  const texto = $("#cart-total")?.textContent || "0";
  const numero = Number(texto.replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(numero) ? numero : 0;
}

function atualizarResumoTroco(totalAtual = totalAtualDaTela()) {
  const pagamento = $("#payment-method")?.value || "";
  const trocoPara = normalizarTroco($("#change-for")?.value);
  const mostrarResumo = pagamento === "Dinheiro" && !sessaoMesa.n && Boolean(trocoPara);
  mostrar($("#change-summary"), mostrarResumo);
  if (!mostrarResumo) return;

  const troco = Math.max(0, trocoPara - Number(totalAtual || 0));
  const rotulo = $("#cart-change-label");
  const valor = $("#cart-change");
  if (rotulo) rotulo.textContent = `Troco para ${reais(trocoPara)}`;
  if (valor) valor.textContent = `Devolver ${reais(troco)}`;
}

function atualizarCampoTroco() {
  const pagamento = $("#payment-method")?.value || "";
  const mostrarCampo = pagamento === "Dinheiro" && !sessaoMesa.n;
  mostrar($("#change-field"), mostrarCampo);
  if (!mostrarCampo && $("#change-for")) $("#change-for").value = "";
  atualizarResumoTroco();
}

function lojaAberta() {
  return estado.loja.caixaAberto === true;
}

function atualizarStatusLoja() {
  const aberta = lojaAberta();
  document.body.classList.toggle("store-closed", !aberta);
  mostrar($("#closed-banner"), !aberta);

  const badge = document.querySelector(".live-badge");
  if (badge) badge.textContent = aberta ? "Aberto para pedidos" : "Estabelecimento fechado";

  const botao = $("#send-order");
  if (botao) {
    botao.disabled = false;
    botao.setAttribute("aria-disabled", String(!aberta));
    botao.textContent = aberta
      ? (sessaoMesa.n ? "Enviar para a cozinha" : "Enviar pedido")
      : "Estabelecimento fechado";
  }

  const quantidade = Number($("#cart-count")?.textContent || 0);
  document.body.classList.toggle("cart-has-items", quantidade > 0);
  mostrar($("#open-cart"), quantidade > 0);
}

function telaPequena() {
  return window.matchMedia?.("(max-width: 900px)").matches ?? window.innerWidth <= 900;
}

/* Redesenhar a grade inteira a cada tecla pesa num catalogo grande — o
 * mesmo debounce usado nas buscas do painel, so que aqui e o cliente no
 * proprio celular quem sente. */
const agendarBusca = debounce(() => redesenharGradeAtual(), 150);

function abrirCarrinho({ forcar = false } = {}) {
  document.body.classList.add("cart-has-items");
  if (forcar || !telaPequena()) {
    document.body.classList.add("cart-open");
    requestAnimationFrame(() => {
      const carrinhoEl = $("#cart");
      const itensEl = $("#cart-items");
      if (carrinhoEl) carrinhoEl.scrollTop = 0;
      if (itensEl) itensEl.scrollTop = 0;
    });
  }
}

let saborPendente = null;

function opcoesSegundoSabor(produto) {
  return estado.produtos.filter(item =>
    item.saborPizza && item.id !== produto.id && estado.combinacoesMap.has(chaveCombinacao(produto.id, item.id))
  );
}

function fecharEscolhaSabores() {
  mostrar($("#flavor-modal"), false);
  saborPendente = null;
}

function abrirEscolhaSabores(produto) {
  saborPendente = produto;
  const nome = $("#flavor-product-name");
  if (nome) nome.textContent = produto.name;
  mostrar($("#flavor-second-step"), false);
  mostrar($("#flavor-modal"), true);
}

function escolherUmSabor() {
  if (!saborPendente) return;
  const produto = saborPendente;
  fecharEscolhaSabores();
  carrinho.adicionar(produto.id);
  abrirCarrinho();
  toast("Item adicionado ao pedido.");
}

function mostrarSegundoSabor() {
  if (!saborPendente) return;
  const opcoes = opcoesSegundoSabor(saborPendente);
  render($("#flavor-options"), ...(opcoes.length
    ? opcoes.map(produto2 => el("button.chip", {
        type: "button",
        dataset: { acao: "escolher-segundo-sabor", id: produto2.id }
      }, `${produto2.name} — ${reais(estado.combinacoesMap.get(chaveCombinacao(saborPendente.id, produto2.id)))}`))
    : [el("p.faint", {}, "Nenhuma combinação de 2 sabores configurada para esse item ainda.")]));
  mostrar($("#flavor-second-step"), true);
}

function escolherSegundoSabor(id2) {
  if (!saborPendente) return;
  const id = saborPendente.id;
  fecharEscolhaSabores();
  carrinho.adicionarComposto({ id, id2 });
  abrirCarrinho();
  toast("Item adicionado ao pedido.");
}

function adicionarAoCarrinho(id) {
  if (!lojaAberta()) return toast("Estabelecimento fechado no momento. O cardápio está disponível só para consulta.");
  const produto = estado.produtosPorId.get(id);
  if (!produto) return toast("Item indisponível.");

  if (produto.__combo) {
    carrinho.adicionarComposto({ comboId: produto.id });
    abrirCarrinho();
    mostrar($("#product-modal"), false);
    toast("Item adicionado ao pedido.");
    return;
  }

  if (produto.saborPizza) {
    mostrar($("#product-modal"), false);
    abrirEscolhaSabores(produto);
    return;
  }

  carrinho.adicionar(id);
  abrirCarrinho();
  mostrar($("#product-modal"), false);
  toast("Item adicionado ao pedido.");
}

function abrirDetalhesProduto(id) {
  const produto = estado.produtosPorId.get(id);
  const modal = $("#product-modal");
  const alvo = $("#product-detail");
  if (!produto || !modal || !alvo) return;

  const promocional = produto.emPromocao && produto.precoOriginal > produto.price;
  render(alvo,
    el("div.product-detail", {},
      el("div.product-detail-media", {}, foto(produto, produto.name, { prioridade: true })),
      el("div.product-detail-info", {},
        el("span.eyebrow", {}, produto.badge || rotuloCategoria(produto.category) || "Item"),
        el("h2#product-detail-title", {}, produto.name),
        el("p", {}, produto.description || "Produto do cardápio Baixo K."),
        blocoBrindes(produto),
        el("div.product-detail-price", {},
          promocional ? el("s", {}, reais(produto.precoOriginal)) : null,
          el("strong", {}, reais(produto.price))
        ),
        controlaEstoqueCategoria(produto.category) && produto.stock != null
          ? el("span.stock-chip", {}, `${produto.stock} disponíveis`)
          : null,
        el("button.primary.wide", {
          type: "button",
          disabled: !lojaAberta(),
          dataset: lojaAberta() ? { acao: "adicionar", id: produto.id } : {}
        }, lojaAberta() ? "Adicionar ao pedido" : "Estabelecimento fechado")
      )
    )
  );
  mostrar(modal, true);
}

function ligarRolagemDoCarrinho() {
  const cart = $("#cart");
  if (!cart) return;

  cart.addEventListener("wheel", evento => {
    if (!document.body.classList.contains("cart-open")) return;
    evento.stopPropagation();
  }, { passive: true });
}

// -------------------------------------------------------------- checkout ---
function montarWhatsapp(pedido) {
  const numero = estado.loja.whatsapp;
  if (!numero) return;

  const linhas = [
    "Novo pedido de ENTREGA - Baixo K",
    `Pedido: #${String(pedido.id).slice(-5)}`,
    `Cliente: ${pedido.customer}`,
    ...pedido.items.map(item => `- ${item.qty}x ${item.name}${item.gift ? " (brinde - leve e ganhe)" : ""}`),
    `Total: R$ ${Number(pedido.total).toFixed(2)}`
  ];
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(linhas.join("\n"))}`, "_blank", "noopener");
}

async function enviarPedido() {
  const botao = $("#send-order");
  if (!lojaAberta()) return toast("Estabelecimento fechado no momento. Tente novamente quando o caixa abrir.");
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
    if (estado.modalidade === "entrega" && !endereco) return toast("Informe o endereço de entrega.");
    if (pagamento === "Dinheiro" && !trocoPara) return toast("Informe troco para quanto.");
  }

  const corpo = {
    customer: cliente || (modoMesa ? `Mesa ${sessaoMesa.n}` : "Cliente"),
    phone: telefone,
    place: modoMesa ? `Mesa ${sessaoMesa.n} - salão` : estado.modalidade === "entrega" ? endereco : "Retirada",
    payment: modoMesa ? "Pagar no balcão" : pagamento,
    trocoPara: modoMesa ? null : trocoPara,
    note: observacao,
    coupon: modoMesa ? "" : codigoAplicado(),
    fulfillment: modoMesa ? "mesa" : estado.modalidade,
    tableNumber: modoMesa ? sessaoMesa.n : null,
    /* So o que foi escolhido e a quantidade. Preco e total ficam de fora de
     * proposito: sao decisao do servidor, e mandar daqui seria oferecer um
     * campo para adulterar. Cada linha manda so os campos que faz sentido pra
     * ela — client nulo bate no `.optional()` do schema como "nao mandou". */
    items: linhas.map(linha => (linha.comboId
      ? { comboId: linha.comboId, qty: linha.qty }
      : { id: linha.id, ...(linha.id2 ? { id2: linha.id2 } : {}), qty: linha.qty }))
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

    const brindes = (pedido.items || []).filter(item => item.gift);
    const avisoBrinde = brindes.length
      ? ` Você ganhou de brinde: ${brindes.map(item => `${item.qty}x ${item.name}`).join(", ")}!`
      : "";

    if (modoMesa) {
      await atualizarMesa();
      mostrarVista("comanda");
      toast(`Pedido enviado para a cozinha. Chame o garçom para fechar a conta.${avisoBrinde}`);
    } else {
      if (estado.modalidade === "entrega") montarWhatsapp(pedido);
      toast(`Pedido ${String(pedido.id).slice(-5)} enviado para a cozinha.${avisoBrinde}`);
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
    atualizarStatusLoja();
  }
}

// -------------------------------------------------------------- historico ---
function pedidoHistorico(pedido) {
  const itens = pedido.items.map(item => `${item.qty}x ${item.name}${item.gift ? " (brinde)" : ""}`).join(" | ");
  return el("article.history-order", {},
    el("div", {},
      el("strong", {}, `Pedido ${String(pedido.id).slice(-3).toUpperCase()}`),
      el("span", {}, `${dataHora(pedido.createdAt)} | ${pedido.fulfillment || "-"}`),
      el("em", {}, itens || "Sem itens")
    ),
    el("div", {},
      el("strong", {}, reais(pedido.total)),
      el("span", {}, pedido.status)
    )
  );
}

async function buscarHistorico() {
  const telefone = $("#history-phone")?.value.trim() || $("#customer-phone")?.value.trim() || "";
  const alvo = $("#history-results");
  if (!telefone) return toast("Informe o telefone usado no pedido.");

  render(alvo, el("p.faint", {}, "Buscando pedidos..."));
  try {
    const { pedidos } = await apiPublica.historicoPedidos(telefone);
    render(alvo, pedidos.length
      ? pedidos.map(pedidoHistorico)
      : el("p.faint", {}, "Nenhum pedido encontrado para este telefone."));
  } catch (erro) {
    toastFalha(erro, "Histórico");
    render(alvo);
  }
}

// ------------------------------------------------------------------ ligacao ---
function ligarEventos() {
  /* Um ouvinte por container, com delegacao. Substitui os onclick= que estavam
   * no HTML e permite a CSP sem 'unsafe-inline'. */
  delegar(document.body, "click", "[data-acao='adicionar']", (evento, alvo) => {
    evento.preventDefault();
    evento.stopPropagation();
    adicionarAoCarrinho(alvo.dataset.id);
  });
  delegar(document.body, "click", "[data-acao='detalhes-produto']", (evento, alvo) => {
    if (evento.target.closest("button,a,input,select,textarea")) return;
    abrirDetalhesProduto(alvo.dataset.id);
  });
  delegar(document.body, "keydown", "[data-acao='detalhes-produto']", (evento, alvo) => {
    if (!["Enter", " "].includes(evento.key)) return;
    evento.preventDefault();
    abrirDetalhesProduto(alvo.dataset.id);
  });
  delegar(document.body, "click", "[data-acao='categoria']", (_evento, alvo) => {
    definirCategoria(alvo.dataset.categoria);
    $("#menu-shell")?.scrollIntoView({ behavior: telaPequena() ? "auto" : "smooth" });
  });
  delegar(document.body, "click", "[data-acao='qtd']", (_evento, alvo) => {
    carrinho.mudarQuantidade(alvo.dataset.chave, Number(alvo.dataset.delta));
  });
  delegar(document.body, "click", "[data-acao='escolher-segundo-sabor']", (_evento, alvo) => {
    escolherSegundoSabor(alvo.dataset.id);
  });
  delegar(document.body, "click", "[data-acao='escolher-endereco']", (_evento, alvo) => {
    entrega.escolherEndereco({
      texto: alvo.dataset.texto, lng: Number(alvo.dataset.lng), lat: Number(alvo.dataset.lat)
    }, desenharCarrinhoEResumo);
  });
  delegar(document.body, "click", "[data-view]", (_evento, alvo) => mostrarVista(alvo.dataset.view));

  $("#search")?.addEventListener("input", evento => {
    estado.busca = evento.target.value;
    agendarBusca();
  });

  $("#mode-retirada")?.addEventListener("click", () => definirModalidade("retirada"));
  $("#mode-entrega")?.addEventListener("click", () => definirModalidade("entrega"));
  $("#payment-method")?.addEventListener("change", atualizarCampoTroco);
  $("#change-for")?.addEventListener("input", () => atualizarResumoTroco());

  $("#customer-place")?.addEventListener("input", evento => entrega.buscarEndereco(evento.target.value, desenharCarrinhoEResumo));
  $("#apply-coupon")?.addEventListener("click", async () => {
    const { subtotal } = desenharCarrinhoEResumo();
    await aplicarCupom(subtotal, $("#customer-phone")?.value.trim());
    desenharCarrinhoEResumo();
  });
  $("#remove-coupon")?.addEventListener("click", () => {
    removerCupom();
    desenharCarrinhoEResumo();
  });

  $("#send-order")?.addEventListener("click", enviarPedido);
  $("#clear-cart")?.addEventListener("click", () => {
    carrinho.limpar();
    limparEstadoCupom();
    if ($("#change-for")) $("#change-for").value = "";
    desenharCarrinhoEResumo();
  });
  $("#open-cart")?.addEventListener("click", () => abrirCarrinho({ forcar: true }));
  $("#close-cart")?.addEventListener("click", () => document.body.classList.remove("cart-open"));
  ligarRolagemDoCarrinho();

  const modalPagamento = $("#payment-modal");
  $("#open-payment-info")?.addEventListener("click", () => mostrar(modalPagamento, true));
  $("#close-payment-info")?.addEventListener("click", () => mostrar(modalPagamento, false));
  ligarModal(modalPagamento, () => mostrar(modalPagamento, false));

  const modalHistorico = $("#history-modal");
  $("#open-history")?.addEventListener("click", () => {
    const telefone = $("#customer-phone")?.value.trim();
    if (telefone && $("#history-phone")) $("#history-phone").value = telefone;
    render($("#history-results"));
    mostrar(modalHistorico, true);
    $("#history-phone")?.focus();
  });
  $("#history-close")?.addEventListener("click", () => mostrar(modalHistorico, false));
  $("#history-search")?.addEventListener("click", buscarHistorico);
  $("#history-phone")?.addEventListener("keydown", evento => {
    if (evento.key === "Enter") buscarHistorico();
  });
  ligarModal(modalHistorico, () => mostrar(modalHistorico, false));

  const modalProduto = $("#product-modal");
  $("#product-close")?.addEventListener("click", () => mostrar(modalProduto, false));
  ligarModal(modalProduto, () => mostrar(modalProduto, false));

  const modalSabores = $("#flavor-modal");
  $("#flavor-one")?.addEventListener("click", escolherUmSabor);
  $("#flavor-two")?.addEventListener("click", mostrarSegundoSabor);
  $("#flavor-cancel")?.addEventListener("click", fecharEscolhaSabores);
  ligarModal(modalSabores, fecharEscolhaSabores);

  /* Revalida o cupom quando o carrinho muda: um cupom com pedido minimo deixa
   * de valer se o cliente tirar itens, e o total tem que refletir na hora. */
  let timerCupom = null;
  window.addEventListener("baixok:carrinho", () => {
    clearTimeout(timerCupom);
    const { subtotal } = desenharCarrinhoEResumo();
    timerCupom = setTimeout(async () => {
      await revalidarCupom(subtotal, $("#customer-phone")?.value.trim());
      desenharCarrinhoEResumo();
    }, 250);
  });
}

/* Tela cheia, independente de qualquer elemento existir ou nao no resto da
 * pagina — se algo no boot falhar ANTES do primeiro desenho de verdade, o
 * cliente via de regra so via o fundo escuro do body sem nada em cima
 * ("tela preta"), sem entender se o site caiu, se o pedido dele sumiu ou se
 * era so pra esperar. Isso aconteceu de verdade num soluco de rede do host
 * (ver postgres.js/podeTentarDeNovo) — o problema de fundo e de fora, mas a
 * tela em branco em cima dele e nossa de resolver. */
function mostrarTelaDeFalha() {
  if ($("#erro-inicial")) return;
  /* Estilo INLINE de proposito, sem depender de nenhuma classe do CSS
   * principal: esta tela e o ultimo recurso quando o boot falhou, e o
   * proprio motivo do boot ter falhado (rede ruim) pode ser o mesmo que
   * atrapalhou o carregamento da folha de estilo. Sem cor/fundo explicitos
   * aqui, o texto ficaria escuro sobre o fundo escuro do body — legivel em
   * lugar nenhum. */
  document.body.append(
    el("div", {
      id: "erro-inicial",
      style: {
        position: "fixed", inset: "0", zIndex: "99999",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "14px", padding: "28px", textAlign: "center",
        background: "#17120e", color: "#f7eadb",
        fontFamily: "Arial, Helvetica, sans-serif"
      }
    },
      el("strong", { style: { fontSize: "1.1rem" } }, "Não foi possível abrir o cardápio agora"),
      el("p", { style: { margin: "0", maxWidth: "320px", color: "#d8c7b7", fontSize: ".92rem", lineHeight: "1.4" } },
        "Pode ser uma instabilidade passageira na internet. Tente de novo em alguns segundos."),
      el("button", {
        type: "button",
        onclick: () => location.reload(),
        style: {
          marginTop: "6px", padding: "12px 22px", border: "0", borderRadius: "999px",
          background: "#e0a66d", color: "#1b120c", fontWeight: "800", fontSize: ".95rem", cursor: "pointer"
        }
      }, "Tentar de novo")
    )
  );
}

// ------------------------------------------------------------------ inicio ---
async function iniciar() {
  try {
    const numeroMesa = mesaDaUrl();
    if (numeroMesa) iniciarModoMesa(numeroMesa);

    ligarEventos();
    atualizarCampoTroco();
    await carregarCardapio();
    redesenhar();

    if (numeroMesa) await atualizarMesa();
    else {
      estado.modalidade = "retirada";
      $("#mode-retirada")?.classList.add("active");
      $("#mode-entrega")?.classList.remove("active");
      if ($("#pickup-banner")) $("#pickup-banner").textContent = "RETIRADA";
      mostrar($("#place-label"), false);
    }

    /* Canal publico: o cliente so e avisado de mudanca no cardapio e nas
     * mesas. Nada da fila da cozinha chega aqui. */
    conectarEventos({
      canal: "publico",
      aoMudar: async assunto => {
        try {
          if (["produtos", "promocoes", "entrega", "caixa", "retomada", "desconhecido"].includes(assunto)) {
            await carregarCardapio();
            redesenhar();
          }
          if (["mesas", "pedidos", "retomada", "desconhecido"].includes(assunto) && sessaoMesa.n) {
            await atualizarMesa();
          }
        } catch (erro) {
          /* A pagina ja estava de pe quando isto rodou (nao e o boot inicial)
           * — nao vale apagar tudo que a pessoa ja via so por causa de uma
           * atualizacao que falhou. So avisa e segue com o que ja estava na
           * tela. */
          toastFalha(erro, "Atualização");
        }
      }
    });

    registrarPwa();
  } catch (erro) {
    mostrarTelaDeFalha();
    toastFalha(erro, "Cardápio");
  }
}

/* O store avisa por evento no window para o resto da pagina nao precisar
 * conhecer o formato interno dele. */
aoMudarCarrinho(() => window.dispatchEvent(new Event("baixok:carrinho")));

iniciar();
