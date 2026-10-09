/* Barramento de eventos para o Server-Sent Events.
 *
 * Mesma ideia do server.js antigo — um contador de revisao que sobe a cada
 * escrita e faz os aparelhos buscarem o estado novo — com duas mudancas:
 *
 * 1. O evento diz QUAL area mudou. Antes qualquer alteracao mandava todo mundo
 *    recarregar tudo; o telao refazia a consulta inteira porque alguem editou a
 *    descricao de um produto.
 * 2. O canal e por publico. O tablet da cozinha nao recebe aviso de mudanca no
 *    cadastro de usuarios, e o cardapio do cliente nunca ouve nada da fila. */
import { LIMITES } from "../config/constants.js";
import { logger } from "./logger.js";

export const CANAL = Object.freeze({
  PUBLICO: "publico",   // cardapio do cliente: produtos, promocoes, mesas
  OPERACAO: "operacao", // painel e cozinha: pedidos, estoque, mesas
  TELAO: "telao"        // so a fila de chamada
});

let revisao = 0;
const ouvintes = new Set();

function contarCanal(canal) {
  let n = 0;
  for (const ouvinte of ouvintes) if (ouvinte.canais.has(canal)) n += 1;
  return n;
}

/* /eventos/publico nao exige login (ver eventos.routes.js) — qualquer um na
 * internet pode abrir essa conexao. Sem uma cota propria, bastava abrir
 * conexoes ali ate encostar no teto global pra tambem travar os canais
 * autenticados (cozinha, painel, telao), que dependem do mesmo contador.
 * A cota do publico garante que, mesmo esgotada, sobra sempre espaco pros
 * canais de dentro da casa. */
export function inscrever(res, canais) {
  if (ouvintes.size >= LIMITES.OUVINTES_SSE) return false;
  if (canais.includes(CANAL.PUBLICO) && contarCanal(CANAL.PUBLICO) >= LIMITES.OUVINTES_SSE_PUBLICO) return false;
  ouvintes.add({ res, canais: new Set(canais) });
  return true;
}

export function cancelarInscricao(res) {
  for (const ouvinte of ouvintes) {
    if (ouvinte.res === res) ouvintes.delete(ouvinte);
  }
}

export const totalOuvintes = () => ouvintes.size;

function enviar(ouvinte, texto) {
  try {
    ouvinte.res.write(texto);
    return true;
  } catch {
    ouvintes.delete(ouvinte);
    return false;
  }
}

/* publicar("pedidos", [CANAL.OPERACAO, CANAL.TELAO]) */
export function publicar(assunto, canais = [CANAL.OPERACAO]) {
  revisao += 1;
  const corpo = `event: mudanca\ndata: ${JSON.stringify({ rev: revisao, assunto })}\n\n`;
  for (const ouvinte of [...ouvintes]) {
    if (canais.some(canal => ouvinte.canais.has(canal))) enviar(ouvinte, corpo);
  }
  logger.debug("Evento publicado", { assunto, canais, revisao, ouvintes: ouvintes.size });
}

export const revisaoAtual = () => revisao;

/* Comentario periodico para segurar a conexao de pe. Wifi de loja, NAT e proxy
 * fecham conexao ociosa, e o tablet da cozinha parava de receber pedido sem dar
 * nenhum sinal de que tinha parado. */
export function iniciarPing(intervaloMs = 25000) {
  const timer = setInterval(() => {
    for (const ouvinte of [...ouvintes]) enviar(ouvinte, ": ping\n\n");
  }, intervaloMs);
  timer.unref();
  return timer;
}
