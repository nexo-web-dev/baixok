/* Painel interno.
 *
 * O que este arquivo faz de diferente do app.js antigo:
 *
 * - Nao ha modo offline. Sem servidor, o painel avisa e para; nao cai para um
 *   banco local que funcionava sem senha nenhuma.
 * - As abas visiveis dependem do papel de quem entrou.
 * - Cada area se redesenha sozinha quando o servidor avisa que ela mudou, em
 *   vez de tudo recarregar a cada evento. */
import "../../styles/admin.css";
import { $, $$, delegar, mostrar, ligarModal } from "../../utils/dom.js";
import { toast, toastFalha } from "../../components/toast.js";
import { apiAuth } from "../../services/api.js";
import { definirTratamentoDeSessao } from "../../services/http.js";
import { conectarEventos } from "../../services/realtime.js";
import { fecharQrMesa } from "../../components/qr-mesa.js";
import { estado, carregar, marcarConexao } from "./store.js";
import { ABAS, abaInicial, podeVer } from "./abas.js";
import { ligarVendaManual } from "./venda-manual.js";

/* Pedidos, motoboy e o status do caixa ficam no pacote principal: sao os que
 * praticamente toda sessao usa assim que loga (a fila de pedidos e a aba
 * inicial de quase todo mundo, e o rastreamento do motoboy roda sozinho em
 * segundo plano). As outras abas so baixam o proprio codigo quando a pessoa
 * clica nelas pela primeira vez — antes disso, nem chegam a trafegar. */
import { desenharPedidos, ligarPedidos } from "./tabs/pedidos.js";
import { desenharMotoboy, ligarMotoboy, iniciarRastreamentoMotoboy, garantirNomeMotoboy } from "./tabs/motoboy.js";
import { desenharCaixaStatus, desenharFechamentos, ligarFechamentos } from "./tabs/fechamentos.js";

let abaAtual = null;
let monitorPedidosPronto = false;
let idsPedidosConhecidos = new Set();

/* Guarda o modulo depois do primeiro import() (import repetido do mesmo
 * caminho resolve do cache do navegador/bundler, mas ainda assim evita o
 * round-trip da promise) e se o `ligar()` da aba ja rodou — isso so pode
 * acontecer uma vez, senao os listeners delegados duplicariam. */
const modulosAba = {};
const abasLigadas = new Set();

async function moduloDaAba(chave, importar) {
  if (!modulosAba[chave]) modulosAba[chave] = await importar();
  return modulosAba[chave];
}

function abaPreguicosa(chave, importar, nomeLigar, ...nomesDesenhar) {
  return async () => {
    const mod = await moduloDaAba(chave, importar);
    if (!abasLigadas.has(chave)) {
      mod[nomeLigar]?.();
      abasLigadas.add(chave);
    }
    for (const nome of nomesDesenhar) await mod[nome]?.();
  };
}

/* Qual funcao redesenha cada aba, e o que ela precisa recarregar. */
const DESENHO = {
  pedidos: async () => {
    desenharPedidos();
    desenharCaixaStatus().catch(() => {});
  },
  motoboy: desenharMotoboy,
  mesas: abaPreguicosa("mesas", () => import("./tabs/mesas.js"), "ligarMesas", "desenharMesas"),
  produtos: abaPreguicosa("produtos", () => import("./tabs/produtos.js"), "ligarProdutos", "desenharProdutos"),
  cmv: abaPreguicosa("cmv", () => import("./tabs/cmv.js"), "ligarCmv", "desenharCmv"),
  combos: abaPreguicosa("combos", () => import("./tabs/combos.js"), "ligarCombos", "desenharCombos"),
  promos: abaPreguicosa("promos", () => import("./tabs/promocoes.js"), "ligarPromocoes", "desenharPromocoes", "desenharCupons"),
  entrega: abaPreguicosa("entrega", () => import("./tabs/entrega.js"), "ligarEntrega", "desenharEntrega"),
  estoque: abaPreguicosa("estoque", () => import("./tabs/estoque.js"), "ligarEstoque", "desenharEstoque"),
  dashboard: abaPreguicosa("dashboard", () => import("./tabs/dashboard.js"), "ligarDashboard", "desenharDashboard"),
  fechamentos: desenharFechamentos,
  plano: abaPreguicosa("plano", () => import("./tabs/plano.js"), "ligarPlano", "desenharPlano"),
  usuarios: abaPreguicosa("usuarios", () => import("./tabs/equipe.js"), "ligarEquipe", "desenharEquipe")
};

