/* Cadastro de produtos.
 *
 * A foto continua podendo vir do computador, mas agora e redimensionada antes
 * de subir. O painel antigo gravava o arquivo original em base64 dentro do
 * banco: uma foto de celular de 4 MB virava ~5,5 MB de texto, e o cardapio de
 * todo cliente passava a carregar isso. */
import { el, render, $, delegar } from "../../../utils/dom.js";
import { reais, paraNumero } from "../../../utils/formato.js";
import { rotuloCategoria } from "../../../utils/categorias.js";
import { controlaEstoqueCategoria } from "../../../utils/estoque.js";
import { apiProdutos } from "../../../services/api.js";
import { estado, carregar, promocaoDoProduto } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";

const PRESETS = [
  { label: "Pizza", src: "images/produto-pizza.png" },
  { label: "Burguer", src: "images/produto-burguer.png" },
  { label: "Massa", src: "images/produto-massa.png" },
  { label: "Drink", src: "images/produto-drinks.png" }
];

const LADO_MAXIMO = 720;
const QUALIDADE = 0.72;
const LIMITE_IMAGEM = 260_000;
let filtroCategoria = "todos";
let filtroBusca = "";

const normalizarBusca = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

function categoriasDosProdutos() {
  const mapa = new Map();
  for (const produto of estado.produtos || []) {
    const categoria = String(produto.category || "").trim();
    if (categoria && !mapa.has(categoria)) mapa.set(categoria, rotuloCategoria(categoria));
  }
  return mapa;
}

const categoriasFiltro = () => new Map([["todos", "Todos"], ...categoriasDosProdutos()]);
const normalizarImagem = valor => String(valor || "").trim().replace(/^\/images\//, "images/");

function atualizarCampoEstoqueProduto() {
  const campo = $("#product-stock");
  if (!campo) return;

  const controla = controlaEstoqueCategoria($("#product-category")?.value);
  campo.disabled = !controla;
  campo.placeholder = controla ? "Estoque (bebidas)" : "Sem estoque para comida";
  campo.title = controla
    ? "Use este campo para bebidas, refrigerantes e drinks."
    : "Pizza, burguer, massa e porcao ficam ativos pelo cadastro, sem estoque operacional.";
  if (!controla) campo.value = "";
}

/* Redimensiona e recomprime no proprio navegador antes de enviar. */
function prepararFoto(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo.type.startsWith("image/")) return reject(new Error("Escolha um arquivo de imagem."));
    if (arquivo.size > 12 * 1024 * 1024) return reject(new Error("Imagem muito grande. Use até 12 MB."));

    const url = URL.createObjectURL(arquivo);
    const imagem = new Image();
    imagem.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(imagem.width * escala);
      canvas.height = Math.round(imagem.height * escala);
      canvas.getContext("2d").drawImage(imagem, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", QUALIDADE);
      if (dataUrl.length > LIMITE_IMAGEM) return reject(new Error("Imagem ainda muito pesada. Tente uma foto menor."));
      resolve(dataUrl);
    };
    imagem.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    imagem.src = url;
  });
}

function atualizarPreview(valor) {
  const normalizado = normalizarImagem(valor);
  const preview = $("#product-photo-preview");
  const vazio = $(".photo-empty");
  if (preview) {
    preview.src = normalizado || "";
    preview.classList.toggle("hidden", !normalizado);
  }
  if (vazio) vazio.classList.toggle("hidden", Boolean(normalizado));
}

function cardProduto(produto) {
  const promocao = promocaoDoProduto(produto.id);
  const controlaEstoque = controlaEstoqueCategoria(produto.category);
  const semEstoque = controlaEstoque && produto.stock <= 0;

  return el("article.admin-product-card", { dataset: { id: produto.id } },
    el("div.admin-product-thumb", {}, produto.image
      ? el("img", { src: produto.image, alt: produto.name, loading: "lazy" })
      : el("div.no-photo", {}, "Sem foto")),
    el("div.admin-product-main", {},
      el("div.admin-product-title", {},
        el("span.pill.order-pill", {}, `Ordem ${produto.order || "-"}`),
        produto.featuredOrder
          ? el("span.pill.featured-pill", {}, `Destaque ${produto.featuredOrder}`)
          : null,
        el("strong", {}, produto.name),
        el("span.pill", { class: produto.active ? "is-active" : "is-paused" }, produto.active ? (semEstoque ? "Esgotado" : "Ativo") : "Pausado")
      ),
      el("p", {}, produto.description || "Sem descrição cadastrada."),
      el("div.admin-product-meta", {},
        el("span", {}, rotuloCategoria(produto.category)),
        el("span.price", {},
          promocao ? el("s", {}, reais(produto.price)) : null,
          promocao ? " " : null,
          reais(promocao ? promocao.price : produto.price)
        ),
        controlaEstoque
          ? el("span", { class: produto.stock <= produto.minStock ? "danger-text" : "" }, `${produto.stock} em estoque`)
          : el("span", {}, "sem controle de estoque")
      )
    ),
    el("div.row-actions", { class: "right" },
      el("button.ghost.small", { type: "button", title: "Subir no cardápio", dataset: { acao: "mover-ordem", id: produto.id, direction: "up" } }, "Subir"),
      el("button.ghost.small", { type: "button", title: "Descer no cardápio", dataset: { acao: "mover-ordem", id: produto.id, direction: "down" } }, "Descer"),
      el("button.ghost.small", { type: "button", dataset: { acao: "editar", id: produto.id } }, "Editar"),
      el("button.ghost.small", { type: "button", dataset: { acao: "alternar", id: produto.id } },
        produto.active ? "Pausar" : "Ativar"),
      el("button.danger.small", { type: "button", dataset: { acao: "remover", id: produto.id } }, "Excluir")
    )
  );
}

