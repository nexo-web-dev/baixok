/* Regressao: a compressao de resposta (ligada pra reduzir tempo de
 * transferencia e chance de conexao instavel interromper no meio) nao pode
 * NUNCA se aplicar ao fluxo de eventos (SSE) — comprimir bufferiza a saida, e
 * o aviso de "pedido novo" chegaria atrasado na cozinha em vez de na hora.
 *
 * Testa o filtro isolado, sem precisar subir o servidor nem banco.
 *
 * O mock usa `path` JA REESCRITO pelo roteador aninhado (ex: "/publico", sem
 * o prefixo) e `originalUrl` com o caminho completo — exatamente a forma que
 * o Express entrega de verdade quando o filtro do compression roda (tarde, no
 * primeiro res.write(), depois que a requisicao ja atravessou rotasApi ->
 * rotasEventos). Essa e a regressao real que aconteceu: o filtro checava
 * `req.path`, que aqui e so "/publico" — nunca comeca com "/api/eventos", e o
 * SSE saia comprimido em producao mesmo com este teste passando (o mock
 * antigo usava `path` com o caminho completo, que o Express nunca entrega
 * assim nesse ponto). Se o filtro voltar a usar `req.path`, este teste
 * pega. */
import test from "node:test";
import assert from "node:assert/strict";
import { filtroCompressao } from "../src/lib/compressao.js";

process.env.NODE_ENV = "test";

test("filtroCompressao nunca comprime rota de eventos (SSE), mesmo com req.path ja reescrito pelo roteador aninhado", () => {
  for (const originalUrl of ["/api/eventos/operacao", "/api/eventos/publico", "/api/eventos/telao"]) {
    const caminhoReescrito = originalUrl.replace(/^\/api\/eventos/, "");
    assert.equal(
      filtroCompressao({ path: caminhoReescrito, originalUrl, headers: {} }, {}),
      false,
      `${originalUrl} (path interno "${caminhoReescrito}") nao pode ser comprimido`
    );
  }
});

test("filtroCompressao deixa o padrao decidir pra rotas normais", () => {
  const resComJson = { getHeader: () => "application/json; charset=utf-8" };
  assert.equal(
    filtroCompressao({ path: "/pedidos", originalUrl: "/api/painel/pedidos", headers: {} }, resComJson),
    true,
    "resposta JSON normal deveria poder ser comprimida"
  );
});

test("filtroCompressao comprime /api/eventos/telao/fila — mora no mesmo roteador do SSE, mas e consulta JSON comum, sem conexao aberta", () => {
  const resComJson = { getHeader: () => "application/json; charset=utf-8" };
  assert.equal(
    filtroCompressao({ path: "/fila", originalUrl: "/api/eventos/telao/fila", headers: {} }, resComJson),
    true,
    "/telao/fila nao e SSE, deveria poder ser comprimida"
  );
});