/* Que abas cada assunto do SSE afeta. Sem este mapa voltariamos ao
 * comportamento antigo: qualquer alteracao redesenhava o sistema inteiro. */
const AFETADAS = {
  pedidos: ["pedidos", "motoboy", "mesas", "dashboard"],
  produtos: ["produtos", "estoque", "promos", "combos", "dashboard", "cmv"],
  insumos: ["estoque"],
  promocoes: ["promos", "produtos"],
  cupons: ["promos"],
  mesas: ["mesas"],
  entrega: ["entrega"],
  caixa: ["pedidos", "dashboard", "fechamentos"],
  retomada: ["pedidos", "mesas"]
};

const DEPENDENCIAS_ABA = {
  /* combos entra aqui pra "Adicionar item ao pedido" (no detalhe do pedido)
   * conseguir buscar combo tambem, nao so produto avulso. */
  pedidos: ["pedidos", "caixa", "ajustes", "combos"],
  motoboy: [],
  mesas: ["mesas", "produtos", "ajustes"],
  /* insumos entra aqui (e nao so em estoque) porque a ficha tecnica do
   * produto — de onde sai o CMV — escolhe insumo num select nesta tela. */
  produtos: ["produtos", "promocoes"],
  cmv: ["produtos"],
  combos: ["produtos", "combos", "combinacoesSabores"],
  promos: ["produtos", "promocoes", "cupons"],
  entrega: ["entrega"],
  estoque: ["produtos", "insumos"],
  dashboard: ["produtos"],
  fechamentos: ["fechamentos"],
  plano: ["ajustes"],
  usuarios: []
};

function areasIniciais(usuario) {
  return podeVer("pedidos", usuario) ? ["pedidos", "caixa"] : [];
}

function armarMonitorPedidos() {
  idsPedidosConhecidos = new Set(estado.pedidos.map(pedido => pedido.id));
  monitorPedidosPronto = true;
}

function avisarPedidosNovos() {
  if (!monitorPedidosPronto) {
    armarMonitorPedidos();
    return;
  }

  const novos = estado.pedidos.filter(pedido =>
    pedido.status === "novo" && !idsPedidosConhecidos.has(pedido.id)
  );
  idsPedidosConhecidos = new Set(estado.pedidos.map(pedido => pedido.id));

  if (!novos.length) return;
  const pedido = novos[0];
  const codigo = String(pedido.id).slice(-3).toUpperCase();
  const origemMesa = pedido.fulfillment === "mesa" && pedido.tableNumber
    ? `Mesa ${pedido.tableNumber}`
    : pedido.customer || "Cliente";
  toast(novos.length === 1
    ? `${origemMesa} enviou o pedido ${codigo}. A comanda abriu automaticamente.`
    : `${novos.length} novos pedidos recebidos.`,
    { tipo: "alerta", duracao: 7000 });
}

// ------------------------------------------------------------------- sessao ---
definirTratamentoDeSessao(() => {
  location.replace("/entrar.html?de=%2Fadmin.html");
});

// --------------------------------------------------------------------- abas ---
function montarMenu(usuario) {
  const nav = $("#nav-list");

  for (const botao of $$("[data-tab]", nav)) {
    mostrar(botao, podeVer(botao.dataset.tab, usuario));
  }
}

async function abrirAba(chave) {
  const usuario = estado.usuario;
  if (!podeVer(chave, usuario)) return;

  abaAtual = chave;
  for (const secao of $$(".admin-tab")) mostrar(secao, secao.id === `tab-${chave}`);
  for (const botao of $$("[data-tab]")) botao.classList.toggle("active", botao.dataset.tab === chave);

  $("#page-title").textContent = ABAS[chave].titulo;
  $("#page-sub").textContent = ABAS[chave].subtitulo;

  /* Guarda a aba na URL: recarregar a pagina (ou o F5 do tablet) volta para
   * onde a pessoa estava, em vez de sempre cair na fila. */
  history.replaceState(null, "", `#${chave}`);

  const dependencias = DEPENDENCIAS_ABA[chave] || [];
  if (dependencias.length) await carregar(...dependencias);
  await DESENHO[chave]?.();
}

