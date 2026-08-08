/* Dashboard.
 *
 * Todos os numeros vem agregados do servidor. O painel antigo baixava a lista
 * inteira de pedidos - com nome, telefone e endereco de cada cliente - para
 * somar faturamento no navegador. Alem de pesado, colocava a base de clientes
 * dentro de um tablet que fica no balcao. */
import { el, render, $, delegar } from "../../../utils/dom.js";
import { reais, dinheiro } from "../../../utils/formato.js";
import { CANAIS_ROTULO, MODALIDADES_ROTULO } from "../../../utils/categorias.js";
import { apiPedidos, apiRelatorios } from "../../../services/api.js";
import { toastFalha, toastOk } from "../../../components/toast.js";
import { imprimirAmbas } from "../../../components/impressao.js";

const filtros = { periodo: "hoje", canal: "", desde: "", ate: "" };
let ultimoRelatorio = null;

function metrica(rotulo, valor, nota, tom = "") {
  return el("article.metric-card", { class: tom },
    el("span", {}, rotulo),
    el("strong", {}, valor),
    nota ? el("em.metric-nota", {}, nota) : null
  );
}

function estadoVazioGrafico(mensagem, detalhe) {
  return el("div.chart-empty", {},
    el("p", {}, mensagem),
    detalhe ? el("span.small.faint", {}, detalhe) : null
  );
}

/* Barras proporcionais em CSS puro. O original ja fazia assim - sem biblioteca
 * de grafico, o que para quatro barras continua sendo a escolha certa. */
function barras(linhas, formatar, vazioMensagem = "Sem dados no periodo.", vazioDetalhe = "O grafico fica pronto para crescer quando entrarem pedidos.") {
  if (!linhas.length) return estadoVazioGrafico(vazioMensagem, vazioDetalhe);
  const maior = Math.max(...linhas.map(linha => Number(linha.valor) || 0), 1);

  return el("div.chart-rows", {}, ...linhas.map(linha =>
    el("div.chart-row", {},
      el("span.chart-label", {}, linha.rotulo),
      el("span.chart-bar", {}, el("i", { style: { width: `${Math.max(3, (linha.valor / maior) * 100)}%` } })),
      el("span.chart-value", {}, formatar(linha.valor))
    )
  ));
}

const primeiro = lista => lista?.[0] || null;

function produtoResumo(produto) {
  return produto ? `${produto.rotulo} (${produto.quantidade}x)` : "Sem venda";
}

function parametrosDashboard() {
  return {
    periodo: filtros.periodo,
    desde: filtros.periodo === "personalizado" ? filtros.desde || undefined : undefined,
    ate: filtros.periodo === "personalizado" ? filtros.ate || undefined : undefined,
    canal: filtros.canal || undefined
  };
}

function resumoModalidade(porModalidade) {
  const mapa = Object.fromEntries((porModalidade || []).map(linha => [linha.rotulo, linha.pedidos]));
  const loja = Number(mapa.mesa || 0) + Number(mapa.retirada || 0);
  return {
    loja,
    entrega: Number(mapa.entrega || 0)
  };
}

function horaCurta(data) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(data));
}

function vendaLinha(pedido) {
  const cancelado = pedido.status === "cancelado";
  return el("article.sale-row", { dataset: { id: pedido.id } },
    el("div.sale-main", {},
      el("strong", {}, pedido.customer || "Cliente sem nome"),
      el("span", {}, `${horaCurta(pedido.createdAt)} | ${CANAIS_ROTULO[pedido.channel] || pedido.channel || "-"} | ${pedido.fulfillment || "-"}`),
      pedido.fulfillment === "entrega" && pedido.motoboy ? el("span", {}, `Motoboy: ${pedido.motoboy}`) : null,
      el("em", {}, pedido.items.map(item => `${item.qty}x ${item.name}`).join(" | ") || "Sem itens")
    ),
    el("div.sale-side", {},
      el("strong", {}, reais(pedido.total || 0)),
      el("span", { class: cancelado ? "danger-text" : "" }, cancelado ? "Cancelado" : pedido.payment || "Pagamento nao informado"),
      !cancelado
        ? el("button.secondary.small", { type: "button", dataset: { action: "reprint-sale" } }, "Reimprimir")
        : null,
      cancelado
        ? null
        : el("button.secondary.small", { type: "button", dataset: { action: "cancel-sale" } }, "Cancelar")
    )
  );
}

