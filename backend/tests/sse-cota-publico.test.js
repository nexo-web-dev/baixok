import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { inscrever, cancelarInscricao, totalOuvintes, CANAL } = await import("../src/lib/events.js");
const { LIMITES } = await import("../src/config/constants.js");

const resFalso = () => ({ write: () => true });

/* /eventos/publico nao exige login — qualquer um na internet pode abrir
 * conexao ali. Sem uma cota propria, um ataque nesse canal aberto encostava
 * no teto global e tambem travava o canal autenticado (cozinha/painel), que
 * divide o mesmo contador. Este teste prova que a cota do publico esgota
 * sozinha, sem tirar o espaco de quem esta logado. */
test("canal publico tem cota propria e nao esgota o canal autenticado", async () => {
  const inscritos = [];
  try {
    for (let i = 0; i < LIMITES.OUVINTES_SSE_PUBLICO; i += 1) {
      const res = resFalso();
      assert.equal(inscrever(res, [CANAL.PUBLICO]), true, `publico ${i + 1}/${LIMITES.OUVINTES_SSE_PUBLICO} deveria entrar`);
      inscritos.push(res);
    }

    const excedente = resFalso();
    assert.equal(
      inscrever(excedente, [CANAL.PUBLICO]),
      false,
      "publico acima da cota propria deveria ser recusado, mesmo com o teto global longe de bater"
    );

    const operador = resFalso();
    assert.equal(
      inscrever(operador, [CANAL.OPERACAO]),
      true,
      "canal autenticado nao pode ser afetado pela cota do publico esgotada"
    );
    inscritos.push(operador);
  } finally {
    for (const res of inscritos) cancelarInscricao(res);
  }

  assert.equal(totalOuvintes(), 0, "limpeza do teste deveria remover todos os ouvintes inscritos");
});