// ------------------------------------------------------------------ metricas ---
function desenharMetricas() {
  const alvo = $("#mini-metrics");
  if (!alvo) return;

  const { porStatus = {} } = estado.resumo;
  alvo.replaceChildren();

  const cartoes = [
    ["Novos", porStatus.novo || 0, (porStatus.novo || 0) > 0 ? "alert-copper" : ""],
    ["Em preparo", porStatus.preparo || 0, ""],
    ["Prontos", porStatus.pronto || 0, ""]
  ];

  for (const [rotulo, valor, tom] of cartoes) {
    const cartao = document.createElement("div");
    cartao.className = `mini-metric ${tom}`;
    const nome = document.createElement("span");
    nome.textContent = rotulo;
    const numero = document.createElement("strong");
    numero.textContent = String(valor);
    cartao.append(nome, numero);
    alvo.append(cartao);
  }
}

// ------------------------------------------------------------------- ligacao ---
function ligarShell() {
  delegar($("#nav-list"), "click", "[data-tab]", (_e, botao) => abrirAba(botao.dataset.tab));

  $("#sair")?.addEventListener("click", async () => {
    try { await apiAuth.sair(); } catch { /* segue para o login de qualquer forma */ }
    location.replace("/entrar.html");
  });

  const suporte = $("#support-modal");
  $("#abrir-suporte")?.addEventListener("click", () => mostrar(suporte, true));
  $("#fechar-suporte")?.addEventListener("click", () => mostrar(suporte, false));
  ligarModal(suporte, () => mostrar(suporte, false));

  const qr = $("#qr-modal");
  $("#qr-close")?.addEventListener("click", fecharQrMesa);
  ligarModal(qr, fecharQrMesa);

  ligarPedidos();
  ligarMotoboy();
  ligarFechamentos();
  ligarVendaManual();
}

// -------------------------------------------------------------------- inicio ---
async function iniciar() {
  let sessao;
  try {
    sessao = await apiAuth.eu();
  } catch {
    marcarConexao(false);
    toastFalha({ codigo: "offline" }, "Servidor");
    return;
  }

  if (!sessao.autenticado) {
    location.replace("/entrar.html?de=%2Fadmin.html");
    return;
  }

  estado.usuario = sessao.usuario;
  $("#usuario-nome").textContent = sessao.usuario.nome;
  $("#usuario-papel").textContent = { admin: "Administrador", caixa: "Caixa", cozinha: "Cozinha", entregador: "Entregador" }[sessao.usuario.papel];
  garantirNomeMotoboy();
  iniciarRastreamentoMotoboy();
  /* So quem tem a aba "Plano do sistema" (admin, ver abas.js) precisa saber
   * que a mensalidade esta vencendo — importa o modulo so nesse caso, sem
   * puxar pro pacote principal o codigo de quem nunca ve essa aba. */
  if (sessao.usuario.papel === "admin") {
    import("./tabs/plano.js").then(mod => mod.verificarAlertaVencimento()).catch(() => {});
  }

  montarMenu(sessao.usuario);
  ligarShell();

  await abrirAba(abaInicial(sessao.usuario));
  armarMonitorPedidos();

  carregar(...areasIniciais(sessao.usuario)).then(async () => {
    desenharMetricas();
    if (abaAtual === "pedidos") await DESENHO.pedidos?.();
  });

  conectarEventos({
    canal: "operacao",
    aoMudar: async assunto => {
      const areas = {
        pedidos: ["pedidos", "mesas", "caixa"],
        produtos: ["produtos", "combos", "combinacoesSabores"],
        insumos: ["insumos"],
        promocoes: ["promocoes"],
        cupons: ["cupons"],
        mesas: ["mesas"],
        entrega: ["entrega"],
        caixa: ["caixa", "fechamentos"],
        retomada: ["pedidos", "mesas", "caixa"]
      }[assunto];
      await carregar(...(areas || []));
      if (assunto === "pedidos") avisarPedidosNovos();
      /* So existe rascunho pra atualizar se a aba de entrega ja foi aberta
       * (e o modulo dela, baixado) nesta sessao. */
      if (assunto === "entrega") modulosAba.entrega?.recarregarRascunhoEntrega?.();
      desenharMetricas();
      if (assunto === "caixa") await desenharCaixaStatus();

      const afetadas = AFETADAS[assunto] || Object.keys(DESENHO);
      if (afetadas.includes(abaAtual)) await DESENHO[abaAtual]?.();
    },
    aoStatus: online => marcarConexao(online === "conectado")
  });

  /* O tempo de espera nos cartoes envelhece sozinho, sem evento nenhum do
   * servidor: um pedido parado ha 20 minutos precisa mudar de cor. */
  setInterval(() => {
    if (abaAtual === "pedidos") desenharPedidos();
  }, 30000);
}

iniciar();
