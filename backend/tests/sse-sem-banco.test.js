/* Regressao de producao real: /api/eventos/publico saia comprimido (gzip) e
 * o navegador nunca recebia o primeiro evento — o EventSource ficava pendurado
 * pra sempre, e o painel/cardapio mostravam "Sem conexao com o servidor" o
 * tempo todo. A causa era o filtro de compressao usando `req.path`, que o
 * Express reescreve pra ficar relativo ao roteador aninhado ("/publico", sem
 * o prefixo) bem na hora que o filtro roda de verdade — so um teste com o
 * app INTEIRO de pe pega isso; o mock do teste unitario (compressao.test.js)
 * já cobre a logica do filtro isolada, mas foi exatamente esse teste unitario
 * que passou com o bug em producao porque o mock não reproduzia a reescrita
 * de path do Express. Este aqui sobe o servidor de verdade e bate na rota
 * publica de SSE, sem precisar de banco (rota sem sessao). */
import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { criarApp } = await import("../src/app.js");

const servidor = criarApp().listen(0);
await new Promise(resolve => servidor.once("listening", resolve));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

test.after(() => servidor.close());

test("/api/eventos/publico nunca vem comprimido e entrega o primeiro evento na hora", async () => {
  const controle = new AbortController();
  const resposta = await fetch(`${BASE}/api/eventos/publico`, {
    headers: { "Accept-Encoding": "gzip" },
    signal: controle.signal
  });

  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("content-encoding"), null, "SSE nao pode vir comprimido");

  const leitor = resposta.body.getReader();
  const { value, done } = await Promise.race([
    leitor.read(),
    new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("primeiro evento nao chegou em 2s")), 2000))
  ]);
  assert.ok(!done, "o fluxo nao pode fechar sozinho");
  const texto = new TextDecoder().decode(value);
  assert.match(texto, /^event: pronto/, "primeiro evento tem que ser o 'pronto' de conexao estabelecida");

  controle.abort();
});
