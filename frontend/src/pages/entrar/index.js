/* Tela de login.
 *
 * Substitui a senha unica da loja por usuario e senha por pessoa. O destino
 * pos-login vem da query `?de=`, e por isso e validado aqui: aceitar qualquer
 * valor abriria um redirecionamento aberto — um link
 * `/entrar.html?de=https://site-falso` levaria o atendente para fora depois de
 * digitar a senha, com a aparencia de ter sido o proprio sistema. */
import "../../styles/entrar.css";
import { $, mostrar } from "../../utils/dom.js";
import { apiAuth } from "../../services/api.js";

const DESTINOS_PERMITIDOS = new Set(["/admin.html", "/telao.html", "/index.html"]);
const ERRO_CONEXAO = "Não consegui falar com o servidor. Recarregue a página e tente de novo. Se estiver no celular, feche e abra o navegador para limpar o cache antigo.";

async function limparCacheAntigo() {
  try {
    if ("serviceWorker" in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map(registro => registro.update().catch(() => null)));
    }
    if ("caches" in window) {
      const chaves = await caches.keys();
      await Promise.all(
        chaves
          .filter(chave => chave.startsWith("baixok-") && chave !== "baixok-v6")
          .map(chave => caches.delete(chave))
      );
    }
  } catch {
    /* Cache antigo nao pode impedir o login. */
  }
}

function destino() {
  const pedido = new URLSearchParams(location.search).get("de") || "";
  /* So caminho interno da lista branca. Nada de URL absoluta, nada de "//". */
  return DESTINOS_PERMITIDOS.has(pedido) ? pedido : "/admin.html";
}

function destinoSemCache() {
  const url = new URL(destino(), location.origin);
  url.searchParams.set("_", String(Date.now()));
  return `${url.pathname}${url.search}`;
}

function mostrarErro(mensagem) {
  const alvo = $("#entrar-erro");
  alvo.textContent = mensagem;
  mostrar(alvo, Boolean(mensagem));
}

limparCacheAntigo();

$("#form-entrar").addEventListener("submit", async evento => {
  evento.preventDefault();
  mostrarErro("");

  const botao = $("#botao-entrar");
  const usuario = $("#usuario").value.trim();
  const senha = $("#senha").value;

  botao.disabled = true;
  botao.textContent = "Entrando...";
  try {
    await apiAuth.entrar(usuario, senha);
    const sessao = await apiAuth.eu();
    if (!sessao?.autenticado) {
      throw new Error("Login aceito, mas o navegador não salvou a sessão. Recarregue a página e tente novamente.");
    }
    location.replace(destinoSemCache());
  } catch (erro) {
    /* A mensagem vem do servidor e e deliberadamente igual para usuario
     * inexistente e senha errada. */
    const offline = erro.codigo === "offline";
    mostrarErro(offline ? ERRO_CONEXAO : erro.message);
    if (erro.status === 401 || erro.codigo === "credenciais_invalidas") $("#senha").value = "";
    $("#senha").focus();
  } finally {
    botao.disabled = false;
    botao.textContent = "Entrar";
  }
});