function desenharFiltrosProdutos() {
  const alvo = $("#product-category-filters");
  if (!alvo) return;

  render(alvo, ...Array.from(categoriasFiltro()).map(([categoria, rotulo]) =>
    el("button.filter", {
      type: "button",
      class: filtroCategoria === categoria ? "active" : "",
      dataset: { acao: "filtrar-categoria", categoria },
      "aria-pressed": String(filtroCategoria === categoria)
    }, rotulo)
  ));
}

function produtosFiltrados() {
  const termo = normalizarBusca(filtroBusca);
  return estado.produtos.filter(produto => {
    const categoriaOk = filtroCategoria === "todos" || produto.category === filtroCategoria;
    const texto = normalizarBusca(`${produto.name} ${produto.description || ""} ${produto.category || ""}`);
    return categoriaOk && (!termo || texto.includes(termo));
  });
}

function produtosAgrupados(produtos) {
  const grupos = new Map();
  for (const produto of produtos) {
    const categoria = String(produto.category || "Sem categoria").trim();
    if (!grupos.has(categoria)) grupos.set(categoria, []);
    grupos.get(categoria).push(produto);
  }
  return Array.from(grupos);
}

function grupoCategoria(categoria, produtos) {
  return el("section.product-category-group", {},
    el("header", {},
      el("h3", {}, rotuloCategoria(categoria)),
      el("span", {}, `${produtos.length} ${produtos.length === 1 ? "item" : "itens"}`)
    ),
    el("div.product-category-list", {}, ...produtos.map(cardProduto))
  );
}

export function desenharProdutos() {
  const alvo = $("#product-admin-list");
  if (!alvo) return;

  if (filtroCategoria !== "todos" && !estado.produtos.some(produto => produto.category === filtroCategoria)) {
    filtroCategoria = "todos";
  }
  desenharFiltrosProdutos();
  const produtos = produtosFiltrados();

  render(alvo, produtos.length
    ? produtosAgrupados(produtos).map(([categoria, itens]) => grupoCategoria(categoria, itens))
    : el("p.faint.pad", {}, "Nenhum produto cadastrado nesse filtro."));

  const presets = $("#photo-presets");
  if (presets && !presets.childElementCount) {
    render(presets, ...PRESETS.map(preset =>
      el("img", {
        src: preset.src, alt: preset.label, title: preset.label,
        dataset: { acao: "preset", src: preset.src }
      })
    ));
  }

  const categorias = $("#product-category-options");
  if (categorias) {
    render(categorias, ...Array.from(categoriasDosProdutos()).map(([categoria, rotulo]) =>
      el("option", { value: categoria }, rotulo)
    ));
  }
}

function limparFormulario() {
  $("#product-id").value = "";
  $("#product-name").value = "";
  $("#product-description").value = "";
  $("#product-price").value = "";
  $("#product-stock").value = "";
  $("#product-order").value = "";
  $("#product-featured").value = "0";
  $("#product-category").value = "";
  atualizarCampoEstoqueProduto();
  $("#product-image").value = "";
  $("#product-active").checked = true;
  $("#product-form-title").textContent = "Novo produto";
  $("#product-save-label").textContent = "Cadastrar produto";
  atualizarPreview("");
}

