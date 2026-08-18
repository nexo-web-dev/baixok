/* Fila de pedidos (kanban).
 *
 * A ordem das colunas continua a mesma, e o arrastar entre colunas foi mantido.
 * Cada acao virou uma chamada a API: o painel nao muda mais o proprio banco
 * local e torce para o servidor concordar depois. */
import { el, render, $, delegar, mostrar, debounce } from "../../../utils/dom.js";
import { reais, minutosDesde, esperaLegivel } from "../../../utils/formato.js";
import { CANAIS_ROTULO, MODALIDADES_ROTULO, STATUS_ROTULO, rotuloCategoria } from "../../../utils/categorias.js";
import { controlaEstoqueCategoria } from "../../../utils/estoque.js";
import { apiPedidos, apiAjustes } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";
import { imprimirAmbas, imprimirTeste } from "../../../components/impressao.js";
import { registrarMotoboyLocal } from "./motoboy.js";

const MINUTOS_ATRASO = 15;
let relogioPedidosTimer = null;
let pedidoDetalheAtualId = null;
let pedidoDetalheAtualCache = null;
let buscaAdicionarItem = "";
let divisaoPagamentoAberta = false;
let divisaoPagamentoLinhas = [];

/* Mesma lista usada na venda manual e no filtro do dashboard — a divisao nao
 * inventa forma nova, so reparte entre as que a casa ja usa no dia a dia. */
const FORMAS_PAGAMENTO_DIVISAO = ["Dinheiro", "Pix", "Cartão"];

const normalizarBuscaItem = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

const COLUNAS = [
  ["novo", "Aguardando aprovação"],
  ["preparo", "Em preparo"],
  ["pronto", "Pronto / A caminho"],
  ["entregue", "Entregue"]
];

const colunasDoPapel = papel => papel === "entregador"
  ? COLUNAS.filter(([status]) => ["pronto", "entregue"].includes(status))
  : COLUNAS;

const pedidosDoPapel = (pedidos, papel) => papel === "entregador"
  ? pedidos.filter(pedido => pedido.fulfillment === "entrega" && ["pronto", "entregue"].includes(pedido.status))
  : pedidos;

const senha = pedido => String(pedido.id).slice(-3).toUpperCase();
const porChegada = lista => [...lista].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
const normalizar = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .trim()
  .toLowerCase();

function atualizarRelogioPedidos() {
  const alvo = $("#orders-clock");
  if (!alvo) return;
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date());
  const valor = tipo => partes.find(parte => parte.type === tipo)?.value || "";
  alvo.textContent = `Horário de Brasília: ${valor("weekday")} ${valor("day")}/${valor("month")} ${valor("hour")}:${valor("minute")}:${valor("second")}`;
}

function ligarRelogioPedidos() {
  if (relogioPedidosTimer) return;
  atualizarRelogioPedidos();
  relogioPedidosTimer = window.setInterval(atualizarRelogioPedidos, 1000);
}

function produtoDoItem(item) {
  const id = String(item?.id || "");
  const nome = normalizar(item?.name);
  return estado.produtos.find(produto =>
    String(produto.id || "") === id || normalizar(produto.name) === nome
  ) || null;
}

function miniFotoItem(item) {
  const produto = produtoDoItem(item);
  return fotoMini(item?.image || produto?.image || "", item.name || produto?.name || "Produto", "order-detail-thumb");
}

/* Mesmo miniaturizador usado no item do pedido e na busca de adicionar item —
 * mantem o mesmo tamanho/estilo de "cartinha com foto" nos dois lugares. */
function fotoMini(imagem, nome, classe) {
  if (!imagem) return el(`div.${classe}.no-photo`, {}, "Sem foto");
  return el(`span.fit-media.${classe}`, {},
    el("img.fit-media-bg", {
      src: imagem,
      alt: "",
      loading: "lazy",
      decoding: "async",
      "aria-hidden": "true"
    }),
    el("img.fit-media-main", {
      src: imagem,
      alt: nome,
      loading: "lazy",
      decoding: "async",
      onerror: evento => evento.target.closest(".fit-media")?.replaceWith(el(`div.${classe}.no-photo`, {}, "Sem foto"))
    })
  );
}

function rotuloPronto(pedido) {
  if (pedido.fulfillment === "entrega") return "Despachar entrega";
  if (pedido.fulfillment === "mesa") return "Pronto na mesa";
  return "Pronto - chamar no telão";
}

