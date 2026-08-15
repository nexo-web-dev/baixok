/* Mesas do salao.
 *
 * O QR fica sempre disponivel na mesa. Quando o cliente escaneia e envia o
 * primeiro pedido, o servidor abre a comanda automaticamente. Fechar a conta
 * trava novos pedidos ate o pagamento liberar a mesa. */
import { el, render, $, delegar, mostrar, ligarModal } from "../../../utils/dom.js";
import { reais, minutosDesde, esperaLegivel } from "../../../utils/formato.js";
import { apiMesas, apiAjustes } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";
import { imprimir } from "../../../components/impressao.js";
import { abrirQrMesa, abrirQrCardapio } from "../../../components/qr-mesa.js";
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
      el("p", {}, "Mesa livre. Quando o cliente escanear o QR e enviar o primeiro pedido, a comanda abre automaticamente."),
      el("button.primary.wide", { type: "button", dataset: { acao: "qr", n: String(mesa.n) } }, "Ver QR da mesa")
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

  /* So preenche se o campo nao estiver com foco: o admin pode estar digitando
   * quando um evento em tempo real redesenha a aba. */
  const campoUrl = $("#menu-url-input");
  if (campoUrl && document.activeElement !== campoUrl) campoUrl.value = estado.ajustes.menu_url || "";
}

async function recarregar() {
  await carregar("mesas");
  desenharMesas();
}

/* Fechar a conta imprime a nota com o extrato que o SERVIDOR devolveu, e nao
 * com o que estava na tela. Se outro atendente lancou um item um segundo antes,
 * a nota impressa ja sai com ele. */
async function fecharConta(n, cobrarServico, pagamento) {
  try {
    const { conta } = await apiMesas.fecharConta(n, cobrarServico, pagamento);
    imprimir({
      id: `mesa-${n}`,
      codeLabel: `MESA ${n}`,
      createdAt: conta.abertaEm || new Date().toISOString(),
      channel: "loja",
      fulfillment: "mesa",
      customer: `Mesa ${n}`,
      place: `Mesa ${n} - salão`,
      payment: pagamento,
      note: cobrarServico
        ? `Serviço (${Math.round(conta.percentualServico * 100)}%): ${reais(conta.servico)}`
        : "Taxa de serviço não cobrada nesta conta.",
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

/* Pergunta se a taxa do garçom foi cobrada antes de fechar de fato — cancelar
 * ali nao fecha a conta, so descarta a pergunta. */
let mesaPendenteFechamento = null;

function abrirFecharConta(n) {
  const mesa = estado.mesas.find(item => item.n === n);
  const percentual = Math.round((mesa?.conta?.percentualServico || 0) * 100);
  mesaPendenteFechamento = n;
  const resumo = $("#service-fee-summary");
  if (resumo) resumo.textContent = `Mesa ${n} · taxa de serviço da casa: ${percentual}%.`;
  if ($("#service-fee-payment")) $("#service-fee-payment").value = "";
  mostrar($("#service-fee-payment-error"), false);
  mostrar($("#service-fee-modal"), true);
}

function fecharModalFechamento() {
  mostrar($("#service-fee-modal"), false);
  mesaPendenteFechamento = null;
}

/* Sem forma de pagamento escolhida, a conta nao fecha: senao o pedido fica
 * com "Pagar no balcão" pra sempre, que nunca foi pagamento de verdade. */
function pagamentoDoFechamento() {
  const pagamento = $("#service-fee-payment")?.value || "";
  if (!pagamento) {
    mostrar($("#service-fee-payment-error"), true);
    const erro = $("#service-fee-payment-error");
    if (erro) erro.textContent = "Escolha a forma de pagamento antes de fechar a conta.";
    return null;
  }
  mostrar($("#service-fee-payment-error"), false);
  return pagamento;
}

export function ligarMesas() {
  const alvo = $("#tables-grid");
  if (!alvo) return;

  delegar(alvo, "click", "[data-acao='qr']", (_e, botao) =>
    abrirQrMesa(Number(botao.dataset.n), estado.ajustes.menu_url));

  /* Um botao so: salva o endereco (se mudou) e ja gera o QR em seguida — sem
   * isso a pessoa precisava lembrar de salvar antes de gerar, dois passos pra
   * uma coisa so. */
  $("#generate-menu-qr")?.addEventListener("click", async () => {
    const erro = $("#menu-url-error");
    if (erro) mostrar(erro, false);
    const valor = $("#menu-url-input")?.value.trim() || "";

    try {
      if (valor && valor !== estado.ajustes.menu_url) {
        await apiAjustes.gravar({ menu_url: valor });
        await carregar("ajustes");
        toast("Endereço do cardápio salvo.");
      }
      await abrirQrCardapio(estado.ajustes.menu_url);
    } catch (falha) {
      if (erro) { erro.textContent = falha.message; mostrar(erro, true); }
    }
  });

  delegar(alvo, "click", "[data-acao='fechar']", (_e, botao) => abrirFecharConta(Number(botao.dataset.n)));

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

  const modalFechamento = $("#service-fee-modal");
  ligarModal(modalFechamento, fecharModalFechamento);
  $("#service-fee-cancel")?.addEventListener("click", fecharModalFechamento);
  $("#service-fee-yes")?.addEventListener("click", () => {
    const pagamento = pagamentoDoFechamento();
    if (!pagamento) return;
    const n = mesaPendenteFechamento;
    fecharModalFechamento();
    if (n !== null) fecharConta(n, true, pagamento);
  });
  $("#service-fee-no")?.addEventListener("click", () => {
    const pagamento = pagamentoDoFechamento();
    if (!pagamento) return;
    const n = mesaPendenteFechamento;
    fecharModalFechamento();
    if (n !== null) fecharConta(n, false, pagamento);
  });
}
