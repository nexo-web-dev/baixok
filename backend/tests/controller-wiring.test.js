/* Regressao especifica: o controller do painel chamou
 * `pedidosService.ajustarQuantidadeItem(...)` — um metodo que nunca chegou a
 * existir de verdade no service (so no repo/schema/rota). Toda vez que isso
 * acontecia em producao, o resultado era 500 silencioso: nada no editor
 * avisava, porque JS so descobre "isso nao e funcao" na hora de chamar.
 *
 * Este teste varre o controller inteiro e confere, pra cada `xService.metodo(`
 * encontrado no codigo, se aquele metodo realmente existe no service
 * importado. Nao precisa de banco — e so leitura de arquivo + import dos
 * services de verdade — entao roda sempre, mesmo sem TEST_DATABASE_URL. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { pedidosService } = await import("../src/services/pedidos.service.js");
const { produtosService, promocoesService } = await import("../src/services/produtos.service.js");
const { insumosService } = await import("../src/services/insumos.service.js");
const { mesasService } = await import("../src/services/mesas.service.js");
const { cuponsService } = await import("../src/services/cupons.service.js");
const { entregaService } = await import("../src/services/entrega.service.js");
const { relatoriosService } = await import("../src/services/relatorios.service.js");
const { caixaService } = await import("../src/services/caixa.service.js");
const { usuariosService } = await import("../src/services/usuarios.service.js");
const { motoboysService } = await import("../src/services/motoboys.service.js");
const { combosService } = await import("../src/services/combos.service.js");
const { combinacoesSaboresService } = await import("../src/services/combinacoes-sabores.service.js");

const SERVICOS = {
  pedidosService, produtosService, promocoesService, insumosService, mesasService,
  cuponsService, entregaService, relatoriosService, caixaService, usuariosService,
  motoboysService, combosService, combinacoesSaboresService
};

test("todo metodo de service chamado no controller do painel existe de verdade", () => {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const codigo = readFileSync(path.join(aqui, "../src/controllers/painel.controller.js"), "utf8");

  /* "xService.metodo(" — so os nomes que terminam em Service, que sao os
   * unicos objetos de servico importados neste controller. */
  const padrao = /\b([a-zA-Z]+Service)\.([a-zA-Z]+)\s*\(/g;
  const faltando = [];
  const vistos = new Set();
  let combinacao;
  while ((combinacao = padrao.exec(codigo))) {
    const [, servico, metodo] = combinacao;
    const chave = `${servico}.${metodo}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const objetoServico = SERVICOS[servico];
    if (!objetoServico) continue; // nome de servico que este teste nao conhece — nao e o que ele cobre
    if (typeof objetoServico[metodo] !== "function") faltando.push(chave);
  }

  assert.deepEqual(faltando, [], `Controller chama metodo(s) que nao existem no service: ${faltando.join(", ")}`);
});
