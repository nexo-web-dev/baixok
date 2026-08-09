/* Mesas do salao.
 *
 * O ciclo continua o mesmo: abrir libera o QR, fechar a conta trava o QR e
 * imprime a nota, liberar devolve a mesa ao proximo cliente. A taxa de servico
 * agora vem calculada do servidor. */
import { el, render, $, delegar } from "../../../utils/dom.js";
import { reais, minutosDesde, esperaLegivel } from "../../../utils/formato.js";
import { apiMesas } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";
import { imprimir } from "../../../components/impressao.js";
import { abrirQrMesa } from "../../../components/qr-mesa.js";
import { abrirVendaManual } from "../venda-manual.js";

const ROTULO_STATUS = { livre: "Livre", aberta: "Usando", fechando: "Falta pagamento" };

function cabecalho(mesa) {
  return el("div.table-head", {},
    el("strong", {}, `Mesa ${mesa.n}`),
    el("button.qr-btn", { type: "button", dataset: { acao: "qr", n: String(mesa.n) } }, "▦ QR"),
    el("span.table-status", { class: `is-${mesa.status}` }, ROTULO_STATUS[mesa.status] || mesa.status)
  );
}

function cartao(mesa) {
  const conta = mesa.conta || { subtotal: 0, servico: 0, total: 0, percentualServico: 0 };

  if (mesa.status === "livre") {
    return el("article.table-card.is-livre", {},
      cabecalho(mesa),
      el("p", {}, "Mesa livre. Verde significa pronta para abrir uma nova comanda."),
      el("button.primary.wide", { type: "button", dataset: { acao: "abrir", n: String(mesa.n) } }, "Abrir mesa")
    );
  }

  const linhas = mesa.items.map(item =>
    el("div.table-line", {},
      el("span", {}, `${item.qty}x ${item.name}`),
      el("span", {}, reais(item.price * item.qty))
    )
  );

  if (mesa.status === "aberta") {
    return el("article.table-card.is-aberta", {},
      cabecalho(mesa),
      el("div.order-flags", {},
        el("span.flag", {}, `usando há ${esperaLegivel(minutosDesde(mesa.openedAt))}`),
        el("span.flag", {}, `${mesa.items.length} ${mesa.items.length === 1 ? "item" : "itens"}`)
      ),
      el("div.table-lines", {}, linhas.length ? linhas : el("p.faint", {}, "Nenhum pedido ainda. QR ativo.")),
      el("div.table-total", {}, el("span", {}, "Parcial"), el("span", {}, reais(conta.subtotal))),
      el("div.field-row", {},
        el("button.secondary", { type: "button", dataset: { acao: "lancar", n: String(mesa.n) } }, "+ Lançar pedido"),
        el("button.primary", { type: "button", dataset: { acao: "fechar", n: String(mesa.n) } }, "Fechar conta")
      )
    );
  }

  return el("article.table-card.is-conta", {},
    cabecalho(mesa),
    el("div.table-lines", {},
      el("div.table-line", {}, el("span", {}, "Consumo"), el("span", {}, reais(conta.subtotal))),
      el("div.table-line", {},
        el("span", {}, `Serviço (${Math.round(conta.percentualServico * 100)}%)`),
        el("span", {}, reais(conta.servico))
      )
    ),
    el("div.table-total", {}, el("span", {}, "Total"), el("span", {}, reais(conta.total))),
    el("p.danger-text.small", {}, "Comanda fechada. Falta confirmar pagamento no balcão."),
    el("button.ghost-green.wide", { type: "button", dataset: { acao: "liberar", n: String(mesa.n) } }, "Pago - liberar mesa")
  );
}

export function desenharMesas() {
  const alvo = $("#tables-grid");
  if (!alvo) return;

  const contador = $("#table-count");
  if (contador) contador.textContent = String(estado.mesas.length);

  render(alvo, ...estado.mesas.map(cartao));
}

async function recarregar() {
  await carregar("mesas");
  desenharMesas();
}

/* Fechar a conta imprime a nota com o extrato que o SERVIDOR devolveu, e nao
 * com o que estava na tela. Se outro atendente lancou um item um segundo antes,
 * a nota impressa ja sai com ele. */
async function fecharConta(n) {
  try {
    const { conta } = await apiMesas.fecharConta(n);
    imprimir({
      id: `mesa-${n}`,
      codeLabel: `MESA ${n}`,
      createdAt: conta.abertaEm || new Date().toISOString(),
      channel: "loja",
      fulfillment: "mesa",
      customer: `Mesa ${n}`,
      place: `Mesa ${n} - salão`,
      payment: "Conta fechada",
      note: `Serviço (${Math.round(conta.percentualServico * 100)}%): ${reais(conta.servico)}`,
      subtotal: conta.subtotal,
      discount: 0,
      total: conta.total,
      items: conta.items
    }, "counter");
    await recarregar();
    toast(`Conta da mesa ${n} fechada. Nota impressa no balcão.`);
  } catch (erro) {
    toastFalha(erro);
  }
}

export function ligarMesas() {
  const alvo = $("#tables-grid");
  if (!alvo) return;

  delegar(alvo, "click", "[data-acao='qr']", (_e, botao) =>
    abrirQrMesa(Number(botao.dataset.n), estado.ajustes.menu_url));

  delegar(alvo, "click", "[data-acao='abrir']", async (_e, botao) => {
    try {
      await apiMesas.abrir(Number(botao.dataset.n));
      await recarregar();
      toast(`Mesa ${botao.dataset.n} aberta. QR liberado.`);
    } catch (erro) { toastFalha(erro); }
  });

  delegar(alvo, "click", "[data-acao='fechar']", (_e, botao) => fecharConta(Number(botao.dataset.n)));

  delegar(alvo, "click", "[data-acao='liberar']", async (_e, botao) => {
    if (!confirm(`Liberar a mesa ${botao.dataset.n}? A comanda é zerada.`)) return;
    try {
      await apiMesas.liberar(Number(botao.dataset.n));
      await recarregar();
      toast(`Mesa ${botao.dataset.n} liberada.`);
    } catch (erro) { toastFalha(erro); }
  });

  delegar(alvo, "click", "[data-acao='lancar']", (_e, botao) => abrirVendaManual(Number(botao.dataset.n)));

  $("#add-table")?.addEventListener("click", async () => {
    try {
      await apiMesas.adicionar();
      await recarregar();
    } catch (erro) { toastFalha(erro); }
  });

  $("#remove-table")?.addEventListener("click", async () => {
    const ultima = [...estado.mesas].sort((a, b) => b.n - a.n)[0];
    if (!ultima) return;
    if (!confirm(`Remover a mesa ${ultima.n}?`)) return;
    try {
      await apiMesas.remover(ultima.n);
      await recarregar();
    } catch (erro) {
      /* O servidor recusa remover mesa com comanda aberta. */
      toastFalha(erro);
    }
  });
}
