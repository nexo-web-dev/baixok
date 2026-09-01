/* Telao do salao.
 *
 * Duas mudancas em relacao ao original:
 *
 * 1. Deixou de reler o estado a cada 3 segundos por temporizador. A tela agora
 *    e atualizada pelo aviso do servidor (SSE); o temporizador virou so uma
 *    rede de seguranca de um minuto, para o caso de um aviso se perder.
 *
 * 2. Recebe so a fila. O telao antigo carregava o banco inteiro no navegador —
 *    incluindo telefone e endereco de todo mundo que pediu no dia — para
 *    mostrar uma lista de nomes numa TV do salao. */
import "../../styles/telao.css";
import { el, render, $ } from "../../utils/dom.js";
import { hora } from "../../utils/formato.js";
import { MODALIDADES_ROTULO, STATUS_ROTULO } from "../../utils/categorias.js";
import { apiTelao } from "../../services/api.js";
import { conectarEventos } from "../../services/realtime.js";
import { definirTratamentoDeSessao } from "../../services/http.js";

const INTERVALO_SEGURANCA_MS = 60000;

let assinatura = "";
let som = { contexto: null, ligado: false };

/* O telao fica sozinho numa TV. Perdendo a sessao, ele volta para o login em
 * vez de ficar mostrando uma fila congelada que ninguem percebe estar velha. */
definirTratamentoDeSessao(() => {
  location.replace("/entrar.html?de=%2Ftelao.html");
});

// --------------------------------------------------------------------- som ---
/* O navegador so libera audio depois de uma interacao. Tentamos na carga (caso
 * a TV ja tenha recebido um toque) e de novo no primeiro clique ou tecla. */
function tentarLigarSom() {
  const Contexto = window.AudioContext || window.webkitAudioContext;
  if (!Contexto) return;
  som.contexto = som.contexto || new Contexto();
  som.contexto.resume().catch(() => {});
  som.ligado = true;
}

/* Sineta de balcao ("ding!"): fundamental + dois harmonicos levemente
 * desafinados entre si, ataque quase instantaneo e decaimento exponencial
 * longo — e o que da o timbre metalico e "campainha de verdade" em vez de um
 * tom puro de sintetizador. Tocada duas vezes (ding-ding) imita a sineta que
 * lanchonete usa de verdade pra avisar "pedido pronto". */
function tocarSino(agora, atraso, frequenciaBase, volume) {
  const parciais = [
    { fator: 1, ganho: 1 },
    { fator: 2.0, ganho: 0.45 },
    { fator: 2.76, ganho: 0.22 }
  ];

  for (const { fator, ganho } of parciais) {
    const oscilador = som.contexto.createOscillator();
    const ganhoNode = som.contexto.createGain();

    oscilador.type = "sine";
    oscilador.frequency.value = frequenciaBase * fator;
    ganhoNode.gain.setValueAtTime(0.0001, agora + atraso);
    ganhoNode.gain.exponentialRampToValueAtTime(volume * ganho, agora + atraso + 0.006);
    ganhoNode.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.85);

    oscilador.connect(ganhoNode);
    ganhoNode.connect(som.contexto.destination);
    oscilador.start(agora + atraso);
    oscilador.stop(agora + atraso + 0.9);
  }
}

function tocarChamada() {
  if (!som.ligado || !som.contexto) return;
  const agora = som.contexto.currentTime;
  tocarSino(agora, 0, 1318.5, 0.22);     // E6 — primeiro toque
  tocarSino(agora, 0.32, 1318.5, 0.2);   // segundo toque, ding-ding
}

// ------------------------------------------------------------------ desenho ---
const senhaDoPedido = pedido => `Pedido ${String(pedido.id).slice(-3).toUpperCase()}`;

function cartao(pedido) {
  return el("article.screen-card", { class: pedido.status === "pronto" ? "ready" : "" },
    el("span.screen-order-code", {}, senhaDoPedido(pedido)),
    el("strong", {}, pedido.customer),
    el("span", {}, MODALIDADES_ROTULO[pedido.fulfillment] || pedido.fulfillment),
    el("p", {}, (pedido.items || []).map(item => `${item.qty}x ${item.name}`).join(" | "))
  );
}

function desenharColuna(alvo, pedidos) {
  render(alvo, pedidos.length
    ? pedidos.map(cartao)
    : el("p.screen-empty", {}, "Nenhum pedido."));
}

function desenharDestaque(pedido) {
  const alvo = $("#screen-highlight");
  if (!pedido) {
    return render(alvo,
      el("span.eyebrow", {}, "Baixo K"),
      el("strong", {}, "Sem pedidos abertos"),
      el("p", {}, "Aguardando novos pedidos.")
    );
  }
  render(alvo,
    el("span.eyebrow", {}, "Pedido em destaque"),
    el("strong", {}, `${senhaDoPedido(pedido)} - ${pedido.customer}`),
    el("p", {}, `${MODALIDADES_ROTULO[pedido.fulfillment] || pedido.fulfillment} | ${STATUS_ROTULO[pedido.status] || pedido.status}`),
    el("ul", {}, (pedido.items || []).map(item => el("li", {}, `${item.qty}x ${item.name}`)))
  );
}

async function atualizar() {
  $("#screen-clock").textContent = hora(new Date());

  let fila;
  try {
    fila = await apiTelao.fila();
  } catch {
    return;   // mantem a tela anterior; o indicador de status ja avisa
  }

  const ativos = [...fila.pronto, ...fila.preparo];

  /* Toca so quando a fila realmente mudou. Comparar a assinatura evita o
   * bip a cada atualizacao de rotina. */
  const nova = JSON.stringify(ativos.map(pedido => [pedido.id, pedido.status]));
  if (nova !== assinatura) {
    const tinhaAnterior = Boolean(assinatura);
    assinatura = nova;
    document.body.classList.add("screen-pulse");
    setTimeout(() => document.body.classList.remove("screen-pulse"), 900);
    if (tinhaAnterior && ativos.length) tocarChamada();
  }

  desenharDestaque(fila.pronto[0] || fila.preparo[0]);
  desenharColuna($("#screen-preparing"), fila.preparo);
  desenharColuna($("#screen-ready"), fila.pronto);
}

// ------------------------------------------------------------------ inicio ---
function iniciar() {
  tentarLigarSom();
  for (const evento of ["click", "touchstart", "keydown"]) {
    window.addEventListener(evento, tentarLigarSom, { once: true, passive: true });
  }

  atualizar();
  setInterval(() => { $("#screen-clock").textContent = hora(new Date()); }, 20000);
  setInterval(atualizar, INTERVALO_SEGURANCA_MS);

  conectarEventos({
    canal: "telao",
    aoMudar: atualizar,
    /* Indicador visivel de conexao. Sem ele, wifi caido deixava a TV mostrando
     * a fila de meia hora atras sem nenhum sinal de que tinha parado. */
    aoStatus: estado => {
      const node = $("#screen-status");
      node.className = `screen-status ${estado}`;
      node.textContent = estado === "conectado" ? "" : "sem conexao";
    }
  });
}

iniciar();
