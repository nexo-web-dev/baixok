/* Aviso rapido no rodape.
 *
 * O container e criado sob demanda: assim o componente nao depende de a pagina
 * ter um <div id="toast"> no HTML, que era o acoplamento do sistema antigo — a
 * funcao toast() falhava calada em qualquer pagina que esquecesse a div. */
import { el } from "../utils/dom.js";

let container = null;
let timer = null;

function garantirContainer() {
  if (container?.isConnected) return container;
  container = document.getElementById("toast") || el("div#toast.toast");
  if (!container.isConnected) document.body.append(container);
  return container;
}

export function toast(mensagem, { tipo = "info", duracao = 3200 } = {}) {
  const node = garantirContainer();
  node.textContent = mensagem;
  node.className = `toast show toast-${tipo}`;
  /* role=alert faz o leitor de tela anunciar. O aviso antigo era invisivel para
   * quem usa leitor: aparecia e sumia sem nunca ser lido. */
  node.setAttribute("role", "alert");

  clearTimeout(timer);
  timer = setTimeout(() => node.classList.remove("show"), duracao);
}

export const toastErro = mensagem => toast(mensagem, { tipo: "erro", duracao: 5000 });
export const toastOk = mensagem => toast(mensagem, { tipo: "ok" });

/* Traduz a falha em algo que o atendente entenda. Mostrar "ErroHttp: 409" para
 * quem esta no balcao no meio do movimento nao ajuda ninguem. */
export function toastFalha(erro, prefixo = "") {
  const mensagem = erro?.codigo === "offline"
    ? "Sem conexão com o servidor. Verifique a rede da loja."
    : erro?.message || "Não foi possível completar a ação.";
  toastErro(prefixo ? `${prefixo}: ${mensagem}` : mensagem);
}
