/* Regressao: carregarSessao (consulta o banco pra validar a sessao) estava
 * registrado com `app.use(carregarSessao)` sem path — rodava pra TODA
 * requisicao, inclusive cada arquivo JS/CSS estatico que o navegador pede pra
 * montar o painel (~20 por carregamento). Com a loja cheia de gente logada ao
 * mesmo tempo, isso estourava as poucas conexoes do pool de banco so com
 * consulta de sessao pra arquivo que nem usa isso, e a requisicao ficava
 * pendurada — o Cloudflare desistia primeiro e devolvia erro 520 pro
 * navegador, de forma intermitente.
 *
 * Nao precisa de banco nem de subir o Express: e so leitura de arquivo,
 * conferindo que a chamada continua com path restrito. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("carregarSessao nao roda pra toda requisicao — so pra /api e paginas restritas", () => {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const codigo = readFileSync(path.join(aqui, "../src/app.js"), "utf8");

  assert.doesNotMatch(
    codigo, /app\.use\(\s*carregarSessao\s*\)/,
    "carregarSessao voltou a rodar global (sem path) — isso consulta o banco pra cada arquivo estatico"
  );
  assert.match(
    codigo, /app\.use\(\s*\[[^\]]*carregarSessao/,
    "carregarSessao precisa continuar restrito a uma lista de paths (api, admin, telao)"
  );
});
