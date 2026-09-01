import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.SUPABASE_DATABASE_URL = "postgresql://usuario:senha@localhost:5432/teste";

const { podeTentarDeNovo } = await import("../src/db/postgres.js");

test("erro de DNS transitorio (EAI_AGAIN) permite tentar de novo dentro do limite", () => {
  assert.equal(podeTentarDeNovo({ code: "EAI_AGAIN" }, 0), true);
  assert.equal(podeTentarDeNovo({ code: "EAI_AGAIN" }, 1), true);
});

test("para de tentar depois do numero maximo de tentativas extras", () => {
  assert.equal(podeTentarDeNovo({ code: "EAI_AGAIN" }, 2), false);
  assert.equal(podeTentarDeNovo({ code: "EAI_AGAIN" }, 3), false);
});

test("outros erros de rede transitorios tambem contam (ECONNREFUSED, ETIMEDOUT, ECONNRESET, ENOTFOUND, ECONNABORTED, EPIPE)", () => {
  for (const codigo of ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "ECONNABORTED", "EPIPE"]) {
    assert.equal(podeTentarDeNovo({ code: codigo }, 0), true, `esperava retry para ${codigo}`);
  }
});

test("erro do Postgres com 'timeout' na MENSAGEM (statement cancelado, codigo 57014) nao tenta de novo", () => {
  assert.equal(podeTentarDeNovo({ code: "57014", message: "canceling statement due to statement timeout" }, 0), false);
});

test("erro de SQL (violacao de constraint, sintaxe) NUNCA tenta de novo, mesmo na primeira tentativa", () => {
  assert.equal(podeTentarDeNovo({ code: "23505" }, 0), false); // unique_violation
  assert.equal(podeTentarDeNovo({ code: "42601" }, 0), false); // syntax_error
});

test("erro sem codigo (ex: erro de aplicacao lancado a mao) nao tenta de novo", () => {
  assert.equal(podeTentarDeNovo(new Error("algo deu errado"), 0), false);
  assert.equal(podeTentarDeNovo(undefined, 0), false);
});
