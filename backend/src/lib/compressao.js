/* Filtro de compressao da resposta — separado do app.js pra dar pra testar
 * sem precisar subir o servidor inteiro nem banco.
 *
 * SSE (rotas /api/eventos) fica de fora sempre: aquela conexao e escrita aos
 * poucos, evento por evento, por horas seguidas — comprimir bufferiza a saida
 * esperando ter o que valha a pena compactar, e o aviso de "pedido novo"
 * chegaria atrasado na cozinha em vez de na hora. */
import compression from "compression";

export function filtroCompressao(req, res) {
  if (req.path.startsWith("/api/eventos")) return false;
  return compression.filter(req, res);
}
