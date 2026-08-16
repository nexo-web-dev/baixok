/* Regressao especifica: o CSP do servidor bloqueia atributo de evento inline
 * (onclick=, onload= etc — ver script-src em src/app.js, sem 'unsafe-inline'
 * de proposito). Um botao com onclick="" simplesmente nao faz nada quando
 * clicado, sem erro nenhum visivel pra quem esta usando o sistema — foi
 * exatamente o que aconteceu no botao "Imprimir ou salvar PDF" do relatorio
 * de fechamento de caixa.
 *
 * Nao precisa de banco: testa a string HTML que a funcao produz, nao a rota.
 * Assim a suite roda sempre, mesmo sem TEST_DATABASE_URL configurado. */
import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { htmlRelatorio } = await import("../src/services/caixa.service.js");

/* Atributo de evento inline: on + letras + "=". Cobre onclick, onload,
 * onerror etc., em qualquer tag — nao so o botao que ja quebrou uma vez. */
const TEM_EVENTO_INLINE = /<[a-z][^>]*\son[a-z]+\s*=/i;

const caixaExemplo = {
  id: "cx-teste",
  abertoEm: "2026-08-15T19:41:00Z",
  fechadoEm: "2026-08-16T19:10:00Z",
  abertoPorNome: "Admin Baixo K",
  fechadoPorNome: "Admin Baixo K",
  pedidos: 16,
  faturamento: 319,
  descontos: 0,
  taxasEntrega: 0,
  ticketMedio: 18.76,
  cancelados: 0,
  valorCancelado: 0,
  calotes: 1,
  valorCalote: 45,
  naoPagosLista: [{ cliente: "Blu", total: 45, motivo: "Cliente saiu sem pagar" }],
  entregas: 0,
  retiradas: 15,
  mesas: 0,
  pagamentos: [{ rotulo: "Pix", pedidos: 6, faturamento: 180 }],
  canais: [{ rotulo: "Loja", pedidos: 15, faturamento: 319 }],
  modalidades: [{ rotulo: "Retirada", pedidos: 15, faturamento: 319 }],
  motoboys: [],
  observacao: "caixa fechado"
};

test("relatorio de fechamento de caixa nao usa atributo de evento inline", () => {
  const html = htmlRelatorio(caixaExemplo);
  assert.ok(html.includes("<!doctype html>"), "sanity check: a funcao devolveu HTML");
  assert.ok(!TEM_EVENTO_INLINE.test(html), "HTML nao pode ter onclick=, onload= etc — o CSP bloqueia isso em silencio");
});

/* Observacao e motivo do nao pago vem de texto livre digitado por quem usa o
 * sistema — precisa continuar escapado, senao o mesmo buraco do onclick=
 * reabre por outra porta (o texto vira marcacao em vez de conteudo). */
test("texto livre do fechamento (observacao, motivo) continua escapado no HTML", () => {
  const comMarcacao = {
    ...caixaExemplo,
    observacao: "<img src=x onerror=alert(1)>",
    naoPagosLista: [{ cliente: "<script>alert(2)</script>", total: 10, motivo: "<b onmouseover=alert(3)>oi</b>" }]
  };
  const html = htmlRelatorio(comMarcacao);
  assert.ok(!TEM_EVENTO_INLINE.test(html), "texto do usuario nao pode introduzir evento inline no HTML");
  assert.ok(!html.includes("<script>alert(2)</script>"), "nome de cliente nao pode virar tag de verdade");
  assert.ok(!html.includes("<img src=x"), "observacao nao pode virar tag de verdade");
});
