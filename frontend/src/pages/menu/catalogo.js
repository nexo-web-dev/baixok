/* Vitrine do cardapio: destaques, filtros e grade de produtos. */
import { el, render, $ } from "../../utils/dom.js";
import { reais } from "../../utils/formato.js";
import { rotuloCategoria } from "../../utils/categorias.js";

const normalizarBusca = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

function categoriasFiltro(produtos) {
  const categorias = new Map([["todos", "Todos"]]);
  for (const produto of produtos || []) {
    const categoria = String(produto.category || "").trim();
    if (categoria && !categorias.has(categoria)) categorias.set(categoria, rotuloCategoria(categoria));
  }
  return categorias;
}

/* Sem foto cadastrada mostramos um espaco marcado, nao uma imagem quebrada. */
export function foto(produto, alt = "") {
  if (!produto?.image) {
    return el("div.no-photo", {}, "Sem foto", el("br"), el("small", {}, "Cadastre no painel"));
  }
  return el("img", {
    src: produto.image,
    alt: alt || produto.name || "",
    loading: "lazy",
    decoding: "async",
    onerror: evento => evento.target.replaceWith(
      el("div.no-photo", {}, "Sem foto", el("br"), el("small", {}, "Cadastre no painel"))
    )
  });
}

function cartaoProduto(produto, { lojaAberta = true } = {}) {
  const promocional = produto.emPromocao && produto.precoOriginal > produto.price;

  return el("article.product", {
    class: promocional ? "on-sale" : "",
    dataset: { id: produto.id, acao: "detalhes-produto" },
    role: "button",
    tabIndex: 0
  },
    el("span.badge", {}, promocional ? "Promoção" : (produto.badge || rotuloCategoria(produto.category) || "Item")),
    foto(produto),
    el("div.product-body", {},
      el("strong", {}, produto.name),
      el("p", {}, produto.description || ""),
      el("div.price-row", {},
        el("span", {},
          promocional ? el("s", {}, reais(produto.precoOriginal)) : null,
          promocional ? " " : null,
          reais(produto.price)
        ),
        /* data-acao em vez de onclick: e o que permite a CSP sem
         * 'unsafe-inline' e evita registrar um ouvinte por card a cada
         * redesenho da lista. */
        el("button.primary", {
          type: "button",
          disabled: !lojaAberta,
          dataset: lojaAberta ? { acao: "adicionar", id: produto.id } : {}
        }, lojaAberta ? "Adicionar" : "Loja fechada")
      )
    )
  );
}

/* Prioriza os tres destaques escolhidos no painel. Se faltar algum, completa
 * sozinho para a vitrine nunca ficar vazia. */
function destaques(produtos) {
  const escolhidos = [];
  const juntar = produto => {
    if (produto && !escolhidos.some(item => item.id === produto.id)) escolhidos.push(produto);
  };

  produtos
    .filter(produto => Number(produto.featuredOrder || 0) > 0)
    .sort((a, b) => Number(a.featuredOrder || 0) - Number(b.featuredOrder || 0))
    .forEach(juntar);
  juntar(produtos.find(produto => /baixo k|mais pedida|especial/i.test(`${produto.name} ${produto.badge || ""}`)));
  for (const categoria of ["burgues", "drinks", "pizzas", "massas"]) juntar(produtos.find(produto => produto.category === categoria));
  produtos.forEach(juntar);
  return escolhidos.slice(0, 3);
}

export function desenharDestaques(produtos) {
  const alvo = $("#signature");
  if (!alvo) return;

  render(alvo, ...destaques(produtos).map(produto =>
    el("article", { dataset: { acao: "detalhes-produto", id: produto.id }, role: "button", tabIndex: 0 },
      foto(produto),
      el("div", {},
        el("span", {}, produto.badge || rotuloCategoria(produto.category) || "Destaque"),
        el("strong", {}, produto.name),
        el("em", {}, reais(produto.price))
      )
    )
  ));
}

export function desenharFiltros(produtos, categoriaAtual) {
  const alvo = $("#filters");
  if (!alvo) return;

  render(alvo, ...Array.from(categoriasFiltro(produtos)).map(([chave, rotulo]) =>
    el("button.filter", {
      type: "button",
      class: categoriaAtual === chave ? "active" : "",
      dataset: { acao: "categoria", categoria: chave },
      "aria-pressed": String(categoriaAtual === chave)
    }, rotulo)
  ));
}

export function desenharGrade(produtos, { categoria, busca, lojaAberta = true }) {
  const alvo = $("#menu");
  if (!alvo) return;

  const termo = normalizarBusca(busca || "").trim();
  const lista = produtos.filter(produto => {
    const categoriaOk = categoria === "todos" || produto.category === categoria;
    const buscaOk = !termo ||
      normalizarBusca(`${produto.name} ${produto.description || ""} ${produto.badge || ""} ${produto.category || ""}`).includes(termo);
    return categoriaOk && buscaOk;
  });

  render(alvo, lista.length
    ? lista.map(produto => cartaoProduto(produto, { lojaAberta }))
    : el("p.faint", {}, "Nenhum item disponível nesse filtro."));
}
