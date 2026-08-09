/* Lancamento manual: balcao, iFood, WhatsApp ou pedido na mesa.
 *
 * O carrinho e montado com id e quantidade. O preco mostrado aqui e o do
 * cardapio carregado; quem precifica de verdade e o servidor, igual ao pedido
 * do cliente. Nao ha campo de preco livre de proposito: teria virado o caminho
 * mais facil para lancar venda com valor errado sem deixar rastro. */
import { el, render, $, delegar, mostrar, ligarModal } from "../../utils/dom.js";
import { reais } from "../../utils/formato.js";
import { CANAIS_ROTULO, MODALIDADES_ROTULO } from "../../utils/categorias.js";
import { apiPedidos, apiPublica } from "../../services/api.js";
import { estado, carregar, precoEfetivo } from "./store.js";
import { toast, toastFalha } from "../../components/toast.js";

const PAGAMENTOS = ["Dinheiro", "Pix", "Cartão", "Online"];

const rascunho = { itens: [], canal: "loja", pagamento: "Dinheiro", modalidade: "retirada", mesa: null };
let aoConcluir = null;

/* Cotacao de entrega e so previa: quem manda de verdade e o servidor, na hora
 * de registrar (mesma regra do cardapio do cliente). */
let cotacaoManual = null;
let timerBuscaManual = null;
let requisicaoBuscaManual = null;

const subtotal = () => rascunho.itens.reduce((soma, item) => soma + item.price * item.qty, 0);
const freteManual = () => rascunho.modalidade === "entrega" && cotacaoManual?.dentro ? Number(cotacaoManual.taxa) : 0;

function limparCotacaoManual() {
  cotacaoManual = null;
  const aviso = $("#manual-entrega-aviso");
  if (aviso) mostrar(aviso, false);
  render($("#manual-address-sugestoes"));
}

function descreverCotacaoManual(resultado) {
  if (!resultado?.configurado) return "";
  if (!resultado.dentro) return `Esse endereço está a ${resultado.km} km da loja, fora da área de entrega.`;
  const minimo = resultado.minimo ? ` · pedido mínimo ${reais(resultado.minimo)}` : "";
  return `Entrega ${resultado.zona} · taxa ${reais(resultado.taxa)}${minimo}`;
}

async function cotarManual(params) {
  try {
    cotacaoManual = await apiPublica.cotarEntrega(params);
  } catch {
    cotacaoManual = null;
  }
  const aviso = $("#manual-entrega-aviso");
  if (aviso) {
    aviso.textContent = descreverCotacaoManual(cotacaoManual);
    aviso.className = `entrega-aviso ${cotacaoManual?.dentro ? "ok" : "erro"}`;
    mostrar(aviso, Boolean(aviso.textContent));
  }
  desenharCarrinho();
}

function buscarEnderecoManual(termo) {
  clearTimeout(timerBuscaManual);
  requisicaoBuscaManual?.abort();

  const alvo = $("#manual-address-sugestoes");
  if (!alvo) return;

  if (termo.trim().length < 3) {
    render(alvo);
    limparCotacaoManual();
    return;
  }

  timerBuscaManual = setTimeout(async () => {
    const controle = new AbortController();
    requisicaoBuscaManual = controle;
    try {
      const { resultados } = await apiPublica.buscarEndereco(termo.trim(), { sinal: controle.signal });
      render(alvo, ...resultados.map(item =>
        el("button.sugestao", {
          type: "button",
          dataset: { acao: "escolher-endereco-manual", lng: String(item.lng), lat: String(item.lat), texto: `${item.nome}${item.detalhe ? `, ${item.detalhe}` : ""}` }
        },
          el("strong", {}, item.nome),
          el("span", {}, item.detalhe || "")
        )
      ));
    } catch (erro) {
      if (erro.name !== "AbortError") render(alvo);
    } finally {
      requisicaoBuscaManual = null;
    }
  }, 350);
}

async function escolherEnderecoManual({ texto, lng, lat }) {
  const campo = $("#manual-address");
  if (campo) campo.value = texto;
  render($("#manual-address-sugestoes"));
  await cotarManual({ q: texto, lng, lat });
}

