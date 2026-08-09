/* Conversa com a Mapbox.
 *
 * O token vive so aqui, no servidor. O sistema antigo entregava o token publico
 * ("pk.") ao navegador para montar o widget oficial de busca; mantivemos essa
 * possibilidade, mas ela agora e opcional e explicita — sem token publico o
 * navegador usa a busca via servidor, que sempre funcionou. Token secreto
 * ("sk.") nunca sai daqui. */
import { env } from "../config/env.js";
import { indisponivel } from "./errors.js";
import { logger } from "./logger.js";

export const temToken = () => Boolean(env.MAPBOX_TOKEN);

/* So o token publico pode ir ao navegador. Um "sk." vazado da acesso a conta
 * inteira da Mapbox, inclusive faturamento. */
export const tokenPublico = () => {
  const token = env.MAPBOX_TOKEN || "";
  return token.startsWith("pk.") ? token : "";
};

const TEMPO_LIMITE_MS = 8000;

async function chamar(url) {
  /* Sem timeout, a Mapbox fora do ar deixava o pedido do cliente pendurado ate
   * o navegador desistir — e o atendente sem saber se entrou ou nao. */
  const controle = AbortSignal.timeout(TEMPO_LIMITE_MS);
  const resposta = await fetch(url, { signal: controle }).catch(erro => {
    logger.warn("Mapbox inacessivel", { erro: erro.message });
    throw indisponivel("Serviço de endereço indisponível no momento.");
  });
  if (!resposta.ok) {
    logger.warn("Mapbox recusou", { status: resposta.status });
    throw indisponivel(`Serviço de endereço respondeu ${resposta.status}.`);
  }
  return resposta;
}

/* `proximity` puxa os resultados para perto da loja: "Rua Sacadura Cabral"
 * existe em varias cidades, e sem isso a primeira resposta podia ser de outro
 * estado. */
export async function geocodificar(texto, loja = {}) {
  if (!temToken()) throw indisponivel("Busca de endereço não configurada.");

  const params = new URLSearchParams({
    q: String(texto).slice(0, 256),
    access_token: env.MAPBOX_TOKEN,
    country: "br",
    language: "pt",
    limit: "5",
    types: "address,street,place,neighborhood"
  });
  if (loja.lng != null && loja.lat != null) params.set("proximity", `${loja.lng},${loja.lat}`);

  const resposta = await chamar(`${env.MAPBOX_API}/search/geocode/v6/forward?${params}`);
  const dados = await resposta.json();

  return (dados.features || [])
    .map(feature => ({
      id: feature.properties?.mapbox_id || "",
      nome: feature.properties?.name || "",
      detalhe: feature.properties?.place_formatted || "",
      lng: feature.properties?.coordinates?.longitude,
      lat: feature.properties?.coordinates?.latitude,
      precisao: feature.properties?.coordinates?.accuracy || ""
    }))
    .filter(item => Number.isFinite(item.lng) && Number.isFinite(item.lat));
}

/* O mapa estatico da aba do painel passa pelo servidor para o token nao vazar
 * na URL da imagem. */
export async function mapaEstatico({ lng, lat, raios = [] }) {
  if (!temToken()) throw indisponivel("Mapa indisponivel.");
  const zoom = raios.length ? Math.max(9, 14 - Math.log2(Math.max(...raios) || 1)) : 14;
  const pino = `pin-l-restaurant+c97443(${lng},${lat})`;
  const url = `${env.MAPBOX_API}/styles/v1/mapbox/dark-v11/static/${pino}/${lng},${lat},${zoom.toFixed(1)}/640x420@2x`
    + `?access_token=${env.MAPBOX_TOKEN}&attribution=true&logo=true`;

  const resposta = await chamar(url);
  return Buffer.from(await resposta.arrayBuffer());
}
