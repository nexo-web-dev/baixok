/* Vitrine do cardapio: destaques, filtros e grade de produtos. */
import { el, render, $ } from "../../utils/dom.js";
import { reais } from "../../utils/formato.js";
import { rotuloCategoria } from "../../utils/categorias.js";
import { marcarProporcaoImagem } from "../../utils/fotos.js";

const normalizarBusca = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

/* Ordem fixa pedida pela casa, por trecho do nome (o cadastro e texto livre —
 * "Pizzas Salgadas", "Bebidas" — entao comparar chave exata perderia
 * variacao de grafia). Categoria fora dessa lista fica no meio, antes de
 * Promoções/Combos, que sempre vao por ultimo. */
const ORDEM_CATEGORIA = ["burg", "pizza", "por", "bebid", "drink"];
const ORDEM_ULTIMOS = ["promo", "combo"];

function pesoCategoria(chave, rotulo) {
  const alvo = normalizarBusca(`${chave} ${rotulo}`);
  if (ORDEM_ULTIMOS.some(termo => alvo.includes(termo))) return 100;
  const indice = ORDEM_CATEGORIA.findIndex(termo => alvo.includes(termo));
  return indice === -1 ? 50 : indice;
}

/* Sem "Todos": o filtro comeca sem nada selecionado (mostra tudo, ver
 * estado.categoria em index.js) e cada botao so filtra pra sua categoria.
 * "promocoes" nao e categoria de verdade: e um filtro por cima de qualquer
 * categoria, entao so aparece quando ha pelo menos um item promocional no
 * momento — nao faz sentido oferecer um filtro que sempre daria vazio. Sem
 * produto cadastrado numa categoria, ela nem entra no mapa — nunca aparece
 * um botao vazio. */
function categoriasFiltro(produtos) {
  const categorias = new Map();
  if ((produtos || []).some(produto => produto.emPromocao)) categorias.set("promocoes", "Promoções");
  for (const produto of produtos || []) {
    const categoria = String(produto.category || "").trim();
    if (categoria && !categorias.has(categoria)) categorias.set(categoria, rotuloCategoria(categoria));
  }
  return new Map(
    [...categorias.entries()].sort(([chaveA, rotuloA], [chaveB, rotuloB]) =>
      pesoCategoria(chaveA, rotuloA) - pesoCategoria(chaveB, rotuloB))
  );
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

/* Sem foto cadastrada mostramos um espaco marcado, nao uma imagem quebrada.
 *
 * `prioridade` e so pras fotos que aparecem na hora que a pagina abre
 * (destaques e as primeiras da grade) — carregam eager/sync pra nao dar
 * flash de espaco vazio. O resto da grade e lazy/async: com o cardapio
 * crescendo, forcar toda foto a baixar e decodificar na hora travava a
 * pagina num catalogo grande, mesmo com a maioria fora da tela. */
export function foto(produto, alt = "", { prioridade = false } = {}) {
  if (!produto?.image) {
    return semFoto();
  }
  return el("span.photo-frame.fit-media", { class: classeFoto(produto) },
    el("img.photo-main.fit-media-main", {
      onload: marcarProporcaoImagem,
      src: produto.image,
      alt: alt || produto.name || "",
      loading: prioridade ? "eager" : "lazy",
      fetchpriority: prioridade ? "high" : "auto",
      decoding: prioridade ? "sync" : "async",
      onerror: evento => evento.target.closest(".photo-frame")?.replaceWith(semFoto())
    })
  );
}

/* Selo "leve e ganhe" com a foto do brinde — usado no card da grade e no
 * detalhe do produto, pra quem abrir o produto tambem ver o que vai ganhar. */
export function blocoBrindes(produto) {
  if (!produto.brindesPromocionais?.length) return null;
  return el("div.product-gifts", {}, ...produto.brindesPromocionais.map(brinde =>
    el("span.product-gift", {},
      brinde.giftImage
        ? el("img.product-gift-photo", {
            src: brinde.giftImage, alt: "", loading: "lazy", decoding: "async",
            onerror: evento => evento.target.remove()
          })
        : null,
      `Leve ${brinde.buyQty} e ganhe ${brinde.giftQty} ${brinde.giftName}`
    )
  ));
}

function cartaoProduto(produto, { lojaAberta = true, prioridade = false } = {}) {
  const promocional = produto.emPromocao && produto.precoOriginal > produto.price;

  return el("article.product", {
    class: promocional ? "on-sale" : "",
    dataset: { id: produto.id, acao: "detalhes-produto" },
    role: "button",
    tabIndex: 0
  },
    el("span.badge", {}, promocional ? "Promoção" : (produto.badge || rotuloCategoria(produto.category) || "Item")),
    foto(produto, "", { prioridade }),
    el("div.product-body", {},
      el("strong", {}, produto.name),
      el("p", {}, produto.description || ""),
      blocoBrindes(produto),
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
      foto(produto, "", { prioridade: true }),
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

/* So as primeiras da grade carregam com prioridade — sao as que aparecem na
 * hora que a pagina abre, antes de rolar. */
const CARDS_PRIORITARIOS = 6;

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
    ? lista.map((produto, indice) => cartaoProduto(produto, { lojaAberta, prioridade: indice < CARDS_PRIORITARIOS }))
    : el("p.faint", {}, "Nenhum item disponível nesse filtro."));
}