function rotuloConcluir(pedido) {
  if (pedido.fulfillment === "entrega") return "Marcar entregue";
  if (pedido.fulfillment === "mesa") return "Concluir mesa";
  return "Concluir retirada";
}

function botaoDetalhe(pedido) {
  return el("button.secondary.small", { type: "button", dataset: { acao: "detalhe", id: pedido.id } }, "Ver pedido");
}

/* Marcar como entregue e o momento em que o dinheiro deveria ter entrado
 * (nesta casa nao ha pagamento online — Dinheiro/Cartao/Pix acontecem na
 * entrega ou retirada). Perguntar aqui, na hora, evita depender de alguem
 * lembrar de corrigir depois pelo dashboard. Cancelar na pergunta NAO cancela
 * a entrega — so avisa que o dinheiro nao veio; a entrega segue normal. */
function dadosParaStatus(pedido, status) {
  if (status !== "entregue") return {};

  const extras = {};
  if (pedido?.fulfillment === "entrega") {
    if (pedido.motoboy) {
      extras.motoboy = pedido.motoboy;
    } else {
      const nome = (prompt("Nome do motoboy que fez a entrega (obrigatório):", "") || "").trim();
      if (!nome) {
        toastFalha(new Error("Informe o motoboy antes de marcar a entrega como entregue."), "Entrega");
        return null;
      }
      extras.motoboy = nome;
    }
  }

  if (pedido?.payment !== "Não pago" && !confirm(
    "O pagamento foi recebido normalmente?\n\nClique em Cancelar se o dinheiro NÃO chegou (cliente saiu sem pagar, cartão recusado, etc.)."
  )) {
    const motivo = (prompt("O que aconteceu? (obrigatório e fica registrado):", "") || "").trim();
    if (!motivo) {
      toastFalha(new Error("Informe o que aconteceu para marcar como não pago."), "Pagamento");
      return null;
    }
    extras.pagamentoNaoRecebido = true;
    extras.motivoNaoPago = motivo;
  }

  return extras;
}

/* A cozinha ve a fila e avanca o preparo, mas nao recusa nem reimprime nota do
 * balcao. A rota tambem barra — isto aqui e para nao oferecer o botao. */
function trocoResumo(pedido) {
  if (!String(pedido.payment || "").toLowerCase().includes("dinheiro")) return null;
  const trocoPara = Number(pedido.trocoPara || 0);
  if (!trocoPara) return "Pagamento em dinheiro. Conferir troco no balcão.";
  const troco = Math.max(0, trocoPara - Number(pedido.total || 0));
  return `Troco para ${reais(trocoPara)} | devolver ${reais(troco)}`;
}

function rotuloAtalhoStatus(pedido, status) {
  if (status === "preparo") return pedido.status === "novo" ? "Aprovar" : "Preparo";
  if (status === "pronto") return pedido.fulfillment === "entrega" ? "A caminho" : "Pronto";
  if (status === "entregue") return "Entregue";
  return "Novo";
}

function atalhosStatus(pedido, papel) {
  if (papel === "cozinha" || papel === "entregador") return null;
  const permitidos = colunasDoPapel(papel)
    .map(([status]) => status)
    .filter(status => status !== pedido.status);
  if (!permitidos.length) return null;

  return el("div.status-shortcuts", {},
    el("span", {}, "Mover no celular"),
    ...permitidos.map(status =>
      el("button.ghost.small", {
        type: "button",
        dataset: { acao: "status", id: pedido.id, status }
      }, rotuloAtalhoStatus(pedido, status))
    )
  );
}

function acoes(pedido, papel) {
  const podeOperar = papel === "admin" || papel === "caixa";

  if (papel === "entregador") {
    if (pedido.status === "pronto" && pedido.fulfillment === "entrega") {
      return [
        botaoDetalhe(pedido),
        el("button.ghost-green.small", { type: "button", dataset: { acao: "status", id: pedido.id, status: "entregue" } }, "Marcar entregue")
      ];
    }
    return [botaoDetalhe(pedido)];
  }

  if (pedido.status === "novo") {
    return [
      botaoDetalhe(pedido),
      el("button.primary.small", { type: "button", dataset: { acao: "aprovar", id: pedido.id } }, "Aprovar e imprimir"),
      podeOperar ? el("button.danger.small", { type: "button", dataset: { acao: "recusar", id: pedido.id } }, "Recusar") : null
    ];
  }
  if (pedido.status === "preparo") {
    return [
      botaoDetalhe(pedido),
      el("button.primary.small", { type: "button", dataset: { acao: "status", id: pedido.id, status: "pronto" } },
        rotuloPronto(pedido)),
      podeOperar ? el("button.secondary.small", { type: "button", dataset: { acao: "reimprimir", id: pedido.id } }, "Reimprimir") : null
    ];
  }
  if (pedido.status === "pronto") {
    return [
      botaoDetalhe(pedido),
      el("button.ghost-green.small", { type: "button", dataset: { acao: "status", id: pedido.id, status: "entregue" } }, rotuloConcluir(pedido))
    ];
  }
  return [botaoDetalhe(pedido)];
}

