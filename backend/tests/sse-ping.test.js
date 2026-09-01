import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { inscrever, iniciarPing, CANAL } = await import("../src/lib/events.js");

/* Suporte da hospedagem levantou um ponto real: Cloudflare (e proxies em
 * geral) derrubam conexao SSE ociosa, sem trafego nenhum, por tempo demais.
 * Este teste prova que o "ping" de manter a conexao de pe (iniciarPing, ja
 * chamado no boot em index.js) realmente escreve algo no socket dentro do
 * intervalo configurado — mesmo sem nenhum pedido/evento real acontecendo. */
test("iniciarPing escreve um comentario SSE no ouvinte, mesmo sem nenhum evento real publicado", async () => {
  const escritas = [];
  const resFalso = {
    write: texto => { escritas.push(texto); return true; }
  };

  const inscreveu = inscrever(resFalso, [CANAL.OPERACAO]);
  assert.equal(inscreveu, true);

  const timer = iniciarPing(20); // intervalo bem curto so pro teste
  try {
    await new Promise(resolve => setTimeout(resolve, 70));
  } finally {
    clearInterval(timer);
  }

  assert.ok(escritas.length >= 1, "esperava pelo menos 1 ping escrito no intervalo do teste");
  for (const texto of escritas) {
    assert.match(texto, /^: ping\n\n$/, "o ping deve ser um comentario SSE (comeca com ':'), invisivel pro EventSource do cliente");
  }
});
