import { el, render, $, delegar } from "../../../utils/dom.js";
import { reais, dataHora } from "../../../utils/formato.js";
import { STATUS_ROTULO, CANAIS_ROTULO } from "../../../utils/categorias.js";
import { apiPedidos } from "../../../services/api.js";
import { toast, toastFalha } from "../../../components/toast.js";

let entregas = [];

const senha = pedido => String(pedido.id).slice(-3).toUpperCase();
const porData = lista => [...lista].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

function cardEntrega(pedido) {
  const entregue = pedido.status === "entregue";

  return el("article.motoboy-card", { class: entregue ? "done" : "", dataset: { id: pedido.id } },
    el("div.motoboy-card-head", {},
      el("div", {},
        el("span.pill", { class: `status-${pedido.status}` }, STATUS_ROTULO[pedido.status] || pedido.status),
        el("h2", {}, `Pedido ${senha(pedido)} - ${pedido.customer || "Cliente"}`)
      ),
      el("strong.price", {}, reais(pedido.total || 0))
    ),
    el("div.motoboy-grid", {},
      el("p", {}, el("span", {}, "Canal"), el("strong", {}, CANAIS_ROTULO[pedido.channel] || pedido.channel || "-")),
      el("p", {}, el("span", {}, "Horario"), el("strong", {}, dataHora(pedido.createdAt))),
      el("p", {}, el("span", {}, "Telefone"), el("strong", {}, pedido.phone || "-")),
      el("p", {}, el("span", {}, "Endereco"), el("strong", {}, pedido.place || "-"))
    ),
    el("p.motoboy-items", {}, pedido.items.map(item => `${item.qty}x ${item.name}`).join(" | ") || "Sem itens"),
    pedido.note ? el("p.order-note", {}, el("strong", {}, "Obs: "), pedido.note) : null,
    el("div.motoboy-actions", {},
      el("label", {},
        el("span", {}, "Motoboy"),
        el("input", {
          value: pedido.motoboy || "",
          maxlength: 80,
          placeholder: "Nome de quem fez a entrega",
          dataset: { acao: "motoboy-nome" }
        })
      ),
      el("button.secondary.small", { type: "button", dataset: { acao: "salvar-motoboy" } }, "Salvar motoboy"),
      !entregue
        ? el("button.ghost-green.small", { type: "button", dataset: { acao: "entregue" } }, "Marcar entregue")
        : null
    )
  );
}

export async function desenharMotoboy() {
  const alvo = $("#motoboy-list");
  if (!alvo) return;

  try {
    const { pedidos } = await apiPedidos.listar({ limite: 500 });
    entregas = porData(pedidos.filter(pedido =>
      pedido.fulfillment === "entrega" && ["pronto", "entregue"].includes(pedido.status)
    ));
  } catch (erro) {
    toastFalha(erro, "Motoboy");
    return;
  }

  render(alvo, entregas.length
    ? entregas.map(cardEntrega)
    : el("p.faint.pad", {}, "Nenhuma entrega pronta ou entregue."));
}

async function salvarMotoboy(card) {
  const nome = card.querySelector("[data-acao='motoboy-nome']")?.value.trim() || "";
  if (!nome) return toastFalha(new Error("Informe o nome do motoboy."), "Motoboy");

  try {
    await apiPedidos.definirMotoboy(card.dataset.id, nome);
    toast("Motoboy salvo.");
    await desenharMotoboy();
  } catch (erro) {
    toastFalha(erro, "Motoboy");
  }
}

async function marcarEntregue(card) {
  try {
    await apiPedidos.mudarStatus(card.dataset.id, "entregue");
    toast("Pedido marcado como entregue.");
    await desenharMotoboy();
  } catch (erro) {
    toastFalha(erro, "Entrega");
  }
}

export function ligarMotoboy() {
  const alvo = $("#motoboy-list");
  if (!alvo) return;

  delegar(alvo, "click", "[data-acao='salvar-motoboy']", (_e, botao) => salvarMotoboy(botao.closest(".motoboy-card")));
  delegar(alvo, "click", "[data-acao='entregue']", (_e, botao) => marcarEntregue(botao.closest(".motoboy-card")));
}