function cartao(pedido, papel) {
  const espera = minutosDesde(pedido.createdAt);
  const troco = trocoResumo(pedido);
  const prioridade = pedido.status === "entregue"
    ? "normal"
    : espera >= MINUTOS_ATRASO * 2 ? "urgent" : espera >= MINUTOS_ATRASO ? "attention" : "normal";

  return el("article.order-card", {
    class: `status-${pedido.status} priority-${prioridade}`,
    draggable: papel === "entregador" ? pedido.fulfillment === "entrega" : papel !== "cozinha",
    dataset: { id: pedido.id }
  },
    el("div.order-top", {},
      el("strong.order-num", {}, `#${senha(pedido)}`),
      el("strong.order-customer", {}, pedido.customer),
      el("strong.order-total", {}, reais(pedido.total))
    ),
    el("div.order-flags", {},
      el("span.flag", {}, CANAIS_ROTULO[pedido.channel] || pedido.channel),
      el("span.flag", {}, MODALIDADES_ROTULO[pedido.fulfillment] || pedido.fulfillment),
      el("span.flag", { class: /pix/i.test(pedido.payment || "") ? "paid" : "" }, pedido.payment || "-"),
      el("span.flag.time", {}, esperaLegivel(espera))
    ),
    el("p.order-items-line", {}, pedido.items.map(item => `${item.qty}x ${item.name}${item.gift ? " (Brinde)" : ""}`).join("  ·  ")),
    pedido.note ? el("p.order-note", {}, el("strong", {}, "Obs: "), pedido.note) : null,
    troco ? el("p.order-note.money", {}, el("strong", {}, "Troco: "), troco) : null,
    pedido.motoboy ? el("p.order-note", {}, el("strong", {}, "Motoboy: "), pedido.motoboy) : null,
    /* Telefone e endereco so para quem opera o balcao. O tablet da cozinha
     * costuma ficar num lugar de passagem. */
    papel === "cozinha"
      ? null
      : el("p.order-place", {}, `${pedido.place || ""}${pedido.phone ? ` | ${pedido.phone}` : ""}`),
    pedido.printed
      ? el("div.order-flags", {}, el("span.flag.done", {}, "🖨 Cozinha ✓"), el("span.flag.done", {}, "🖨 Balcão ✓"))
      : null,
    el("div.order-actions", {}, ...acoes(pedido, papel)),
    atalhosStatus(pedido, papel)
  );
}

function fecharDetalhePedido() {
  mostrar($("#order-detail-modal"), false);
}

function linhaDetalheItem(item, pedido, editavel) {
  /* Pedido em aberto nao pode zerar (nada pra cozinha preparar). Pedido ja
   * entregue pode: e o caso de corrigir o unico item errado, tirando ele e
   * colocando o certo logo em seguida na mesma tela. */
  const podeRemover = editavel && (pedido.items.length > 1 || pedido.status === "entregue");
  /* Brinde nao tem +/- proprio: a quantidade dele e calculada pela promocao
   * ("leve e ganhe"), nao e algo que a pessoa escolhe na tela. */
  const podeAjustarQtd = editavel && !item.gift;
  return el("div.order-detail-item", { class: item.gift ? "gift" : "" },
    miniFotoItem(item),
    el("div", {},
      el("strong", {}, item.gift ? `${item.qty}x ${item.name}` : item.name),
      item.gift
        ? el("span.gift-tag", {}, "Brinde · Leve e ganhe")
        : el("span", {}, `${reais(item.price)} cada`)
    ),
    podeAjustarQtd
      ? el("div.qty-stepper", {},
          el("button.qty-btn", {
            type: "button", title: "Diminuir",
            dataset: { acao: "diminuir-item-pedido", id: pedido.id, itemId: String(item.itemId) }
          }, "−"),
          el("span.qty-valor", {}, String(item.qty)),
          el("button.qty-btn", {
            type: "button", title: "Aumentar",
            dataset: { acao: "aumentar-item-pedido", id: pedido.id, itemId: String(item.itemId) }
          }, "+")
        )
      : el("span.qty-fixa", {}, `${item.qty}x`),
    el("strong", {}, item.gift ? "Grátis" : reais(Number(item.price || 0) * Number(item.qty || 0))),
    podeRemover
      ? el("button.order-item-remove", {
          type: "button", title: "Remover este item do pedido",
          dataset: { acao: "remover-item-pedido", id: pedido.id, itemId: String(item.itemId) }
        }, "×")
      : null
  );
}

