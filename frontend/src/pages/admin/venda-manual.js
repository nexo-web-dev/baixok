/* Lancamento manual: balcao, iFood, WhatsApp ou pedido na mesa.
 *
 * O carrinho e montado com id e quantidade. O preco mostrado aqui e o do
 * cardapio carregado; quem precifica de verdade e o servidor, igual ao pedido
 * do cliente. Nao ha campo de preco livre de proposito: teria virado o caminho
 * mais facil para lancar venda com valor errado sem deixar rastro. */
import { el, render, $, delegar, mostrar, ligarModal, debounce } from "../../utils/dom.js";
import { reais } from "../../utils/formato.js";
import { CANAIS_ROTULO, MODALIDADES_ROTULO, rotuloCategoria } from "../../utils/categorias.js";
import { controlaEstoqueCategoria } from "../../utils/estoque.js";
import { apiPedidos, apiPublica } from "../../services/api.js";
import { estado, carregar, precoEfetivo } from "./store.js";
import { toast, toastFalha } from "../../components/toast.js";
import { desenharPedidos } from "./tabs/pedidos.js";

const PAGAMENTOS = ["Dinheiro", "Pix", "Cartão de Crédito", "Cartão de Débito"];

const rascunho = {
  itens: [], canal: "loja", pagamento: "Dinheiro", modalidade: "retirada", mesa: null,
  cortesia: false, cortesiaMotivo: ""
};
let aoConcluir = null;

const normalizarBusca = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

/* Cotacao de entrega e so previa: quem manda de verdade e o servidor, na hora
 * de registrar (mesma regra do cardapio do cliente). */
let cotacaoManual = null;
let timerBuscaManual = null;
let requisicaoBuscaManual = null;

/* Chave que identifica uma linha do carrinho — comboId, id+id2 (pizza de 2
 * sabores) ou so id, nunca mais de um preenchido ao mesmo tempo. id2 entra na
 * chave pra uma pizza meio-a-meio nao se confundir com o sabor avulso, que
 * usa o mesmo id de produto. */
const chaveItem = item => item.comboId || (item.id2 ? `${item.id}+${item.id2}` : item.id);

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

/* Mesma prioridade de categoria do cardapio do cliente (ver pesoCategoria em
 * pages/menu/catalogo.js) — nao importa de la porque e um modulo do
 * cardapio publico, entao replica local, so a ordenacao mesmo. */
const ORDEM_CATEGORIA_MANUAL = ["burg", "pizza", "por", "bebid", "drink"];
function pesoCategoriaManual(chave, rotulo) {
  const alvo = normalizarBusca(`${chave} ${rotulo}`);
  if (alvo.includes("combo")) return 100;
  const indice = ORDEM_CATEGORIA_MANUAL.findIndex(termo => alvo.includes(termo));
  return indice === -1 ? 50 : indice;
}

let categoriaManual = "todos";

/* Combo entra na mesma busca de produto avulso — sem estoque proprio (quem
 * controla e cada produto componente, ver precificar() no backend). Pizza de
 * 2 sabores herda a categoria do primeiro sabor (sempre pizza, ja que so
 * sabor de pizza entra em combinacao — ver exigirSaborPizza no backend). */
function desenharProdutos() {
  const termo = normalizarBusca($("#manual-search")?.value).trim();
  const produtosOk = estado.produtos
    .filter(produto => produto.active && (!controlaEstoqueCategoria(produto.category) || produto.stock > 0))
    .map(produto => ({
      tipo: "produto", id: produto.id, name: produto.name, image: produto.image || "",
      price: precoEfetivo(produto), categoria: produto.category,
      legenda: `${rotuloCategoria(produto.category)} · ${controlaEstoqueCategoria(produto.category)
        ? `${produto.stock} em estoque`
        : "sem controle de estoque"}`
    }));
  const combosOk = (estado.combos || [])
    .filter(combo => combo.active)
    .map(combo => ({
      tipo: "combo", id: combo.id, name: combo.name, image: combo.image || "",
      price: Number(combo.price), categoria: "combos", legenda: "Combo"
    }));
  const combinacoesOk = (estado.combinacoesSabores || []).map(combinacao => ({
    tipo: "combinacao", produtoAId: combinacao.produtoAId, produtoBId: combinacao.produtoBId,
    name: `Pizza 1/2 ${combinacao.nomeA} + 1/2 ${combinacao.nomeB}`, image: "",
    price: Number(combinacao.preco), legenda: "Pizza 2 sabores",
    categoria: estado.produtos.find(produto => produto.id === combinacao.produtoAId)?.category || "combos"
  }));

  const todosItens = [...produtosOk, ...combosOk, ...combinacoesOk];

  const categorias = new Map();
  for (const item of todosItens) {
    const categoria = String(item.categoria || "").trim();
    if (categoria && !categorias.has(categoria)) categorias.set(categoria, rotuloCategoria(categoria));
  }
  const categoriasOrdenadas = [...categorias.entries()].sort(([chaveA, rotuloA], [chaveB, rotuloB]) =>
    pesoCategoriaManual(chaveA, rotuloA) - pesoCategoriaManual(chaveB, rotuloB));
  if (categoriaManual !== "todos" && !categorias.has(categoriaManual)) categoriaManual = "todos";

  render($("#manual-category-filter"), ...[["todos", "Todos"], ...categoriasOrdenadas].map(([categoria, rotulo]) =>
    el("button.chip", {
      type: "button",
      class: categoriaManual === categoria ? "active" : "",
      dataset: { acao: "categoria-manual", categoria }
    }, rotulo)
  ));

  const lista = todosItens
    .filter(item => categoriaManual === "todos" || item.categoria === categoriaManual)
    .filter(item => !termo || normalizarBusca(`${item.name} ${item.legenda}`).includes(termo))
    .slice(0, 40);

  render($("#manual-products"), ...(lista.length
    ? lista.map(item =>
        el("button.manual-product", {
          type: "button",
          dataset: item.tipo === "combo" ? { acao: "add-item", comboId: item.id }
            : item.tipo === "combinacao" ? { acao: "add-item", produtoAId: item.produtoAId, produtoBId: item.produtoBId }
            : { acao: "add-item", id: item.id }
        },
          item.image
            ? el("img.manual-thumb", { src: item.image, alt: "", loading: "lazy", decoding: "async" })
            : el("span.manual-thumb.no-photo", {}, "Sem foto"),
          el("span.manual-name", {}, item.name),
          el("span.manual-price", {}, reais(item.price)),
          el("small", {}, item.legenda)
        ))
    : [el("p.faint", {}, "Nenhum produto encontrado.")]));
}

