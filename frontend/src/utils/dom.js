/* Construcao de DOM sem innerHTML.
 *
 * O sistema antigo montava tela inteira com template string + innerHTML, e se
 * defendia com um escapeHtml() chamado a mao em cada interpolacao. Bastava
 * esquecer um — e havia varios pontos sem ele — para o nome de um produto virar
 * execucao de script no cardapio de todo cliente.
 *
 * Aqui o texto entra por textContent, que nao interpreta marcacao nenhuma.
 * Esquecer de escapar deixa de ser possivel porque nao ha mais o que escapar. */

/* el("div.card", { onclick }, "texto", outroNode)
 *
 * O seletor aceita tag, .classe e #id, na mesma sintaxe do CSS. */
export function el(seletor, props = {}, ...filhos) {
  const [tag = "div", ...resto] = seletor.split(/(?=[.#])/);
  const node = document.createElement(tag || "div");

  for (const parte of resto) {
    if (parte.startsWith(".")) node.classList.add(parte.slice(1));
    else if (parte.startsWith("#")) node.id = parte.slice(1);
  }

  for (const [chave, valor] of Object.entries(props || {})) {
    if (valor === null || valor === undefined || valor === false) continue;

    if (chave === "class") node.className = [node.className, valor].filter(Boolean).join(" ");
    else if (chave === "dataset") Object.assign(node.dataset, valor);
    else if (chave === "style" && typeof valor === "object") Object.assign(node.style, valor);
    else if (chave.startsWith("on") && typeof valor === "function") node.addEventListener(chave.slice(2), valor);
    /* Propriedade, nao atributo: `node.textContent = x` nunca interpreta HTML,
     * e `node.value = x` funciona em input. */
    else if (chave in node) node[chave] = valor;
    else node.setAttribute(chave, String(valor));
  }

  anexar(node, filhos);
  return node;
}

function anexar(node, filhos) {
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false || filho === true) continue;
    node.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
}

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

/* Troca o conteudo de um container. */
export function render(alvo, ...filhos) {
  if (!alvo) return null;
  alvo.replaceChildren();
  anexar(alvo, filhos);
  return alvo;
}

export const mostrar = (node, visivel) => node?.classList.toggle("hidden", !visivel);

/* Segura a chamada ate a digitacao parar. Sem isso, um campo de busca refaz a
 * lista inteira (filtra + redesenha DOM) a cada tecla — em catalogos maiores
 * isso empaca o campo bem na hora que a pessoa mais precisa dele fluido. */
export function debounce(fn, atraso = 180) {
  let temporizador = null;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), atraso);
  };
}

/* Delegacao de evento: um ouvinte no container em vez de um por linha.
 *
 * E o que substitui os onclick="funcao(id)" do HTML antigo. Alem de permitir
 * uma CSP sem 'unsafe-inline', evita que redesenhar uma lista de 200 pedidos
 * registre 200 ouvintes novos a cada atualizacao.
 *
 *   delegar(lista, "click", "[data-acao='cancelar']", (evento, alvo) => ...)
 */
export function delegar(container, tipo, seletor, callback) {
  if (!container) return () => {};
  const ouvinte = evento => {
    const alvo = evento.target.closest(seletor);
    if (alvo && container.contains(alvo)) callback(evento, alvo);
  };
  container.addEventListener(tipo, ouvinte);
  return () => container.removeEventListener(tipo, ouvinte);
}

/* Fecha modal com clique fora e com Esc. O sistema antigo so tratava o clique,
 * entao o teclado nao fechava nada — problema real de acessibilidade. */
export function ligarModal(modal, aoFechar) {
  if (!modal) return () => {};
  const fechar = () => aoFechar();

  const noClique = evento => { if (evento.target === modal) fechar(); };
  const naTecla = evento => {
    if (evento.key === "Escape" && !modal.classList.contains("hidden")) fechar();
  };

  modal.addEventListener("click", noClique);
  document.addEventListener("keydown", naTecla);
  return () => {
    modal.removeEventListener("click", noClique);
    document.removeEventListener("keydown", naTecla);
  };
}