/* So o resultado da busca redesenha, nunca o modal inteiro — senao o campo de
 * texto perderia o foco (e o cursor) a cada letra digitada. */
function atualizarListaAdicionarItem() {
  const lista = $("#add-item-results");
  if (!lista) return;

  const termo = normalizarBuscaItem(buscaAdicionarItem).trim();
  const opcoes = estado.produtos
    .filter(produto => produto.active && (!controlaEstoqueCategoria(produto.category) || produto.stock > 0))
    .filter(produto => !termo || normalizarBuscaItem(`${produto.name} ${produto.category || ""}`).includes(termo))
    .slice(0, 8);

  render(lista, ...(opcoes.length
    ? opcoes.map(produto =>
        el("button.add-item-option", {
          type: "button",
          dataset: { acao: "adicionar-item-pedido", id: pedidoDetalheAtualId, produtoId: produto.id }
        },
          fotoMini(produto.image, produto.name, "add-item-thumb"),
          el("span", {},
            el("strong", {}, produto.name),
            el("small", {}, rotuloCategoria(produto.category))
          ),
          el("em", {}, reais(produto.price))
        ))
    : [el("p.faint.small", {}, "Nenhum produto encontrado.")]));
}

function blocoAdicionarItem() {
  return el("div.add-item-block", {},
    el("strong", {}, "Adicionar item ao pedido"),
    el("input", {
      type: "search", placeholder: "Buscar produto para adicionar...",
      dataset: { acao: "buscar-item-pedido" }
    }),
    el("div.add-item-results", { id: "add-item-results" })
  );
}

/* So redesenha esse bloco sozinho (abrir/fechar, +forma, remover linha) —
 * abrir de novo o pedido inteiro via API a cada clique seria desperdicio e
 * ainda reseta o formulario no meio do preenchimento. */
function redesenharDivisaoPagamento() {
  const bloco = $("#split-payment-block");
  if (!bloco || !pedidoDetalheAtualCache) return;
  render(bloco, divisaoPagamentoAberta ? conteudoDivisaoPagamento(pedidoDetalheAtualCache) : null);
}

function conteudoDivisaoPagamento(pedido) {
  return el("div.split-payment-form", {},
    el("strong", {}, "Dividir pagamento"),
    el("p.faint.small", {}, `A soma das formas precisa bater com o total do pedido (${reais(pedido.total)}).`),
    el("div.split-payment-rows", {},
      divisaoPagamentoLinhas.map((linha, indice) =>
        el("div.split-payment-row", {},
          el("select", { dataset: { acao: "split-forma", indice: String(indice) } },
            el("option", { value: "" }, "Selecione..."),
            ...FORMAS_PAGAMENTO_DIVISAO.map(forma =>
              el("option", { value: forma, selected: linha.forma === forma }, forma)
            )
          ),
          el("input", {
            type: "number", step: "0.01", min: "0", placeholder: "Valor", value: linha.valor,
            dataset: { acao: "split-valor", indice: String(indice) }
          }),
          divisaoPagamentoLinhas.length > 2
            ? el("button.split-row-remove", {
                type: "button", title: "Remover esta forma",
                dataset: { acao: "split-remover-linha", indice: String(indice) }
              }, "×")
            : null
        )
      )
    ),
    el("div.split-payment-actions", {},
      el("button.secondary", { type: "button", dataset: { acao: "split-adicionar-linha" } }, "+ forma"),
      el("button.primary", { type: "button", dataset: { acao: "split-confirmar", id: pedido.id } }, "Confirmar divisão"),
      el("button.secondary", { type: "button", dataset: { acao: "split-cancelar" } }, "Cancelar")
    )
  );
}

