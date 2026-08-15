/* Fila de pedidos (kanban).
 *
 * A ordem das colunas continua a mesma, e o arrastar entre colunas foi mantido.
 * Cada acao virou uma chamada a API: o painel nao muda mais o proprio banco
 * local e torce para o servidor concordar depois. */
import { el, render, $, delegar, mostrar } from "../../../utils/dom.js";
import { reais, minutosDesde, esperaLegivel } from "../../../utils/formato.js";
import { CANAIS_ROTULO, MODALIDADES_ROTULO, STATUS_ROTULO } from "../../../utils/categorias.js";
import { apiPedidos, apiAjustes } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";
import { imprimirAmbas, imprimirTeste } from "../../../components/impressao.js";
import { registrarMotoboyLocal } from "./motoboy.js";

const MINUTOS_ATRASO = 15;
let relogioPedidosTimer = null;

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
  const imagem = item?.image || produto?.image || "";
  if (!imagem) return el("div.order-detail-thumb.no-photo", {}, "Sem foto");
  return el("span.fit-media.order-detail-thumb", {},
    el("img.fit-media-bg", {
      src: imagem,
      alt: "",
      loading: "lazy",
      decoding: "async",
      "aria-hidden": "true"
    }),
    el("img.fit-media-main", {
      src: imagem,
      alt: item.name || produto?.name || "Produto",
      loading: "lazy",
      decoding: "async",
      onerror: evento => evento.target.closest(".fit-media")?.replaceWith(el("div.order-detail-thumb.no-photo", {}, "Sem foto"))
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

function dadosParaStatus(pedido, status) {
  if (status !== "entregue" || pedido?.fulfillment !== "entrega") return {};
  if (pedido.motoboy) return { motoboy: pedido.motoboy };

  const nome = (prompt("Nome do motoboy que fez a entrega (obrigatório):", "") || "").trim();
  if (!nome) {
    toastFalha(new Error("Informe o motoboy antes de marcar a entrega como entregue."), "Entrega");
    return null;
  }
  return { motoboy: nome };
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

function linhaDetalheItem(item) {
  return el("div.order-detail-item", { class: item.gift ? "gift" : "" },
    miniFotoItem(item),
    el("div", {},
      el("strong", {}, `${item.qty}x ${item.name}`),
      item.gift
        ? el("span.gift-tag", {}, "Brinde · Leve e ganhe")
        : el("span", {}, `${reais(item.price)} cada`)
    ),
    el("strong", {}, item.gift ? "Grátis" : reais(Number(item.price || 0) * Number(item.qty || 0)))
  );
}

function abrirDetalhePedido(id) {
  const pedido = estado.pedidos.find(item => item.id === id);
  const modal = $("#order-detail-modal");
  const corpo = $("#order-detail-body");
  if (!pedido || !modal || !corpo) return;

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
      el("div", {}, el("span", {}, "Pagamento"), el("strong", {}, pedido.payment || "-")),
      el("div", {}, el("span", {}, "Total"), el("strong", {}, reais(pedido.total))),
      el("div", {}, el("span", {}, "Tempo"), el("strong", {}, esperaLegivel(minutosDesde(pedido.createdAt)))),
      pedido.tableNumber ? el("div", {}, el("span", {}, "Mesa"), el("strong", {}, `Mesa ${pedido.tableNumber}`)) : null
    ),
    el("div.order-detail-items", {}, pedido.items.map(linhaDetalheItem)),
    troco ? el("p.order-note.money", {}, el("strong", {}, "Troco: "), troco) : null,
    pedido.note ? el("p.order-note", {}, el("strong", {}, "Observação: "), pedido.note) : null,
    pedido.phone ? el("p.order-place", {}, el("strong", {}, "Telefone: "), pedido.phone) : null,
    pedido.place ? el("p.order-place", {}, el("strong", {}, "Local: "), pedido.place) : null,
    pedido.motoboy ? el("p.order-note", {}, el("strong", {}, "Motoboy: "), pedido.motoboy) : null,
    el("div.order-detail-actions", {},
      el("button.secondary", { type: "button", dataset: { acao: "reimprimir-detalhe", id: pedido.id } }, "Reimprimir nota")
    )
  );
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
      toast(`Pedido ${senha(pedido)} entregue${nomeMotoboy ? ` por ${nomeMotoboy}` : ""}.`);
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
}
