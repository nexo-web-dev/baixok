/* Regressao: o filtro de data personalizado (De/Ate no dashboard) tratava a
 * data digitada como se ja fosse UTC — meia-noite em Brasilia virava 21h do
 * dia anterior no banco, e pedido feito depois das 21h de hoje sumia do
 * proprio filtro de "hoje ate hoje". So acontecia no personalizado porque os
 * outros periodos (Hoje, 7 dias etc.) montam a data a partir de um Date() de
 * verdade, nunca de texto digitado.
 *
 * Nao precisa de banco: testa a funcao pura que decide o intervalo, nao a
 * consulta em si. */
import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { resolverPeriodo } = await import("../src/services/relatorios.service.js");

test("periodo personalizado 'hoje ate hoje' cobre o dia inteiro em Brasilia, nao em UTC", () => {
  const { desde, ate } = resolverPeriodo({ periodo: "personalizado", desde: "2026-08-17", ate: "2026-08-17" });

  /* Meia-noite em Brasilia (UTC-3) e 3h da manha em UTC — se o filtro
   * cortasse em "2026-08-17 00:00:00" cru (interpretado como UTC), estaria
   * comecando 3h antes da meia-noite de verdade e excluiria pedidos do
   * comecinho do dia. */
  const inicioUtc = new Date(desde);
  assert.equal(inicioUtc.toISOString(), "2026-08-17T03:00:00.000Z", "inicio do dia em Brasilia, convertido pra UTC");

  /* O fim precisa passar de "2026-08-17 21:00 Brasilia" (23h5959 UTC do
   * mesmo dia) — era exatamente o horario que a versao com bug cortava,
   * escondendo qualquer venda da noite. */
  const fimUtc = new Date(ate);
  assert.ok(fimUtc > new Date("2026-08-17T23:59:59.000Z"),
    "fim do periodo tem que ir alem das 23:59:59 UTC do mesmo dia (senao perde a noite em Brasilia)");
  assert.equal(fimUtc.toISOString(), "2026-08-18T02:59:59.000Z", "23:59:59 em Brasilia, convertido pra UTC");
});

test("periodo 'hoje' (botao) e personalizado 'hoje ate hoje' (campo De/Ate) cobrem a mesma janela", () => {
  const hojeStr = new Date().toISOString().slice(0, 10);
  const personalizado = resolverPeriodo({ periodo: "personalizado", desde: hojeStr, ate: hojeStr });
  const fimPersonalizado = new Date(personalizado.ate);

  /* Nao da pra comparar o inicio (hoje usa o "dia operacional", virada as
   * 5h — ver HORA_VIRADA), mas o FIM dos dois tem que alcancar o instante
   * atual: e exatamente o que a versao com bug do personalizado nao fazia,
   * porque 23:59:59 UTC do dia digitado ficava no passado (antes de agora)
   * sempre que o horario atual, em Brasilia, ja tivesse passado das 21h. */
  assert.ok(fimPersonalizado.getTime() >= Date.now() - 1000,
    "fim do personalizado precisa alcancar o instante atual, igual o botao Hoje");
});

test("periodo personalizado com hora (datetime-local) usa o minuto exato, nao o dia inteiro", () => {
  const { desde, ate, rotulo } = resolverPeriodo({
    periodo: "personalizado", desde: "2026-08-17T11:30", ate: "2026-08-17T15:00"
  });

  /* 11:30 em Brasilia e 14:30 UTC — se caisse pro fallback de "dia inteiro"
   * (00:00-23:59:59), esse teste pegaria a regressao na hora. */
  assert.equal(new Date(desde).toISOString(), "2026-08-17T14:30:00.000Z");
  assert.equal(new Date(ate).toISOString(), "2026-08-17T18:00:00.000Z");
  assert.equal(rotulo, "17/08 11:30 a 17/08 15:00");
});

test("periodo 'ontem' cobre o dia operacional anterior inteiro, sem sobrepor nem furar 'hoje'", () => {
  const hoje = resolverPeriodo({ periodo: "hoje" });
  const ontem = resolverPeriodo({ periodo: "ontem" });

  const inicioHoje = new Date(hoje.desde);
  const inicioOntem = new Date(ontem.desde);
  const fimOntem = new Date(ontem.ate);

  /* Fim de ontem tem que terminar exatamente 1 segundo antes do inicio de
   * hoje — sem sobreposicao (pedido contado duas vezes) nem buraco (pedido
   * que nao entra em nenhum dos dois). */
  assert.equal(inicioHoje.getTime() - fimOntem.getTime(), 1000);

  /* "Ontem" e um dia operacional inteiro: 24h do inicio ao fim. */
  assert.equal(fimOntem.getTime() - inicioOntem.getTime(), 24 * 60 * 60 * 1000 - 1000);

  assert.equal(ontem.rotulo, "Ontem");
});