/* Exportada porque o Dashboard tambem abre este mesmo modal a partir da
 * lista "Todas as vendas" — uma venda de dias atras pode nao estar em
 * estado.pedidos (o painel so mantem os pedidos recentes em memoria), entao
 * busca na API quando nao acha localmente, em vez de simplesmente falhar. */
export async function abrirDetalhePedido(id) {
  let pedido = estado.pedidos.find(item => item.id === id);
  if (!pedido) {
    try {
      pedido = (await apiPedidos.buscar(id)).pedido;
    } catch (erro) {
      toastFalha(erro);
      return;
    }
  }
  const modal = $("#order-detail-modal");
  const corpo = $("#order-detail-body");
  if (!pedido || !modal || !corpo) return;

  pedidoDetalheAtualId = id;
  pedidoDetalheAtualCache = pedido;
  buscaAdicionarItem = "";
  divisaoPagamentoAberta = false;
  divisaoPagamentoLinhas = [];
  /* So cancelado fica travado — pedido entregue tambem pode ganhar ou perder
   * item, e a correcao de "esqueceu de lancar" ou "trocou o produto" depois
   * que o cliente ja levou. */
  const editavel = pedido.status !== "cancelado";

  const titulo = $("#order-detail-title");
  const subtitulo = $("#order-detail-subtitle");
  const troco = trocoResumo(pedido);
  if (titulo) titulo.textContent = `Pedido ${senha(pedido)} - ${pedido.customer || "Cliente"}`;
  if (subtitulo) {
    subtitulo.textContent = [
      STATUS_ROTULO[pedido.status] || pedido.status,
      MODALIDADES_ROTULO[pedido.fulfillment] || pedido.fulfillment,
      CANAIS_ROTULO[pedido.channel] || pedido.channel
    ].filter(Boolean).join(" | ");
  }

  render(corpo,
    el("div.order-detail-summary", {},
      el("div", {}, el("span", {}, "Pagamento"),
        pedido.payment === "Dividido" && pedido.paymentSplit?.length
          ? el("strong", {}, pedido.paymentSplit.map(parte => `${parte.forma}: ${reais(Number(parte.valor))}`).join(" + "))
          : el("strong", { class: pedido.payment === "Não pago" ? "danger-text" : "" }, pedido.payment || "-")),
      el("div", {}, el("span", {}, "Total"), el("strong", {}, reais(pedido.total))),
      el("div", {}, el("span", {}, "Tempo"), el("strong", {}, esperaLegivel(minutosDesde(pedido.createdAt)))),
      pedido.tableNumber ? el("div", {}, el("span", {}, "Mesa"), el("strong", {}, `Mesa ${pedido.tableNumber}`)) : null
    ),
    el("div.order-detail-items", {}, pedido.items.map(item => linhaDetalheItem(item, pedido, editavel))),
    editavel ? blocoAdicionarItem() : null,
    troco ? el("p.order-note.money", {}, el("strong", {}, "Troco: "), troco) : null,
    pedido.note ? el("p.order-note", {}, el("strong", {}, "Observação: "), pedido.note) : null,
    pedido.phone ? el("p.order-place", {}, el("strong", {}, "Telefone: "), pedido.phone) : null,
    pedido.place ? el("p.order-place", {}, el("strong", {}, "Local: "), pedido.place) : null,
    pedido.motoboy ? el("p.order-note", {}, el("strong", {}, "Motoboy: "), pedido.motoboy) : null,
    pedido.payment === "Não pago" && pedido.naoPagoReason
      ? el("p.order-note.danger-text", {}, el("strong", {}, "Motivo do não pagamento: "), pedido.naoPagoReason)
      : null,
    el("div.order-detail-actions", {},
      pedido.status === "entregue" && pedido.payment !== "Não pago"
        ? el("button.danger", {
            type: "button", title: "O produto já saiu e o dinheiro não chegou",
            dataset: { acao: "marcar-nao-pago-pedido", id: pedido.id }
          }, "Marcar como não pago")
        : null,
      editavel && pedido.payment !== "Não pago"
        ? el("button.secondary", {
            type: "button", title: "Ex.: parte no cartão, parte no Pix",
            dataset: { acao: "abrir-divisao-pagamento", id: pedido.id }
          }, pedido.payment === "Dividido" ? "Editar divisão" : "Dividir pagamento")
        : null,
      el("button.secondary", { type: "button", dataset: { acao: "reimprimir-detalhe", id: pedido.id } }, "Reimprimir nota")
    ),
    el("div.split-payment-block", { id: "split-payment-block" })
  );
  if (editavel) atualizarListaAdicionarItem();
  mostrar(modal, true);
}

