/* Cadastro de produtos.
 *
 * A foto continua podendo vir do computador, mas agora e redimensionada antes
 * de subir. O painel antigo gravava o arquivo original em base64 dentro do
 * banco: uma foto de celular de 4 MB virava ~5,5 MB de texto, e o cardapio de
 * todo cliente passava a carregar isso. */
import { el, render, $, $$, delegar, mostrar } from "../../../utils/dom.js";
import { reais, paraNumero } from "../../../utils/formato.js";
import { rotuloCategoria } from "../../../utils/categorias.js";
import { controlaEstoqueCategoria } from "../../../utils/estoque.js";
import { apiProdutos } from "../../../services/api.js";
import { estado, carregar, promocaoDoProduto } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";
import { exportarCardapioPdf } from "../../../components/cardapio-pdf.js";

const PRESETS = [
  { label: "Pizza", src: "images/produto-pizza.png" },
  { label: "Burguer", src: "images/produto-burguer.png" },
  { label: "Massa", src: "images/produto-massa.png" },
  { label: "Drink", src: "images/produto-drinks.png" }
];

const LADO_MAXIMO = 720;
const QUALIDADE = 0.72;
const LIMITE_IMAGEM = 1_200_000;
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
const EXTENSAO_IMAGEM = /\.(png|jpe?g|webp)(?:$|[?#])/i;
const CATEGORIA_SEGURA = /^[\p{L}\p{N}\s&+.,()/-]{2,42}$/u;

function avisoImagemProduto(valor) {
  const foto = normalizarImagem(valor);
  if (!foto) return "";
  if (/[\r\n<>"']/.test(foto)) {
    return "A foto foi mantida, mas pode falhar por conter quebra de linha, aspas ou simbolos. Prefira Enviar foto ou link direto.";
  }
  if (foto.startsWith("data:image/")) {
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(foto)) {
      return "A foto foi mantida, mas o formato pode nao abrir em alguns celulares. Prefira PNG, JPG ou WEBP.";
    }
    if (foto.length > LIMITE_IMAGEM + 2_000) {
      return "A foto foi mantida, mas pode deixar o cardapio pesado. Prefira Enviar foto para reduzir antes de salvar.";
    }
    return "";
  }
  if (/^https?:\/\//i.test(foto)) {
    try {
      new URL(foto);
    } catch {
      return "A foto foi mantida, mas o link parece incompleto. Confira se abre no navegador.";
    }
    return EXTENSAO_IMAGEM.test(foto) || foto.includes("/api/")
      ? ""
      : "A foto foi mantida, mas links sem .jpg, .png ou .webp podem falhar em alguns celulares.";
  }
  if (!foto.includes("..") && /^(images|uploads|api|\/api)\//i.test(foto)) {
    return EXTENSAO_IMAGEM.test(foto) || foto.includes("/api/")
      ? ""
      : "A foto foi mantida, mas caminhos sem .jpg, .png ou .webp podem nao carregar.";
  }
  return "A foto foi mantida, mas pode nao abrir. Use Enviar foto, URL direta ou caminho images/arquivo.png quando possivel.";
}

function atualizarAvisoFotoProduto(valor) {
  const alvo = $("#product-image-warning");
  if (!alvo) return;
  const aviso = avisoImagemProduto(valor);
  alvo.textContent = aviso;
  alvo.classList.toggle("hidden", !aviso);
}

function validarProduto(corpo, { controlaEstoque }) {
  if (!corpo.name || corpo.name.length < 2) return "Informe o nome do produto.";
  if (corpo.name.length > 80) return "Nome do produto muito longo.";
  if (!corpo.category || !CATEGORIA_SEGURA.test(corpo.category)) {
    return "Informe uma categoria valida, como Pizzas, Burguer, Bebidas ou Porcoes.";
  }
  if (!(corpo.price > 0)) return "Informe um preco maior que zero.";
  if (controlaEstoque && (!Number.isFinite(corpo.stock) || corpo.stock < 0)) return "Informe um estoque valido para bebida.";
  if (controlaEstoque && (!Number.isFinite(corpo.minStock) || corpo.minStock < 0)) return "Informe o estoque minimo para alerta.";
  if (corpo.description.length > 420) return "Descricao muito longa. Use um texto mais curto.";
  return "";
}

function atualizarCampoEstoqueProduto() {
  const campo = $("#product-stock");
  const minimo = $("#product-min-stock");
  if (!campo) return;

  const controla = controlaEstoqueCategoria($("#product-category")?.value);
  campo.disabled = !controla;
  campo.placeholder = controla ? "Estoque (bebidas)" : "Sem estoque para comida";
  campo.title = controla
    ? "Use este campo para bebidas, refrigerantes e drinks."
    : "Pizza, burguer, massa e porcao ficam ativos pelo cadastro, sem estoque operacional.";
  if (minimo) {
    minimo.disabled = !controla;
    minimo.placeholder = controla ? "Estoque minimo para alerta" : "Sem minimo para comida";
    minimo.title = controla
      ? "Quando o estoque atual ficar igual ou abaixo deste numero, a aba Estoque pisca em vermelho."
      : "Estoque minimo so e usado para bebidas, refrigerantes e drinks.";
  }
  if (!controla) {
    campo.value = "";
    if (minimo) minimo.value = "";
  }
}

/* Sabor de pizza nao e escolha por produto: e a categoria inteira. Categoria
 * e texto livre ("Pizzas Salgadas", "Pizzas Doces", "pizzas"...), entao a
 * checagem e por conter "pizza", nao pela string inteira igual. Quem decide
 * quais combinacoes vendem de verdade e a aba de combinacoes de sabores —
 * aqui e so informativo, sempre travado. */
function atualizarCampoSaborPizza() {
  const campo = $("#product-sabor-pizza");
  if (!campo) return;
  campo.checked = normalizarBusca($("#product-category")?.value).includes("pizza");
  campo.disabled = true;
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
  atualizarAvisoFotoProduto(normalizado);
  const preview = $("#product-photo-preview");
  const vazio = $(".photo-empty");
  if (preview) {
    preview.src = normalizado || "";
    preview.classList.toggle("hidden", !normalizado);
  }
  if (vazio) vazio.classList.toggle("hidden", Boolean(normalizado));
}

function fotoProdutoAdmin(produto) {
  if (!produto?.image) return el("div.no-photo", {}, "Sem foto");
  return el("span.fit-media", {},
    el("img.fit-media-bg", {
      src: produto.image,
      alt: "",
      loading: "lazy",
      decoding: "async",
      "aria-hidden": "true"
    }),
    el("img.fit-media-main", {
      src: produto.image,
      alt: produto.name || "Produto",
      loading: "lazy",
      decoding: "async",
      onerror: evento => evento.target.closest(".fit-media")?.replaceWith(el("div.no-photo", {}, "Sem foto"))
    })
  );
}

function cardProduto(produto) {
  const promocao = promocaoDoProduto(produto.id);
  const controlaEstoque = controlaEstoqueCategoria(produto.category);
  const semEstoque = controlaEstoque && produto.stock <= 0;

  return el("article.admin-product-card", { draggable: true, title: "Segure e arraste para mudar a ordem", dataset: { id: produto.id } },
    el("div.admin-product-thumb", {}, fotoProdutoAdmin(produto)),
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

async function salvarOrdemVisivel(grupo) {
  const ids = [...grupo.querySelectorAll(".admin-product-card")]
    .map(card => card.dataset.id)
    .filter(Boolean);
  if (ids.length < 2) return;

  try {
    await apiProdutos.reordenar(ids);
    await carregar("produtos");
    desenharProdutos();
    toast("Ordem do cardapio atualizada.");
  } catch (erro) {
    toastFalha(erro);
    await carregar("produtos");
    desenharProdutos();
  }
}

function ligarArrastarProdutos(lista) {
  if (!lista || lista.dataset.dragProdutosLigado) return;
  lista.dataset.dragProdutosLigado = "1";

  let arrastando = null;
  let grupoAtual = null;
  let temporizadorPressionar = null;
  let pressaoCard = null;
  let pressaoGrupo = null;
  let pressaoInicio = null;
  const LIMIAR_MOVIMENTO_PX = 10;
  const TEMPO_PRESSIONAR_MS = 300;

  const cardMaisProximo = (grupo, y) => {
    const cards = [...grupo.querySelectorAll(".admin-product-card:not(.is-dragging)")];
    return cards.reduce((melhor, card) => {
      const box = card.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      return offset < 0 && offset > melhor.offset ? { offset, card } : melhor;
    }, { offset: Number.NEGATIVE_INFINITY, card: null }).card;
  };

  const moverNoGrupo = y => {
    if (!arrastando || !grupoAtual) return;
    const antes = cardMaisProximo(grupoAtual, y);
    if (antes) grupoAtual.insertBefore(arrastando, antes);
    else grupoAtual.appendChild(arrastando);
  };

  lista.addEventListener("dragstart", evento => {
    const card = evento.target.closest(".admin-product-card");
    const controle = evento.target.closest("button, a, input, select, textarea");
    if (!card || controle) {
      evento.preventDefault();
      return;
    }
    arrastando = card;
    grupoAtual = card.closest(".product-category-list");
    card.classList.add("is-dragging");
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData("text/plain", card.dataset.id || "");
  });

  lista.addEventListener("dragover", evento => {
    if (!arrastando || !grupoAtual || evento.target.closest(".product-category-list") !== grupoAtual) return;
    evento.preventDefault();
    moverNoGrupo(evento.clientY);
  });

  lista.addEventListener("dragend", async () => {
    if (!arrastando) return;
    const grupo = grupoAtual;
    arrastando.classList.remove("is-dragging");
    arrastando = null;
    grupoAtual = null;
    if (grupo) await salvarOrdemVisivel(grupo);
  });

  const cancelarPressao = () => {
    if (temporizadorPressionar) clearTimeout(temporizadorPressionar);
    temporizadorPressionar = null;
    pressaoCard = null;
    pressaoGrupo = null;
    pressaoInicio = null;
  };

  lista.addEventListener("pointerdown", evento => {
    const card = evento.target.closest(".admin-product-card");
    const controle = evento.target.closest("button, a, input, select, textarea");
    if (!card || controle || evento.pointerType === "mouse") return;

    pressaoCard = card;
    pressaoGrupo = card.closest(".product-category-list");
    pressaoInicio = { x: evento.clientX, y: evento.clientY, pointerId: evento.pointerId };
    temporizadorPressionar = setTimeout(() => {
      temporizadorPressionar = null;
      arrastando = pressaoCard;
      grupoAtual = pressaoGrupo;
      arrastando.classList.add("is-dragging");
      arrastando.setPointerCapture?.(pressaoInicio.pointerId);
    }, TEMPO_PRESSIONAR_MS);
  }, { passive: true });

  lista.addEventListener("pointermove", evento => {
    if (evento.pointerType === "mouse") return;

    if (arrastando && grupoAtual) {
      moverNoGrupo(evento.clientY);
      evento.preventDefault();
      return;
    }

    if (temporizadorPressionar && pressaoInicio) {
      const dx = evento.clientX - pressaoInicio.x;
      const dy = evento.clientY - pressaoInicio.y;
      if (Math.hypot(dx, dy) > LIMIAR_MOVIMENTO_PX) cancelarPressao();
    }
  }, { passive: false });

  const finalizarPonteiro = async evento => {
    cancelarPressao();
    if (!arrastando || !grupoAtual || evento.pointerType === "mouse") return;
    const grupo = grupoAtual;
    arrastando.classList.remove("is-dragging");
    arrastando.releasePointerCapture?.(evento.pointerId);
    arrastando = null;
    grupoAtual = null;
    await salvarOrdemVisivel(grupo);
  };

  lista.addEventListener("pointerup", finalizarPonteiro);
  lista.addEventListener("pointercancel", finalizarPonteiro);
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
  $("#product-min-stock").value = "";
  $("#product-order").value = "";
  $("#product-featured").value = "0";
  $("#product-category").value = "";
  atualizarCampoEstoqueProduto();
  atualizarCampoSaborPizza();
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
  atualizarCampoSaborPizza();
  $("#product-stock").value = controlaEstoqueCategoria(produto.category) ? String(produto.stock) : "";
  $("#product-min-stock").value = controlaEstoqueCategoria(produto.category) ? String(produto.minStock ?? 4) : "";
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
  const minStockDigitado = $("#product-min-stock").value.trim();

  const corpo = {
    name: $("#product-name").value.trim(),
    description: $("#product-description").value.trim(),
    category: categoria,
    price: paraNumero($("#product-price").value),
    stock: controlaEstoque ? Math.max(0, Math.floor(paraNumero($("#product-stock").value))) : 0,
    minStock: controlaEstoque ? Math.max(0, Math.floor(minStockDigitado === "" ? 4 : paraNumero(minStockDigitado))) : 0,
    order: Math.max(1, Math.floor(paraNumero($("#product-order").value) || ((estado.produtos.length || 0) + 1))),
    featuredOrder: Math.max(0, Math.min(3, Math.floor(paraNumero($("#product-featured").value) || 0))),
    active: $("#product-active").checked,
    saborPizza: $("#product-sabor-pizza").checked,
    image: normalizarImagem($("#product-image").value)
  };

  const erroValidacao = validarProduto(corpo, { controlaEstoque });
  if (erroValidacao) {
    toastFalha(new Error(erroValidacao));
    return;
  }

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

function abrirModalExportarPdf() {
  const lista = $("#menu-pdf-list");
  if (!lista) return;

  const ativos = estado.produtos.filter(produto => produto.active);
  render(lista, ...produtosAgrupados(ativos).map(([categoria, itens]) =>
    el("div.menu-pdf-group", {},
      el("strong", {}, rotuloCategoria(categoria)),
      ...itens.map(produto =>
        el("label.menu-pdf-item", {},
          el("input", { type: "checkbox", checked: true, dataset: { id: produto.id } }),
          el("span", {}, produto.name),
          el("small", {}, reais(produto.price))
        )
      )
    )
  ));
  mostrar($("#menu-pdf-modal"), true);
}

function fecharModalExportarPdf() {
  mostrar($("#menu-pdf-modal"), false);
}

function marcarTodosPdf(valor) {
  for (const campo of $$("#menu-pdf-list input")) campo.checked = valor;
}

export function ligarProdutos() {
  const lista = $("#product-admin-list");
  const presets = $("#photo-presets");
  const tabela = $("#product-table");

  ligarArrastarProdutos(lista);

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
  $("#export-menu-pdf")?.addEventListener("click", abrirModalExportarPdf);
  $("#menu-pdf-close")?.addEventListener("click", fecharModalExportarPdf);
  $("#menu-pdf-cancel")?.addEventListener("click", fecharModalExportarPdf);
  $("#menu-pdf-modal")?.addEventListener("click", evento => {
    if (evento.target === $("#menu-pdf-modal")) fecharModalExportarPdf();
  });
  $("#menu-pdf-all")?.addEventListener("click", () => marcarTodosPdf(true));
  $("#menu-pdf-none")?.addEventListener("click", () => marcarTodosPdf(false));
  $("#menu-pdf-confirm")?.addEventListener("click", async botao => {
    const selecionados = $$("#menu-pdf-list input:checked").map(campo => campo.dataset.id);
    if (!selecionados.length) return toastFalha(new Error("Marque ao menos um produto."), "Exportar cardápio");

    const alvo = botao.currentTarget;
    alvo.disabled = true;
    try {
      if (!Object.keys(estado.ajustes || {}).length) await carregar("ajustes");
      const escolhidos = estado.produtos.filter(produto => selecionados.includes(produto.id));
      await exportarCardapioPdf(escolhidos, estado.ajustes);
      fecharModalExportarPdf();
    } catch (erro) {
      toastFalha(erro, "Exportar cardápio");
    } finally {
      alvo.disabled = false;
    }
  });
  $("#product-image")?.addEventListener("input", evento => atualizarPreview(evento.target.value));
  $("#product-category")?.addEventListener("input", () => { atualizarCampoEstoqueProduto(); atualizarCampoSaborPizza(); });
  $("#product-category")?.addEventListener("change", () => { atualizarCampoEstoqueProduto(); atualizarCampoSaborPizza(); });
  atualizarCampoEstoqueProduto();
  atualizarCampoSaborPizza();
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
