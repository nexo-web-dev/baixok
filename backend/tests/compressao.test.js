/* Regressao: a compressao de resposta (ligada pra reduzir tempo de
 * transferencia e chance de conexao instavel interromper no meio) nao pode
 * NUNCA se aplicar ao fluxo de eventos (SSE) — comprimir bufferiza a saida, e
 * o aviso de "pedido novo" chegaria atrasado na cozinha em vez de na hora.
 *
 * Testa o filtro isolado, sem precisar subir o servidor nem banco. */
import test from "node:test";
import assert from "node:assert/strict";
import { filtroCompressao } from "../src/lib/compressao.js";

process.env.NODE_ENV = "test";

test("filtroCompressao nunca comprime rota de eventos (SSE)", () => {
  for (const caminho of ["/api/eventos/operacao", "/api/eventos/publico", "/api/eventos/telao"]) {
    assert.equal(filtroCompressao({ path: caminho, headers: {} }, {}), false, `${caminho} nao pode ser comprimido`);
  }
});

test("filtroCompressao deixa o padrao decidir pra rotas normais", () => {
  const resComJson = { getHeader: () => "application/json; charset=utf-8" };
  assert.equal(
    filtroCompressao({ path: "/api/painel/pedidos", headers: {} }, resComJson),
    true,
    "resposta JSON normal deveria poder ser comprimida"
  );
});