export function desenharPedidos() {
  const alvo = $("#orders-kanban");
  if (!alvo) return;
  ligarRelogioPedidos();

  const campoPapel = $("#kitchen-paper-width");
  if (campoPapel && document.activeElement !== campoPapel) {
    campoPapel.value = estado.ajustes?.largura_papel_cozinha || "";
  }

  const papel = estado.usuario?.papel;
  const pedidos = pedidosDoPapel(
    estado.pedidos.filter(pedido => pedido.status !== "cancelado"),
    papel
  );

  render(alvo, ...colunasDoPapel(papel).map(([status, titulo]) => {
    const linhas = porChegada(pedidos.filter(pedido => pedido.status === status));
    return el("div.kanban-column", { class: `status-zone-${status}`, dataset: { status } },
      el("h2", {}, titulo, " ", el("span", {}, String(linhas.length))),
      linhas.length ? linhas.map(pedido => cartao(pedido, papel)) : el("p.faint", {}, "Nenhum pedido aqui.")
    );
  }));

  const badge = $("#nav-badge");
  if (badge) {
    const novos = pedidos.filter(pedido => pedido.status === "novo").length;
    badge.textContent = String(novos);
    badge.classList.toggle("hidden", novos === 0);
  }
}

async function mudarStatus(id, status) {
  if (estado.usuario?.papel === "entregador" && !["pronto", "entregue"].includes(status)) {
    return toast("Entregador move apenas pedidos em rota ou entregues.");
  }
  const atual = estado.pedidos.find(pedido => pedido.id === id);
  const extras = dadosParaStatus(atual, status);
  if (extras === null) return;

  try {
    const { pedido } = await apiPedidos.mudarStatus(id, status, extras);
    /* Aprovar imprime as duas vias, como antes: cozinha monta, balcao entrega. */
    if (status === "preparo") {
      imprimirAmbas(pedido);
      await apiPedidos.marcarImpresso(id).catch(() => {});
    }
    await carregar("pedidos", "produtos");
    desenharPedidos();
    if (status === "entregue") {
      const nomeMotoboy = pedido.motoboy || extras?.motoboy || atual?.motoboy || "";
      if (nomeMotoboy) registrarMotoboyLocal(nomeMotoboy);
      toast(extras?.pagamentoNaoRecebido
        ? `Pedido ${senha(pedido)} entregue — marcado como NÃO PAGO.`
        : `Pedido ${senha(pedido)} entregue${nomeMotoboy ? ` por ${nomeMotoboy}` : ""}.`,
        extras?.pagamentoNaoRecebido ? { tipo: "alerta", duracao: 6000 } : undefined);
    } else if (status === "preparo") {
      toast(`Pedido ${senha(pedido)} aprovado e impresso.`);
    } else if (status === "pronto") {
      toast(`Pedido ${senha(pedido)} pronto.`);
    }
  } catch (erro) {
    toastFalha(erro);
  }
}

async function recusar(id) {
  const pedido = estado.pedidos.find(item => item.id === id);
  if (!confirm(`Recusar o pedido de ${pedido?.customer || "cliente"}? Os itens voltam para o estoque.`)) return;

  const motivo = (prompt("Motivo da recusa (obrigatório e fica registrado):", "") ?? "").trim();
  if (!motivo) return toastFalha(new Error("Informe o motivo para recusar o pedido."), "Cancelamento");
  try {
    await apiPedidos.cancelar(id, motivo);
    await carregar("pedidos", "produtos");
    desenharPedidos();
    toast("Pedido recusado e estoque devolvido.");
  } catch (erro) {
    toastFalha(erro);
  }
}

