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

import { desenharPedidos, ligarPedidos } from "./tabs/pedidos.js";
import { desenharMotoboy, ligarMotoboy, iniciarRastreamentoMotoboy } from "./tabs/motoboy.js";
import { desenharMesas, ligarMesas } from "./tabs/mesas.js";
import { desenharProdutos, ligarProdutos } from "./tabs/produtos.js";
import { desenharPromocoes, desenharCupons, ligarPromocoes } from "./tabs/promocoes.js";
import { desenharEntrega, ligarEntrega, recarregarRascunhoEntrega } from "./tabs/entrega.js";
import { desenharEstoque, ligarEstoque } from "./tabs/estoque.js";
import { desenharDashboard, ligarDashboard } from "./tabs/dashboard.js";
import { desenharEquipe as desenharUsuarios, ligarEquipe as ligarUsuarios } from "./tabs/equipe.js";
import { desenharPlano, ligarPlano } from "./tabs/plano.js";
import { desenharCaixaStatus, desenharFechamentos, ligarFechamentos } from "./tabs/fechamentos.js";

let abaAtual = null;

/* Qual funcao redesenha cada aba, e o que ela precisa recarregar. */
const DESENHO = {
  pedidos: async () => {
    desenharPedidos();
    desenharCaixaStatus().catch(() => {});
  },
  motoboy: desenharMotoboy,
  mesas: desenharMesas,
  produtos: desenharProdutos,
  promos: () => { desenharPromocoes(); desenharCupons(); },
  entrega: desenharEntrega,
  estoque: desenharEstoque,
  dashboard: desenharDashboard,
  fechamentos: desenharFechamentos,
  plano: desenharPlano,
  usuarios: desenharUsuarios
};

/* Que abas cada assunto do SSE afeta. Sem este mapa voltariamos ao
 * comportamento antigo: qualquer alteracao redesenhava o sistema inteiro. */
const AFETADAS = {
  pedidos: ["pedidos", "motoboy", "mesas", "dashboard"],
  produtos: ["produtos", "estoque", "promos", "dashboard"],
  insumos: ["estoque"],
  promocoes: ["promos", "produtos"],
  cupons: ["promos"],
  mesas: ["mesas"],
  entrega: ["entrega"],
  caixa: ["pedidos", "dashboard", "fechamentos"],
  retomada: ["pedidos", "mesas"]
};

const DEPENDENCIAS_ABA = {
  pedidos: ["pedidos", "produtos"],
  motoboy: [],
  mesas: ["mesas", "produtos"],
  produtos: ["produtos", "promocoes"],
  promos: ["produtos", "promocoes", "cupons"],
  entrega: ["entrega"],
  estoque: ["produtos", "insumos"],
  dashboard: [],
  fechamentos: ["fechamentos"],
  plano: ["ajustes"],
  usuarios: []
};

function areasIniciais(usuario) {
  const areas = new Set(["pedidos"]);
  if (podeVer("pedidos", usuario) || podeVer("produtos", usuario) || podeVer("estoque", usuario) || podeVer("mesas", usuario)) {
    areas.add("produtos");
  }
  if (podeVer("estoque", usuario)) areas.add("insumos");
  return [...areas];
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
  ligarMesas();
  ligarProdutos();
  ligarPromocoes();
  ligarEntrega();
  ligarEstoque();
  ligarDashboard();
  ligarPlano();
  ligarUsuarios();
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
  iniciarRastreamentoMotoboy();

  montarMenu(sessao.usuario);
  ligarShell();

  await carregar(...areasIniciais(sessao.usuario));
  desenharMetricas();

  await abrirAba(abaInicial(sessao.usuario));

  conectarEventos({
    canal: "operacao",
    aoMudar: async assunto => {
      const areas = { pedidos: ["pedidos", "mesas", "produtos"], produtos: ["produtos"], insumos: ["insumos"], promocoes: ["promocoes"], cupons: ["cupons"], mesas: ["mesas"], entrega: ["entrega"], caixa: ["caixa", "fechamentos"] }[assunto];
      await carregar(...(areas || []));
      if (assunto === "entrega") recarregarRascunhoEntrega();
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
