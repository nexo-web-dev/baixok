/* Cliente HTTP da aplicacao.
 *
 * Todo acesso a dados passa por aqui. O sistema antigo espalhava `fetch` e
 * leitura de `localStorage` por dentro das telas, e por isso ninguem conseguia
 * dizer de onde um numero da tela tinha vindo. */

const BASE = "/api";

export class ErroHttp extends Error {
  constructor(mensagem, { status, codigo, detalhes } = {}) {
    super(mensagem);
    this.name = "ErroHttp";
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/* O token CSRF vem num cookie legivel e volta no cabecalho. O cookie de sessao
 * continua HttpOnly — este aqui existe justamente para ser lido pela pagina. */
function tokenCsrf() {
  const achado = document.cookie
    .split(";")
    .map(parte => parte.trim())
    .find(parte => parte.startsWith("bk_csrf="));
  return achado ? decodeURIComponent(achado.slice("bk_csrf=".length)) : "";
}

/* Quem trata o 401 e a propria pagina, via este gancho. Sem ele, cada tela
 * precisaria lembrar de redirecionar para o login em toda chamada. */
let aoPerderSessao = null;
export const definirTratamentoDeSessao = callback => { aoPerderSessao = callback; };

async function requisitar(caminho, { metodo = "GET", corpo, sinal } = {}) {
  const headers = {};
  if (corpo !== undefined) headers["Content-Type"] = "application/json";
  if (metodo !== "GET" && metodo !== "HEAD") headers["X-CSRF-Token"] = tokenCsrf();

  let resposta;
  const controle = sinal ? null : new AbortController();
  const tempo = controle ? setTimeout(() => controle.abort(), 12000) : null;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: "same-origin",
      cache: "no-store",
      signal: sinal || controle.signal
    });
  } catch (erro) {
    if (erro.name === "AbortError") {
      throw new ErroHttp("Tempo esgotado ao falar com o servidor.", { status: 0, codigo: "offline" });
    }
    throw new ErroHttp("Sem conexao com o servidor.", { status: 0, codigo: "offline" });
  } finally {
    if (tempo) clearTimeout(tempo);
  }

  if (resposta.status === 204) return null;

  const tipo = resposta.headers.get("content-type") || "";
  const dados = tipo.includes("application/json") ? await resposta.json().catch(() => null) : null;

  if (!resposta.ok) {
    if (resposta.status === 401 && aoPerderSessao) aoPerderSessao();
    throw new ErroHttp(dados?.erro || `Falha na requisicao (${resposta.status}).`, {
      status: resposta.status,
      codigo: dados?.codigo,
      detalhes: dados?.detalhes
    });
  }
  return dados;
}

const comQuery = (caminho, params) => {
  const busca = new URLSearchParams(
    Object.entries(params || {}).filter(([, valor]) => valor !== undefined && valor !== null && valor !== "")
  ).toString();
  return busca ? `${caminho}?${busca}` : caminho;
};

export const http = {
  get: (caminho, params, opcoes) => requisitar(comQuery(caminho, params), opcoes),
  post: (caminho, corpo, opcoes) => requisitar(caminho, { ...opcoes, metodo: "POST", corpo: corpo ?? {} }),
  put: (caminho, corpo, opcoes) => requisitar(caminho, { ...opcoes, metodo: "PUT", corpo: corpo ?? {} }),
  patch: (caminho, corpo, opcoes) => requisitar(caminho, { ...opcoes, metodo: "PATCH", corpo: corpo ?? {} }),
  delete: (caminho, opcoes) => requisitar(caminho, { ...opcoes, metodo: "DELETE" })
};