export function ligarPedidos() {
  const alvo = $("#orders-kanban");
  if (!alvo) return;

  delegar(alvo, "click", "[data-acao='aprovar']", (_e, botao) => mudarStatus(botao.dataset.id, "preparo"));
  delegar(alvo, "click", "[data-acao='status']", (_e, botao) => mudarStatus(botao.dataset.id, botao.dataset.status));
  delegar(alvo, "click", "[data-acao='recusar']", (_e, botao) => recusar(botao.dataset.id));
  delegar(alvo, "click", "[data-acao='detalhe']", (_e, botao) => abrirDetalhePedido(botao.dataset.id));
  delegar(alvo, "click", "[data-acao='reimprimir']", (_e, botao) => {
    const pedido = estado.pedidos.find(item => item.id === botao.dataset.id);
    if (pedido) imprimirAmbas(pedido);
  });
  delegar(alvo, "click", ".order-card", (evento, cartaoNode) => {
    if (evento.target.closest("button, a, input, textarea, select")) return;
    abrirDetalhePedido(cartaoNode.dataset.id);
  });

  /* Arrastar entre colunas, para frente ou para tras, para corrigir status. */
  delegar(alvo, "dragstart", ".order-card", (evento, cartaoNode) => {
    evento.dataTransfer.setData("text/plain", cartaoNode.dataset.id);
    evento.dataTransfer.effectAllowed = "move";
  });
  delegar(alvo, "dragover", ".kanban-column", evento => {
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
  });
  delegar(alvo, "drop", ".kanban-column", (evento, coluna) => {
    evento.preventDefault();
    const id = evento.dataTransfer.getData("text/plain");
    if (estado.usuario?.papel === "entregador" && !["pronto", "entregue"].includes(coluna.dataset.status)) return;
    if (id) mudarStatus(id, coluna.dataset.status);
  });

  $("#print-test-kitchen")?.addEventListener("click", () => imprimirTeste("kitchen"));
  $("#print-test-counter")?.addEventListener("click", () => imprimirTeste("counter"));
  $("#kitchen-paper-save")?.addEventListener("click", async () => {
    const valor = Math.max(40, Math.min(120, Math.round(Number($("#kitchen-paper-width")?.value) || 80)));
    try {
      await apiAjustes.gravar({ largura_papel_cozinha: valor });
      await carregar("ajustes");
      toast(`Papel da cozinha ajustado para ${valor}mm. Teste antes de aprovar o próximo pedido.`);
    } catch (erro) {
      toastFalha(erro, "Papel da cozinha");
    }
  });

  $("#order-detail-close")?.addEventListener("click", fecharDetalhePedido);
  $("#order-detail-modal")?.addEventListener("click", evento => {
    if (evento.target === $("#order-detail-modal")) fecharDetalhePedido();
  });
  delegar($("#order-detail-body"), "click", "[data-acao='reimprimir-detalhe']", (_e, botao) => {
    const pedido = estado.pedidos.find(item => item.id === botao.dataset.id);
    if (pedido) imprimirAmbas(pedido);
  });
  delegar($("#order-detail-body"), "click", "[data-acao='marcar-nao-pago-pedido']", async (_e, botao) => {
    const motivo = (prompt("O que aconteceu? (obrigatório e fica registrado):", "") ?? "").trim();
    if (!motivo) return toastFalha(new Error("Informe o motivo para marcar como não pago."), "Pagamento");
    try {
      await apiPedidos.definirPagamento(botao.dataset.id, "Não pago", motivo);
      await carregar("pedidos");
      abrirDetalhePedido(botao.dataset.id);
      toast("Pedido marcado como não pago.");
    } catch (erro) {
      toastFalha(erro);
    }
  });

  delegar($("#order-detail-body"), "input", "[data-acao='buscar-item-pedido']", debounce(evento => {
    buscaAdicionarItem = evento.target.value;
    atualizarListaAdicionarItem();
  }));

  delegar($("#order-detail-body"), "click", "[data-acao='adicionar-item-pedido']", async (_e, botao) => {
    botao.disabled = true;
    try {
      await apiPedidos.adicionarItens(botao.dataset.id, [{ id: botao.dataset.produtoId, qty: 1 }]);
      await carregar("pedidos");
      abrirDetalhePedido(botao.dataset.id);
      toast("Item adicionado ao pedido. Reimprima a nota se a cozinha já tiver a via antiga.");
    } catch (erro) {
      toastFalha(erro, "Adicionar item");
      botao.disabled = false;
    }
  });

  delegar($("#order-detail-body"), "click", "[data-acao='remover-item-pedido']", async (_e, botao) => {
    if (!confirm("Remover este item do pedido?")) return;
    botao.disabled = true;
    try {
      await apiPedidos.removerItem(botao.dataset.id, Number(botao.dataset.itemId));
      await carregar("pedidos");
      abrirDetalhePedido(botao.dataset.id);
      toast("Item removido do pedido.");
    } catch (erro) {
      toastFalha(erro, "Remover item");
      botao.disabled = false;
    }
  });

  /* "+"/"-" leem a quantidade direto do numero mostrado na tela, em vez de
   * ir atras do pedido em estado.pedidos — funciona igual mesmo se o pedido
   * foi aberto vindo de fora da lista local (ver abrirDetalhePedido). */
  delegar(
    $("#order-detail-body"), "click",
    "[data-acao='aumentar-item-pedido'], [data-acao='diminuir-item-pedido']",
    async (_e, botao) => {
      const linha = botao.closest(".order-detail-item");
      const valorEl = linha?.querySelector(".qty-valor");
      if (!valorEl) return;
      const atual = Number(valorEl.textContent) || 0;
      const nova = atual + (botao.dataset.acao === "aumentar-item-pedido" ? 1 : -1);
      if (nova < 0) return;
      if (nova === 0 && !confirm("Isso remove o item do pedido. Continuar?")) return;

      botao.disabled = true;
      try {
        await apiPedidos.ajustarQuantidadeItem(botao.dataset.id, Number(botao.dataset.itemId), nova);
        await carregar("pedidos");
        abrirDetalhePedido(botao.dataset.id);
        toast(nova === 0 ? "Item removido do pedido." : "Quantidade atualizada.");
      } catch (erro) {
        toastFalha(erro, "Quantidade");
      } finally {
        botao.disabled = false;
      }
    }
  );

  delegar($("#order-detail-body"), "click", "[data-acao='abrir-divisao-pagamento']", (_e, botao) => {
    const pedido = pedidoDetalheAtualCache;
    divisaoPagamentoAberta = true;
    /* Ja divido antes: reabre com as formas que estao la, pra editar em cima
     * em vez de comecar do zero. Senao, duas linhas em branco pra preencher. */
    divisaoPagamentoLinhas = pedido?.payment === "Dividido" && pedido.paymentSplit?.length
      ? pedido.paymentSplit.map(parte => ({ forma: parte.forma, valor: String(parte.valor) }))
      : [{ forma: "", valor: "" }, { forma: "", valor: "" }];
    redesenharDivisaoPagamento();
  });

  delegar($("#order-detail-body"), "click", "[data-acao='split-cancelar']", () => {
    divisaoPagamentoAberta = false;
    redesenharDivisaoPagamento();
  });

  delegar($("#order-detail-body"), "click", "[data-acao='split-adicionar-linha']", () => {
    divisaoPagamentoLinhas.push({ forma: "", valor: "" });
    redesenharDivisaoPagamento();
  });

  delegar($("#order-detail-body"), "click", "[data-acao='split-remover-linha']", (_e, botao) => {
    divisaoPagamentoLinhas.splice(Number(botao.dataset.indice), 1);
    redesenharDivisaoPagamento();
  });

  delegar($("#order-detail-body"), "change", "[data-acao='split-forma']", (_e, campo) => {
    const linha = divisaoPagamentoLinhas[Number(campo.dataset.indice)];
    if (linha) linha.forma = campo.value;
  });

  delegar($("#order-detail-body"), "input", "[data-acao='split-valor']", (_e, campo) => {
    const linha = divisaoPagamentoLinhas[Number(campo.dataset.indice)];
    if (linha) linha.valor = campo.value;
  });

  delegar($("#order-detail-body"), "click", "[data-acao='split-confirmar']", async (_e, botao) => {
    const componentes = divisaoPagamentoLinhas
      .map(linha => ({ forma: String(linha.forma || "").trim(), valor: Math.round((Number(linha.valor) || 0) * 100) / 100 }))
      .filter(linha => linha.forma && linha.valor > 0);
    if (componentes.length < 2) {
      return toastFalha(new Error("Informe pelo menos duas formas de pagamento, com valor."), "Dividir pagamento");
    }
    botao.disabled = true;
    try {
      await apiPedidos.dividirPagamento(botao.dataset.id, componentes);
      divisaoPagamentoAberta = false;
      await carregar("pedidos");
      abrirDetalhePedido(botao.dataset.id);
      toast("Pagamento dividido registrado.");
    } catch (erro) {
      toastFalha(erro, "Dividir pagamento");
    } finally {
      botao.disabled = false;
    }
  });
}
