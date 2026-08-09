/* Limites por IP.
 *
 * Preserva os tetos que o server.js original ja aplicava (login e geocodificacao)
 * e acrescenta um teto geral. O motivo de cada um esta escrito abaixo: sem isso
 * viram numeros magicos que ninguem ousa mexer. */
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

const base = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  /* Com proxy TLS na frente, todo mundo chega com o IP do proxy e um cliente
   * errando a senha travaria a loja inteira. Sem proxy o cabecalho e ignorado,
   * porque quem chama direto escreve nele o que quiser. */
  keyGenerator: req => (env.TRUST_PROXY ? req.ip : req.socket.remoteAddress) || "desconhecido"
};

const resposta = mensagem => (_req, res) => res.status(429).json({ erro: mensagem, codigo: "limite_excedido" });

/* Login: com senha forte de verdade a forca bruta ja e inviavel, mas o teto
 * segura a varredura de nomes de usuario e o custo de CPU do scrypt. */
export const limiteLogin = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: env.LIMITE_LOGIN,
  handler: resposta("Muitas tentativas de login. Espere 15 minutos.")
});

/* Geocodificacao: sem teto, o endereco publico do site vira servico gratuito de
 * consulta e as 100 mil buscas mensais da Mapbox acabam num dia. */
export const limiteGeocodificacao = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: env.LIMITE_GEOCODIFICACAO,
  handler: resposta("Muitas buscas seguidas. Tente daqui a pouco.")
});

/* Envio de pedido: o cardapio e aberto, entao nada impede um script de encher a
 * fila da cozinha com pedidos falsos. */
export const limitePedido = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: env.LIMITE_PEDIDO,
  handler: resposta("Muitos pedidos seguidos deste aparelho. Fale com o balcao.")
});

/* Historico publico por telefone: leve e limitado, mas ainda e uma rota aberta
 * que consulta pedidos. O teto evita varredura de telefone por script. */
export const limiteHistoricoPedidos = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: Math.max(20, env.LIMITE_PEDIDO * 3),
  handler: resposta("Muitas consultas de historico. Tente daqui a pouco.")
});

/* Teto geral, folgado: nao atrapalha o uso normal e evita que uma aba em laco
 * consuma o servidor. */
export const limiteGeral = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: env.LIMITE_GERAL,
  handler: resposta("Muitas requisicoes. Aguarde um instante.")
});
