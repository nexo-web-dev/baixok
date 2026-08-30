/* Filtro de compressao da resposta — separado do app.js pra dar pra testar
 * sem precisar subir o servidor inteiro nem banco.
 *
 * As 3 rotas de SSE de verdade (o fluxo fica aberto e escreve aos poucos,
 * evento por evento, por horas seguidas) ficam de fora sempre — comprimir
 * bufferiza a saida esperando ter o que valha a pena compactar, e o aviso de
 * "pedido novo" chegaria atrasado na cozinha em vez de na hora. `/telao/fila`
 * mora no mesmo roteador mas e uma consulta JSON comum (pergunta e resposta,
 * sem conexao aberta) — essa pode e deve ser comprimida normalmente.
 *
 * `req.originalUrl`, nao `req.path`: o filtro do compression roda tarde, so
 * no primeiro res.write() de verdade — a essa altura a requisicao ja passou
 * pelos roteadores aninhados (rotasApi -> rotasEventos) e `req.path` ja foi
 * reescrito pelo Express pra ficar relativo a rota interna ("/publico", sem
 * o prefixo). `originalUrl` continua com o caminho completo desde o inicio,
 * "/api/eventos/publico", que e o que precisamos comparar aqui. */
import compression from "compression";

const ROTAS_SSE = new Set(["/api/eventos/publico", "/api/eventos/operacao", "/api/eventos/telao"]);

export function filtroCompressao(req, res) {
  const caminhoSemQuery = req.originalUrl.split("?")[0];
  if (ROTAS_SSE.has(caminhoSemQuery)) return false;
  return compression.filter(req, res);
}