function editar(id) {
  const produto = estado.produtos.find(item => item.id === id);
  if (!produto) return;

  $("#product-id").value = produto.id;
  $("#product-name").value = produto.name;
  $("#product-description").value = produto.description || "";
  $("#product-price").value = String(produto.price);
  $("#product-order").value = String(produto.order || "");
  $("#product-featured").value = String(produto.featuredOrder || 0);
  $("#product-category").value = produto.category;
  atualizarCampoEstoqueProduto();
  $("#product-stock").value = controlaEstoqueCategoria(produto.category) ? String(produto.stock) : "";
  $("#product-image").value = produto.image || "";
  $("#product-active").checked = produto.active;
  $("#product-form-title").textContent = `Editando: ${produto.name}`;
  $("#product-save-label").textContent = "Salvar alterações";
  atualizarPreview(produto.image || "");
  $("#product-name").focus();
}

async function salvar(evento) {
  evento.preventDefault();
  const id = $("#product-id").value;
  const categoria = $("#product-category").value.trim();
  const controlaEstoque = controlaEstoqueCategoria(categoria);

  const corpo = {
    name: $("#product-name").value.trim(),
    description: $("#product-description").value.trim(),
    category: categoria,
    price: paraNumero($("#product-price").value),
    stock: controlaEstoque ? Math.max(0, Math.floor(paraNumero($("#product-stock").value))) : 0,
    minStock: controlaEstoque ? (estado.produtos.find(item => item.id === id)?.minStock ?? 4) : 0,
    order: Math.max(1, Math.floor(paraNumero($("#product-order").value) || ((estado.produtos.length || 0) + 1))),
    featuredOrder: Math.max(0, Math.min(3, Math.floor(paraNumero($("#product-featured").value) || 0))),
    active: $("#product-active").checked,
    image: normalizarImagem($("#product-image").value)
  };

  try {
    if (id) await apiProdutos.atualizar(id, corpo);
    else await apiProdutos.criar(corpo);
    await carregar("produtos");
    desenharProdutos();
    limparFormulario();
    toast("Produto salvo.");
  } catch (erro) {
    toastFalha(erro);
  }
}

export function ligarProdutos() {
  const lista = $("#product-admin-list");
  const presets = $("#photo-presets");
  const tabela = $("#product-table");

  delegar(lista, "click", "[data-acao='editar']", (_e, botao) => editar(botao.dataset.id));

  delegar(lista, "click", "[data-acao='mover-ordem']", async (_e, botao) => {
    try {
      await apiProdutos.moverOrdem(botao.dataset.id, botao.dataset.direction);
      await carregar("produtos");
      desenharProdutos();
    } catch (erro) {
      toastFalha(erro);
    }
  });

  delegar(lista, "click", "[data-acao='alternar']", async (_e, botao) => {
    try {
      await apiProdutos.alternarAtivo(botao.dataset.id);
      await carregar("produtos");
      desenharProdutos();
    } catch (erro) { toastFalha(erro); }
  });

  delegar(lista, "click", "[data-acao='remover']", async (_e, botao) => {
    const produto = estado.produtos.find(item => item.id === botao.dataset.id);
    if (!confirm(`Excluir "${produto?.name}"? Para só tirar do cardápio, use Pausar.`)) return;
    try {
      await apiProdutos.remover(botao.dataset.id);
      await carregar("produtos");
      desenharProdutos();
      toast("Produto excluido.");
    } catch (erro) { toastFalha(erro); }
  });

  delegar(tabela, "click", "[data-acao='filtrar-categoria']", (_e, botao) => {
    filtroCategoria = botao.dataset.categoria || "todos";
    desenharProdutos();
  });

  delegar(presets, "click", "[data-acao='preset']", (_e, imagem) => {
    const src = normalizarImagem(imagem.dataset.src);
    $("#product-image").value = src;
    atualizarPreview(src);
  });

  $("#form-produto")?.addEventListener("submit", salvar);
  $("#product-reset")?.addEventListener("click", limparFormulario);
  $("#product-search")?.addEventListener("input", evento => {
    filtroBusca = evento.target.value;
    desenharProdutos();
  });
  $("#product-image")?.addEventListener("input", evento => atualizarPreview(evento.target.value));
  $("#product-category")?.addEventListener("input", atualizarCampoEstoqueProduto);
  $("#product-category")?.addEventListener("change", atualizarCampoEstoqueProduto);
  atualizarCampoEstoqueProduto();
  $("#product-photo-button")?.addEventListener("click", () => $("#product-photo-file").click());

  $("#product-photo-file")?.addEventListener("change", async evento => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    try {
      const dataUrl = await prepararFoto(arquivo);
      $("#product-image").value = dataUrl;
      atualizarPreview(dataUrl);
    } catch (erro) {
      toastFalha(erro);
    } finally {
      evento.target.value = "";
    }
  });
}