export async function desenharDashboard() {
  try {
    ultimoRelatorio = await apiRelatorios.dashboard(parametrosDashboard());
  } catch (erro) {
    toastFalha(erro, "Dashboard");
    return;
  }

  const {
    resumo, porHora, porDia = [], porCanal, porPagamento, porModalidade = [],
    maisVendidos, menosVendidos = [], estoqueBaixo, periodo, vendas = []
  } = ultimoRelatorio;
  const pagamentoTop = primeiro(porPagamento);
  const plataformaTop = primeiro(porCanal);
  const modalidades = resumoModalidade(porModalidade);

  render($("#dashboard-metrics"),
    metrica("Faturamento", reais(resumo.faturamento), periodo.rotulo),
    metrica("Pedidos", String(resumo.pedidos), "cancelados fora da conta"),
    metrica("Ticket medio", reais(resumo.ticketMedio), null),
    metrica("Mais vendido", produtoResumo(primeiro(maisVendidos)), primeiro(maisVendidos) ? reais(primeiro(maisVendidos).faturamento) : null),
    metrica("Menos vendido", produtoResumo(primeiro(menosVendidos)), primeiro(menosVendidos) ? reais(primeiro(menosVendidos).faturamento) : null),
    metrica("Pagamento lider", pagamentoTop ? pagamentoTop.rotulo || "nao informado" : "Sem dados", pagamentoTop ? reais(pagamentoTop.faturamento) : null),
    metrica("Entrega x loja", `${modalidades.entrega} / ${modalidades.loja}`, "entrega / loja"),
    metrica("Plataforma lider", plataformaTop ? CANAIS_ROTULO[plataformaTop.rotulo] || plataformaTop.rotulo : "Sem dados", plataformaTop ? reais(plataformaTop.faturamento) : null),
    metrica("Descontos", reais(resumo.descontos), resumo.taxasEntrega ? `taxas entrega ${reais(resumo.taxasEntrega)}` : null),
    metrica("Estoque critico", String(estoqueBaixo.length), estoqueBaixo.length ? "itens no minimo" : "tudo certo",
      estoqueBaixo.length ? "alert-copper" : "")
  );

  render($("#day-chart"), barras(
    porDia.map(linha => ({ rotulo: linha.rotulo, valor: linha.faturamento })),
    reais,
    "Sem vendas por dia neste periodo.",
    "Troque para 7 dias ou 30 dias para enxergar a evolucao."
  ));

  render($("#channel-chart"), barras(
    porCanal.map(linha => ({ rotulo: CANAIS_ROTULO[linha.rotulo] || linha.rotulo || "-", valor: linha.pedidos })),
    valor => `${valor} ped.`,
    "Nenhum canal movimentou neste periodo.",
    "iFood, 99Food, WhatsApp, loja e cardapio aparecem aqui."
  ));

  render($("#payment-chart"), barras(
    porPagamento.map(linha => ({ rotulo: linha.rotulo || "nao informado", valor: linha.pedidos })),
    valor => `${valor} ped.`,
    "Sem pagamentos registrados.",
    "A divisao por forma de pagamento vai aparecer neste bloco."
  ));

  render($("#fulfillment-chart"), barras(
    porModalidade.map(linha => ({ rotulo: MODALIDADES_ROTULO[linha.rotulo] || linha.rotulo || "-", valor: linha.pedidos })),
    valor => `${valor} ped.`,
    "Sem modalidades registradas.",
    "Mostra quantas entregas, retiradas e mesas sairam."
  ));

  render($("#hour-chart"), barras(
    porHora.map(linha => ({ rotulo: `${linha.hora}h`, valor: linha.pedidos })),
    valor => `${valor} ped.`,
    "Sem movimento por hora.",
    "Quando o caixa rodar, este grafico mostra os picos do dia."
  ));

  render($("#best-items"), barras(
    maisVendidos.map(linha => ({ rotulo: linha.rotulo, valor: linha.quantidade })),
    valor => `${valor}x`,
    "Sem itens vendidos ainda.",
    "Os produtos mais fortes do periodo entram aqui automaticamente."
  ));

  render($("#worst-items"), barras(
    menosVendidos.map(linha => ({ rotulo: linha.rotulo, valor: linha.quantidade })),
    valor => `${valor}x`,
    "Sem itens para comparar.",
    "Quando houver mais vendas, os itens fracos aparecem aqui."
  ));

  render($("#stock-alert-chart"), estoqueBaixo.length
    ? barras(
        estoqueBaixo.map(item => ({ rotulo: item.nome, valor: item.estoque })),
        valor => `${valor} un.`
      )
    : estadoVazioGrafico(
        "Nenhum item no minimo.",
        "Quando algo baixar, este bloco vira alerta visual."
      ));

  render($("#dashboard-sales"), vendas.length
    ? vendas.map(vendaLinha)
    : el("p.faint.pad", {}, "Nenhuma venda neste periodo."));
}