function desenharCarrinho() {
  const total = subtotal() + freteManual();
  const trocoPara = normalizarTroco($("#manual-change-for")?.value);
  const mostrarTroco = rascunho.pagamento === "Dinheiro" && rascunho.mesa === null && Boolean(trocoPara);

  render($("#manual-cart"), ...(rascunho.itens.length
    ? [
        ...rascunho.itens.map(item =>
          el("div.manual-line", {},
            item.image
              ? el("img.manual-thumb", { src: item.image, alt: "", loading: "lazy", decoding: "async" })
              : el("span.manual-thumb.no-photo", {}, "Sem foto"),
            el("span", {}, `${item.qty}x ${item.name}`),
            el("span", {}, reais(item.price * item.qty)),
            el("div.qty-actions", {},
              el("button", { type: "button", dataset: { acao: "qtd", id: chaveItem(item), delta: "-1" } }, "-"),
              el("button", { type: "button", dataset: { acao: "qtd", id: chaveItem(item), delta: "1" } }, "+")
            )
          )),
        freteManual() > 0
          ? el("div.manual-total", {}, el("span", {}, "Taxa de entrega"), el("strong", {}, reais(freteManual())))
          : null,
        el("div.manual-total", {}, el("span", {}, "Total"), el("strong", {}, reais(total))),
        mostrarTroco
          ? el("div.manual-total change", {},
              el("span", {}, `Troco para ${reais(trocoPara)}`),
              el("strong", {}, `Devolver ${reais(Math.max(0, trocoPara - total))}`)
            )
          : null
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
  if (!estado.produtos.length) {
    try { await carregar("produtos"); } catch { /* o formulario abre e mostra erro se continuar vazio */ }
  }
  if (!estado.combos.length) {
    try { await carregar("combos"); } catch { /* combo so nao aparece na busca, resto do formulario funciona */ }
  }
  if (!estado.combinacoesSabores.length) {
    try { await carregar("combinacoesSabores"); } catch { /* pizza de 2 sabores so nao aparece na busca */ }
  }

  rascunho.itens = [];
  rascunho.mesa = mesa;
  rascunho.canal = mesa === null ? "loja" : "loja";
  rascunho.pagamento = "Dinheiro";
  rascunho.modalidade = mesa === null ? "retirada" : "mesa";
  rascunho.cortesia = false;
  rascunho.cortesiaMotivo = "";
  categoriaManual = "todos";
  aoConcluir = callback;

  $("#manual-title").textContent = mesa ? `Lançar pedido na mesa ${mesa}` : "Lançar pedido manual";
  $("#manual-customer").value = "";
  if ($("#manual-phone")) $("#manual-phone").value = "";
  if ($("#manual-address")) $("#manual-address").value = "";
  if ($("#manual-change-for")) $("#manual-change-for").value = "";
  if ($("#manual-cortesia")) $("#manual-cortesia").checked = false;
  if ($("#manual-cortesia-motivo")) $("#manual-cortesia-motivo").value = "";
  mostrar($("#manual-cortesia-motivo-field"), false);
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
  if (rascunho.cortesia && !rascunho.cortesiaMotivo.trim()) {
    return definirErro("Informe o motivo da cortesia.");
  }
  const corpo = {
    items: rascunho.itens.map(item => item.comboId
      ? { comboId: item.comboId, qty: item.qty }
      : item.id2
        ? { id: item.id, id2: item.id2, qty: item.qty }
        : { id: item.id, qty: item.qty }),
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
    let pedido;
    try {
      ({ pedido } = await apiPedidos.criarManual(corpo, { sinal: controle.signal }));
    } finally {
      clearTimeout(tempo);
    }

    if (rascunho.cortesia) {
      try {
        await apiPedidos.definirCortesia(pedido.id, { todoPedido: true, itemIds: [], motivo: rascunho.cortesiaMotivo.trim() });
      } catch (erro) {
        toastFalha(erro, "O pedido foi lançado, mas marcar como cortesia falhou. Marque pelo detalhe do pedido");
      }
    }

    await carregar("pedidos", "produtos", "mesas");
    /* Nao dependia de nada alem do SSE pra redesenhar o kanban — quando a
     * conexao de eventos ficava lenta ou caia (rede/CDN instavel), o pedido
     * era criado normalmente mas so aparecia depois de um F5. Redesenha aqui
     * na hora, sem depender do aviso em tempo real chegar de volta. */
    desenharPedidos();
    if (rascunho.mesa) {
      import("./tabs/mesas.js").then(mod => mod.desenharMesas?.()).catch(() => {});
    }
    fecharVendaManual();
    toast(rascunho.mesa
      ? `Pedido lançado na mesa ${rascunho.mesa}.`
      : rascunho.cortesia ? "Venda registrada como cortesia." : "Venda registrada na fila.");
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
  $("#manual-search")?.addEventListener("input", debounce(desenharProdutos));
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
  delegar(modal, "click", "[data-acao='categoria-manual']", (_e, botao) => {
    categoriaManual = botao.dataset.categoria;
    desenharProdutos();
  });

  $("#manual-change-for")?.addEventListener("input", () => {
    if (rascunho.pagamento === "Dinheiro") definirErro("");
    desenharCarrinho();
  });

  $("#manual-cortesia")?.addEventListener("change", e => {
    rascunho.cortesia = e.target.checked;
    if (!rascunho.cortesia) {
      rascunho.cortesiaMotivo = "";
      if ($("#manual-cortesia-motivo")) $("#manual-cortesia-motivo").value = "";
    }
    mostrar($("#manual-cortesia-motivo-field"), rascunho.cortesia);
    definirErro("");
  });
  $("#manual-cortesia-motivo")?.addEventListener("input", e => {
    rascunho.cortesiaMotivo = e.target.value;
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
    if (botao.dataset.comboId) {
      const combo = (estado.combos || []).find(item => item.id === botao.dataset.comboId);
      if (!combo) return;
      const existente = rascunho.itens.find(item => item.comboId === combo.id);
      if (existente) existente.qty += 1;
      else rascunho.itens.push({
        id: null, comboId: combo.id, name: combo.name, image: combo.image || "", price: Number(combo.price), qty: 1
      });
      definirErro("");
      desenharCarrinho();
      return;
    }

    if (botao.dataset.produtoAId) {
      const { produtoAId, produtoBId } = botao.dataset;
      const combinacao = (estado.combinacoesSabores || [])
        .find(item => item.produtoAId === produtoAId && item.produtoBId === produtoBId);
      if (!combinacao) return;
      const existente = rascunho.itens.find(item => item.id === produtoAId && item.id2 === produtoBId);
      if (existente) existente.qty += 1;
      else rascunho.itens.push({
        id: produtoAId, id2: produtoBId, comboId: null,
        name: `Pizza 1/2 ${combinacao.nomeA} + 1/2 ${combinacao.nomeB}`, image: "",
        price: Number(combinacao.preco), qty: 1
      });
      definirErro("");
      desenharCarrinho();
      return;
    }

    const produto = estado.produtos.find(item => item.id === botao.dataset.id);
    if (!produto) return;
    const controlaEstoque = controlaEstoqueCategoria(produto.category);
    const existente = rascunho.itens.find(item => chaveItem(item) === produto.id);
    if (existente) {
      if (controlaEstoque && existente.qty >= produto.stock) return definirErro(`${produto.name}: restam ${produto.stock} em estoque.`);
      existente.qty += 1;
    } else {
      rascunho.itens.push({
        id: produto.id, comboId: null, name: produto.name, image: produto.image || "", price: precoEfetivo(produto), qty: 1
      });
    }
    definirErro("");
    desenharCarrinho();
  });

  delegar(modal, "click", "[data-acao='qtd']", (_e, botao) => {
    const item = rascunho.itens.find(linha => chaveItem(linha) === botao.dataset.id);
    if (!item) return;
    item.qty += Number(botao.dataset.delta);
    if (item.qty <= 0) rascunho.itens = rascunho.itens.filter(linha => chaveItem(linha) !== chaveItem(item));
    desenharCarrinho();
  });
}
