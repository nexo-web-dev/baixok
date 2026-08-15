/* Vitrine do cardapio: destaques, filtros e grade de produtos. */
import { el, render, $ } from "../../utils/dom.js";
import { reais } from "../../utils/formato.js";
import { rotuloCategoria } from "../../utils/categorias.js";
import { marcarProporcaoImagem } from "../../utils/fotos.js";

const normalizarBusca = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

/* "promocoes" nao e categoria de verdade: e um filtro por cima de qualquer
 * categoria, entao so aparece quando ha pelo menos um item promocional no
 * momento — nao faz sentido oferecer um filtro que sempre daria vazio. */
function categoriasFiltro(produtos) {
  const categorias = new Map([["todos", "Todos"]]);
  if ((produtos || []).some(produto => produto.emPromocao)) categorias.set("promocoes", "Promoções");
  for (const produto of produtos || []) {
    const categoria = String(produto.category || "").trim();
    if (categoria && !categorias.has(categoria)) categorias.set(categoria, rotuloCategoria(categoria));
  }
  return categorias;
}

function semFoto() {
  return el("div.no-photo", {}, "Sem foto", el("br"), el("small", {}, "Cadastre no painel"));
}

function classeFoto(produto) {
  const categoria = normalizarBusca(produto?.category || produto?.badge || produto?.name || "");
  const comida = /(pizza|burguer|hamburg|massa|porcao|porcoes|batata)/.test(categoria);
  const bebida = /(drink|bebida|refri|refrigerante|cerveja|coca|guarana|agua|suco|item)/.test(categoria);
  if (bebida && !comida) return "is-beverage";
  if (comida) return "is-food";
  return "";
}

/* Sem foto cadastrada mostramos um espaco marcado, nao uma imagem quebrada. */
export function foto(produto, alt = "") {
  if (!produto?.image) {
    return semFoto();
  }
  return el("span.photo-frame.fit-media", { class: classeFoto(produto) },
    el("img.photo-main.fit-media-main", {
      onload: marcarProporcaoImagem,
      src: produto.image,
      alt: alt || produto.name || "",
      loading: "eager",
      fetchpriority: "high",
      decoding: "sync",
      onerror: evento => evento.target.closest(".photo-frame")?.replaceWith(semFoto())
    })
  );
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
      produto.brindePromocional
        ? el("span.product-gift", {}, `Leve ${produto.brindePromocional.buyQty} e ganhe ${produto.brindePromocional.giftQty} ${produto.brindePromocional.giftName}`)
        : null,
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

/* Destaque nunca e preenchido automaticamente: so aparece o que foi marcado no
 * cadastro do produto, com a foto cadastrada nele. */
function destaques(produtos) {
  return produtos
    .filter(produto => Number(produto.featuredOrder || 0) > 0)
    .sort((a, b) => Number(a.featuredOrder || 0) - Number(b.featuredOrder || 0))
    .slice(0, 3);
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
    const categoriaOk = categoria === "todos"
      || (categoria === "promocoes" ? Boolean(produto.emPromocao) : produto.category === categoria);
    const buscaOk = !termo ||
      normalizarBusca(`${produto.name} ${produto.description || ""} ${produto.badge || ""} ${produto.category || ""}`).includes(termo);
    return categoriaOk && buscaOk;
  });

  render(alvo, lista.length
    ? lista.map(produto => cartaoProduto(produto, { lojaAberta }))
    : el("p.faint", {}, "Nenhum item disponível nesse filtro."));
}