/* Exportacao em CSV com separador ponto-e-virgula e BOM: e o que o Excel em
 * portugues abre com as colunas certas sem passo de importacao. */
function exportarPlanilha() {
  if (!ultimoRelatorio) return;

  apiRelatorios.exportar(parametrosDashboard())
    .then(({ linhas, periodo }) => {
      const colunas = ["id", "data", "status", "canal", "modalidade", "cliente", "telefone", "endereco", "motoboy", "pagamento", "itens", "subtotal", "desconto", "taxaEntrega", "total"];
      const escapar = valor => `"${String(valor ?? "").replace(/"/g, '""')}"`;

      const csv = [
        colunas.join(";"),
        ...linhas.map(linha => colunas.map(coluna => {
          const valor = linha[coluna];
          return typeof valor === "number" ? escapar(dinheiro(valor)) : escapar(valor);
        }).join(";"))
      ].join("\r\n");

      const blob = new Blob([`ï»¿${csv}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `baixok-${periodo.rotulo.toLowerCase().replace(/\s+/g, "-")}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    })
    .catch(erro => toastFalha(erro, "Exportacao"));
}

export function ligarDashboard() {
  const grupo = $("#period-group");
  delegar(grupo, "click", "[data-period]", (_e, botao) => {
    filtros.periodo = botao.dataset.period;
    filtros.desde = "";
    filtros.ate = "";
    $("#filter-from").value = "";
    $("#filter-to").value = "";
    for (const outro of grupo.querySelectorAll("[data-period]")) {
      outro.classList.toggle("active", outro === botao);
    }
    desenharDashboard();
  });

  const canal = $("#filter-channel");
  if (canal) {
    render(canal,
      el("option", { value: "" }, "Canal: todos"),
      ...Object.entries(CANAIS_ROTULO).map(([chave, rotulo]) => el("option", { value: chave }, rotulo))
    );
    canal.addEventListener("change", () => {
      filtros.canal = canal.value;
      desenharDashboard();
    });
  }

  $("#export-dashboard")?.addEventListener("click", exportarPlanilha);

  $("#apply-period")?.addEventListener("click", () => {
    const desde = $("#filter-from")?.value || "";
    const ate = $("#filter-to")?.value || "";
    if (!desde || !ate) return toastFalha(new Error("Escolha data inicial e final."), "Periodo");
    filtros.periodo = "personalizado";
    filtros.desde = desde;
    filtros.ate = ate;
    for (const outro of grupo.querySelectorAll("[data-period]")) outro.classList.remove("active");
    desenharDashboard();
  });

  delegar($("#dashboard-sales"), "click", "[data-action='cancel-sale']", async (_evento, botao) => {
    const linha = botao.closest(".sale-row");
    if (!linha) return;
    const motivo = (prompt("Motivo do cancelamento da venda (obrigatorio):", "") ?? "").trim();
    if (!motivo) return toastFalha(new Error("Informe o motivo para cancelar."), "Venda");
    botao.disabled = true;
    try {
      await apiPedidos.cancelar(linha.dataset.id, motivo);
      toastOk("Venda cancelada.");
      await desenharDashboard();
    } catch (erro) {
      toastFalha(erro, "Venda");
      botao.disabled = false;
    }
  });

  delegar($("#dashboard-sales"), "click", "[data-action='reprint-sale']", async (_evento, botao) => {
    const linha = botao.closest(".sale-row");
    if (!linha) return;
    botao.disabled = true;
    try {
      const { pedido } = await apiPedidos.buscar(linha.dataset.id);
      imprimirAmbas(pedido);
      toastOk("Nota enviada para reimpressao.");
    } catch (erro) {
      toastFalha(erro, "Reimpressao");
    } finally {
      botao.disabled = false;
    }
  });
}