function normalizarTroco(valor) {
  const numero = Number(String(valor ?? "").replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function definirErro(mensagem) {
  const alvo = $("#manual-error");
  alvo.textContent = mensagem || "";
  mostrar(alvo, Boolean(mensagem));
}

function desenharChips() {
  /* Na mesa o canal e sempre "loja": nao faz sentido lancar um pedido de mesa
   * como iFood. */
  const canais = $("#manual-channels");
  mostrar(canais, rascunho.mesa === null);
  if (rascunho.mesa === null) {
    render(canais, ...Object.entries(CANAIS_ROTULO)
      .filter(([chave]) => chave !== "cardapio")
      .map(([chave, rotulo]) =>
        el("button.chip", {
          type: "button",
          class: rascunho.canal === chave ? "active" : "",
          dataset: { acao: "canal", canal: chave }
        }, rotulo)
      ));
  }

  const secaoModalidade = $("#manual-fulfillment-section");
  mostrar(secaoModalidade, rascunho.mesa === null);
  if (rascunho.mesa === null) {
    render($("#manual-fulfillment"), ...["retirada", "entrega"].map(chave =>
      el("button.chip", {
        type: "button",
        class: rascunho.modalidade === chave ? "active" : "",
        dataset: { acao: "modalidade", modalidade: chave }
      }, MODALIDADES_ROTULO[chave])
    ));
  }
  const entregaManual = rascunho.mesa === null && rascunho.modalidade === "entrega";
  mostrar($("#manual-delivery-fields"), entregaManual);
  if (!entregaManual) {
    if ($("#manual-phone")) $("#manual-phone").value = "";
    if ($("#manual-address")) $("#manual-address").value = "";
    limparCotacaoManual();
  }

  render($("#manual-payments"), ...PAGAMENTOS.map(rotulo =>
    el("button.chip", {
      type: "button",
      class: rascunho.pagamento === rotulo ? "active" : "",
      dataset: { acao: "pagamento", pagamento: rotulo }
    }, rotulo)
  ));

  const mostraTroco = rascunho.pagamento === "Dinheiro" && rascunho.mesa === null;
  mostrar($("#manual-change-field"), mostraTroco);
  if (!mostraTroco && $("#manual-change-for")) $("#manual-change-for").value = "";
}

function desenharProdutos() {
  const termo = ($("#manual-search")?.value || "").trim().toLowerCase();
  const lista = estado.produtos
    .filter(produto => produto.active && produto.stock > 0)
    .filter(produto => !termo || produto.name.toLowerCase().includes(termo))
    .slice(0, 40);

  render($("#manual-products"), ...(lista.length
    ? lista.map(produto =>
        el("button.manual-product", { type: "button", dataset: { acao: "add-item", id: produto.id } },
          produto.image
            ? el("img.manual-thumb", { src: produto.image, alt: "", loading: "lazy" })
            : el("span.manual-thumb.no-photo", {}, "Sem foto"),
          el("span.manual-name", {}, produto.name),
          el("span.manual-price", {}, reais(precoEfetivo(produto))),
          el("small", {}, `${produto.stock} em estoque`)
        ))
    : [el("p.faint", {}, "Nenhum produto encontrado.")]));
}

function desenharCarrinho() {
  render($("#manual-cart"), ...(rascunho.itens.length
    ? [
        ...rascunho.itens.map(item =>
          el("div.manual-line", {},
            item.image
              ? el("img.manual-thumb", { src: item.image, alt: "", loading: "lazy" })
              : el("span.manual-thumb.no-photo", {}, "Sem foto"),
            el("span", {}, `${item.qty}x ${item.name}`),
            el("span", {}, reais(item.price * item.qty)),
            el("div.qty-actions", {},
              el("button", { type: "button", dataset: { acao: "qtd", id: item.id, delta: "-1" } }, "-"),
              el("button", { type: "button", dataset: { acao: "qtd", id: item.id, delta: "1" } }, "+")
            )
          )),
        freteManual() > 0
          ? el("div.manual-total", {}, el("span", {}, "Taxa de entrega"), el("strong", {}, reais(freteManual())))
          : null,
        el("div.manual-total", {}, el("span", {}, "Total"), el("strong", {}, reais(subtotal() + freteManual())))
      ]
    : [el("p.faint", {}, "Nenhum item adicionado.")]));

  const dica = $("#manual-hint");
  if (dica) {
    dica.textContent = rascunho.mesa
      ? `Este pedido entra na comanda da mesa ${rascunho.mesa}.`
      : "A venda entra na fila e soma no faturamento do dashboard.";
  }
}

function redesenhar() {
  desenharChips();
  desenharProdutos();
  desenharCarrinho();
}

export async function abrirVendaManual(mesa = null, callback = null) {
  if (!estado.caixaAtual) {
    try { await carregar("caixa"); } catch { /* o toast abaixo explica a acao necessaria */ }
  }
  if (!estado.caixaAtual) {
    toastFalha(new Error("Abra o caixa antes de registrar vendas."), "Caixa");
    return;
  }

  rascunho.itens = [];
  rascunho.mesa = mesa;
  rascunho.canal = mesa === null ? "loja" : "loja";
  rascunho.pagamento = "Dinheiro";
  rascunho.modalidade = mesa === null ? "retirada" : "mesa";
  aoConcluir = callback;

  $("#manual-title").textContent = mesa ? `Lançar pedido na mesa ${mesa}` : "Lançar pedido manual";
  $("#manual-customer").value = "";
  if ($("#manual-phone")) $("#manual-phone").value = "";
  if ($("#manual-address")) $("#manual-address").value = "";
  if ($("#manual-change-for")) $("#manual-change-for").value = "";
  $("#manual-search").value = "";
  limparCotacaoManual();
  definirErro("");
  redesenhar();
  mostrar($("#manual-modal"), true);
  $("#manual-search").focus();
}

export function fecharVendaManual() {
  mostrar($("#manual-modal"), false);
}

async function registrar() {
  if (!rascunho.itens.length) return definirErro("Adicione pelo menos um produto.");
  definirErro("");

  const nome = $("#manual-customer").value.trim();
  const telefone = $("#manual-phone")?.value.trim() || "";
  const endereco = $("#manual-address")?.value.trim() || "";
  const trocoPara = normalizarTroco($("#manual-change-for")?.value);
  if (rascunho.mesa === null && rascunho.modalidade === "entrega") {
    if (!telefone) return definirErro("Informe o telefone do cliente para entrega.");
    if (!endereco) return definirErro("Informe o endereço de entrega.");
  }
  if (rascunho.pagamento === "Dinheiro" && rascunho.mesa === null && !trocoPara) {
    return definirErro("Informe troco para quanto.");
  }
  const corpo = {
    items: rascunho.itens.map(item => ({ id: item.id, qty: item.qty })),
    customer: nome || (rascunho.mesa ? `Mesa ${rascunho.mesa}` : CANAIS_ROTULO[rascunho.canal]),
    phone: telefone,
    place: rascunho.mesa
      ? `Mesa ${rascunho.mesa} - salão`
      : rascunho.modalidade === "entrega" ? endereco : "Retirada",
    note: "",
    payment: rascunho.pagamento,
    trocoPara: rascunho.pagamento === "Dinheiro" && rascunho.mesa === null ? trocoPara : null,
    channel: rascunho.canal,
    fulfillment: rascunho.mesa ? "mesa" : rascunho.modalidade,
    tableNumber: rascunho.mesa
  };

  try {
    const controle = new AbortController();
    const tempo = setTimeout(() => controle.abort(new Error("timeout")), 20000);
    try {
      await apiPedidos.criarManual(corpo, { sinal: controle.signal });
    } finally {
      clearTimeout(tempo);
    }
    await carregar("pedidos", "produtos", "mesas");
    fecharVendaManual();
    toast(rascunho.mesa ? `Pedido lançado na mesa ${rascunho.mesa}.` : "Venda registrada na fila.");
    aoConcluir?.();
  } catch (erro) {
    definirErro(erro.message);
  }
}

export function ligarVendaManual() {
  const modal = $("#manual-modal");
  if (!modal) return;

  ligarModal(modal, fecharVendaManual);
  $("#manual-close")?.addEventListener("click", fecharVendaManual);
  $("#manual-save")?.addEventListener("click", registrar);
  $("#manual-search")?.addEventListener("input", desenharProdutos);
  $("#open-manual-sale")?.addEventListener("click", () => abrirVendaManual(null));

  delegar(modal, "click", "[data-acao='canal']", (_e, botao) => {
    rascunho.canal = botao.dataset.canal;
    desenharChips();
  });
  delegar(modal, "click", "[data-acao='pagamento']", (_e, botao) => {
    rascunho.pagamento = botao.dataset.pagamento;
    desenharChips();
  });
  delegar(modal, "click", "[data-acao='modalidade']", (_e, botao) => {
    rascunho.modalidade = botao.dataset.modalidade;
    desenharChips();
  });

  $("#manual-change-for")?.addEventListener("input", () => {
    if (rascunho.pagamento === "Dinheiro") definirErro("");
  });

  $("#manual-address")?.addEventListener("input", e => {
    cotacaoManual = null;
    buscarEnderecoManual(e.target.value);
  });
  delegar(modal, "click", "[data-acao='escolher-endereco-manual']", (_e, botao) => {
    const { texto, lng, lat } = botao.dataset;
    escolherEnderecoManual({ texto, lng: Number(lng), lat: Number(lat) });
  });

  delegar(modal, "click", "[data-acao='add-item']", (_e, botao) => {
    const produto = estado.produtos.find(item => item.id === botao.dataset.id);
    if (!produto) return;
    const existente = rascunho.itens.find(item => item.id === produto.id);
    if (existente) {
      if (existente.qty >= produto.stock) return definirErro(`${produto.name}: restam ${produto.stock} em estoque.`);
      existente.qty += 1;
    } else {
      rascunho.itens.push({ id: produto.id, name: produto.name, image: produto.image || "", price: precoEfetivo(produto), qty: 1 });
    }
    definirErro("");
    desenharCarrinho();
  });

  delegar(modal, "click", "[data-acao='qtd']", (_e, botao) => {
    const item = rascunho.itens.find(linha => linha.id === botao.dataset.id);
    if (!item) return;
    item.qty += Number(botao.dataset.delta);
    if (item.qty <= 0) rascunho.itens = rascunho.itens.filter(linha => linha.id !== item.id);
    desenharCarrinho();
  });
}
