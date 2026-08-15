/* Dashboard.
 *
 * Todos os numeros vem agregados do servidor. O painel antigo baixava a lista
 * inteira de pedidos - com nome, telefone e endereco de cada cliente - para
 * somar faturamento no navegador. Alem de pesado, colocava a base de clientes
 * dentro de um tablet que fica no balcao. */
import { el, render, $, delegar, mostrar, debounce } from "../../../utils/dom.js";
import { reais, dinheiro } from "../../../utils/formato.js";
import { CANAIS_ROTULO, MODALIDADES_ROTULO, rotuloCategoria } from "../../../utils/categorias.js";
import { apiPedidos, apiRelatorios } from "../../../services/api.js";
import { toastFalha, toastOk } from "../../../components/toast.js";
import { imprimirAmbas } from "../../../components/impressao.js";
import { estado } from "../store.js";

const filtros = { periodo: "hoje", canal: "", pagamento: "", categoria: "", desde: "", ate: "" };
/* Filtro de busca so mexe na LISTA (o que aparece embaixo) — nunca refaz a
 * agregacao do servidor. Faturamento, ticket medio etc. continuam refletindo
 * so periodo + canal, que sao os que de fato mudam o calculo. */
const buscaVendas = { termo: "", fulfillment: "", payment: "" };
let ultimoRelatorio = null;
let pedidoParaExcluir = null;

const normalizarBusca = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

function pedidoCombinaBusca(pedido) {
  if (buscaVendas.fulfillment && pedido.fulfillment !== buscaVendas.fulfillment) return false;
  if (buscaVendas.payment && pedido.payment !== buscaVendas.payment) return false;

  const termo = normalizarBusca(buscaVendas.termo).trim();
  if (!termo) return true;

  const senha = String(pedido.id || "").slice(-3).toUpperCase();
  const alvo = normalizarBusca([
    pedido.customer, pedido.phone, pedido.id, senha,
    ...(pedido.items || []).map(item => item.name)
  ].join(" "));
  return alvo.includes(termo);
}

function preencherFiltroPagamento(vendas, cancelados) {
  const select = $("#sales-filter-payment");
  if (!select) return;
  const atual = select.value;
  const pagamentos = [...new Set([...vendas, ...cancelados].map(p => p.payment).filter(Boolean))].sort();

  render(select,
    el("option", { value: "" }, "Todos os pagamentos"),
    ...pagamentos.map(pagamento => el("option", { value: pagamento }, pagamento))
  );
  if (pagamentos.includes(atual)) select.value = atual;
}

function renderizarLista(alvoId, vazioId, todos, renderLinha, mensagemVazio) {
  const alvo = $(`#${alvoId}`);
  if (!alvo) return;

  if (!todos.length) {
    render(alvo, el("p.faint.pad", {}, mensagemVazio));
    mostrar($(`#${vazioId}`), false);
    return;
  }

  const filtrados = todos.filter(pedidoCombinaBusca);
  render(alvo, filtrados.map(renderLinha));
  mostrar($(`#${vazioId}`), filtrados.length === 0);
}

function renderizarListasVendas() {
  const { vendas = [], cancelados = [] } = ultimoRelatorio || {};
  renderizarLista("dashboard-sales", "dashboard-sales-empty", vendas, vendaLinha, "Nenhuma venda neste período.");
  renderizarLista("dashboard-canceled", "dashboard-canceled-empty", cancelados, canceladoLinha, "Nenhum pedido cancelado neste período.");
}

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
      el("span.chart-value", {}, formatar(linha.valor, linha))
    )
  ));
}

const primeiro = lista => lista?.[0] || null;
const dinheiroEPedidos = (valor, linha) => `${reais(valor)} · ${Number(linha.pedidos || 0)} ped.`;
const dinheiroEUnidades = (valor, linha) => `${reais(valor)} · ${Number(linha.unidades || 0)} un.`;

function produtoResumo(produto) {
  return produto ? `${produto.rotulo} (${produto.quantidade}x)` : "Sem venda";
}

function parametrosDashboard() {
  return {
    periodo: filtros.periodo,
    desde: filtros.periodo === "personalizado" ? filtros.desde || undefined : undefined,
    ate: filtros.periodo === "personalizado" ? filtros.ate || undefined : undefined,
    canal: filtros.canal || undefined,
    pagamento: filtros.pagamento || undefined,
    categoria: filtros.categoria || undefined
  };
}

/* As opcoes NAO vem do resultado filtrado do periodo (porPagamento/
 * porCategoria): se ja tiver "Pix" selecionado, aquele agrupamento so devolve
 * "Pix" (o proprio filtro se aplica antes do GROUP BY), e o combo perderia
 * todas as outras opcoes assim que uma fosse escolhida. Categoria vem do
 * catalogo cadastrado; pagamento, dos valores que o proprio sistema usa (
 * checkout, venda manual, mesa) — nenhum dos dois depende do filtro atual.
 * Preserva a selecao ao redesenhar. */
/* "Pagar no balcao" fica de fora de proposito: nunca foi forma de pagamento
 * de verdade, so o marcador de "ainda nao pago" enquanto a mesa estava aberta
 * — o fechamento da conta troca pelo pagamento real (ver mesas.service.js). */
const PAGAMENTOS_CONHECIDOS = ["Dinheiro", "Pix", "Cartão", "Online"];

function categoriasDoCatalogo() {
  return [...new Set((estado.produtos || []).map(produto => String(produto.category || "").trim()).filter(Boolean))];
}

function preencherFiltroSelect(id, opcoes, rotuloPadrao, rotular = valor => valor) {
  const select = $(`#${id}`);
  if (!select) return;
  const atual = select.value;
  render(select,
    el("option", { value: "" }, rotuloPadrao),
    ...opcoes.map(valor => el("option", { value: valor }, rotular(valor)))
  );
  if (opcoes.includes(atual)) select.value = atual;
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

function trocoResumoDashboard(pedido) {
  if (!String(pedido.payment || "").toLowerCase().includes("dinheiro")) return null;
  const trocoPara = Number(pedido.trocoPara || 0);
  if (!trocoPara) return "Pagamento em dinheiro. Conferir troco no balcao.";
  const troco = Math.max(0, trocoPara - Number(pedido.total || 0));
  return `Troco para ${reais(trocoPara)} | devolver ${reais(troco)}`;
}

function vendaTag(texto) {
  return texto ? el("span.sale-tag", {}, texto) : null;
}

function fotoVenda(item) {
  if (!item?.image) return el("div.sale-item-thumb.no-photo", {}, "Sem foto");
  return el("span.fit-media.sale-item-thumb", {},
    el("img.fit-media-bg", {
      src: item.image,
      alt: "",
      loading: "lazy",
      decoding: "async",
      "aria-hidden": "true"
    }),
    el("img.fit-media-main", {
      src: item.image,
      alt: item.name || "Produto",
      loading: "lazy",
      decoding: "async",
      onerror: evento => evento.target.closest(".fit-media")?.replaceWith(el("div.sale-item-thumb.no-photo", {}, "Sem foto"))
    })
  );
}

function itemVenda(item) {
  const total = Number(item.price || 0) * Number(item.qty || 0);
  return el("div.sale-item", {},
    fotoVenda(item),
    el("div", {},
      el("strong", {}, `${item.qty}x ${item.name}`),
      el("span", {}, `${reais(item.price || 0)} cada`)
    ),
    el("strong", {}, reais(total))
  );
}

function vendaLinha(pedido) {
  const cancelado = pedido.status === "cancelado";
  const troco = trocoResumoDashboard(pedido);
  return el("article.sale-row", { dataset: { id: pedido.id } },
    el("div.sale-main", {},
      el("div.sale-title", {},
        el("strong", {}, pedido.customer || "Cliente sem nome"),
        el("span", {}, horaCurta(pedido.createdAt))
      ),
      el("div.sale-tags", {},
        vendaTag(CANAIS_ROTULO[pedido.channel] || pedido.channel || "-"),
        vendaTag(MODALIDADES_ROTULO[pedido.fulfillment] || pedido.fulfillment || "-"),
        vendaTag(pedido.payment || "Pagamento nao informado")
      ),
      pedido.fulfillment === "entrega" && pedido.motoboy ? el("span", {}, `Motoboy: ${pedido.motoboy}`) : null,
      cancelado && pedido.cancelReason ? el("span.danger-text", {}, `Motivo: ${pedido.cancelReason}`) : null,
      troco ? el("span.money-text", {}, `Troco: ${troco}`) : null,
      el("div.sale-items", {}, pedido.items.length ? pedido.items.map(itemVenda) : el("em", {}, "Sem itens"))
    ),
    el("div.sale-side", {},
      el("strong", {}, reais(pedido.total || 0)),
      el("span", { class: cancelado ? "danger-text" : "" }, cancelado ? "Cancelado" : pedido.payment || "Pagamento não informado"),
      el("button.secondary.small", { type: "button", dataset: { action: "details-sale" } }, "Detalhes"),
      !cancelado
        ? el("button.secondary.small", { type: "button", dataset: { action: "reprint-sale" } }, "Reimprimir")
        : null,
      cancelado
        ? null
        : el("button.secondary.small", { type: "button", dataset: { action: "cancel-sale" } }, "Cancelar"),
      estado.usuario?.papel === "admin"
        ? el("button.danger.small", { type: "button", dataset: { action: "delete-sale" } }, "Excluir")
        : null
    ),
    el("div.sale-detail.hidden", {},
      el("strong", {}, "Detalhes do pedido"),
      el("span", {}, `Telefone: ${pedido.phone || "-"}`),
      el("span", {}, `Endereço/local: ${pedido.place || "-"}`),
      pedido.note ? el("span", {}, `Obs.: ${pedido.note}`) : null,
      pedido.cancelReason ? el("span.danger-text", {}, `Motivo do cancelamento: ${pedido.cancelReason}`) : null,
      pedido.motoboy ? el("span", {}, `Motoboy: ${pedido.motoboy}`) : null
    )
  );
}

function canceladoLinha(pedido) {
  return vendaLinha(pedido);
}

export async function desenharDashboard() {
  try {
    ultimoRelatorio = await apiRelatorios.dashboard(parametrosDashboard());
  } catch (erro) {
    toastFalha(erro, "Dashboard");
    return;
  }

  const {
    resumo, porHora, porDia = [], agrupadoPorMes = false, porCanal, porPagamento, porModalidade = [],
    porCategoria = [], porMotoboy = [], maisVendidos, menosVendidos = [], estoqueBaixo, periodo, vendas = [],
    cancelados = [], taxaServico = { total: 0, contasFechadas: 0, contasSemCobranca: 0 }
  } = ultimoRelatorio;
  preencherFiltroSelect("filter-payment", PAGAMENTOS_CONHECIDOS, "Pagamento: todos");
  preencherFiltroSelect("filter-category", categoriasDoCatalogo(), "Categoria: todas", rotuloCategoria);

  const pagamentoTop = primeiro(porPagamento);
  const plataformaTop = primeiro(porCanal);
  const modalidades = resumoModalidade(porModalidade);
  const motoboyTop = primeiro(porMotoboy);

  render($("#dashboard-metrics"),
    metrica("Faturamento", reais(resumo.faturamento), periodo.rotulo),
    metrica("Pedidos", String(resumo.pedidos), "cancelados fora da conta"),
    metrica("Ticket médio", reais(resumo.ticketMedio), null),
    metrica("Mais vendido", produtoResumo(primeiro(maisVendidos)), primeiro(maisVendidos) ? reais(primeiro(maisVendidos).faturamento) : null),
    metrica("Menos vendido", produtoResumo(primeiro(menosVendidos)), primeiro(menosVendidos) ? reais(primeiro(menosVendidos).faturamento) : null),
    metrica("Pagamento líder", pagamentoTop ? pagamentoTop.rotulo || "não informado" : "Sem dados", pagamentoTop ? reais(pagamentoTop.faturamento) : null),
    metrica("Entrega x loja", `${modalidades.entrega} / ${modalidades.loja}`, "entrega / loja"),
    metrica("Plataforma líder", plataformaTop ? CANAIS_ROTULO[plataformaTop.rotulo] || plataformaTop.rotulo : "Sem dados", plataformaTop ? reais(plataformaTop.faturamento) : null),
    metrica("Motoboy líder", motoboyTop ? motoboyTop.rotulo : "Sem entrega", motoboyTop ? `${motoboyTop.pedidos} entregas` : null),
    metrica("Taxa do garçom", reais(taxaServico.total),
      taxaServico.contasSemCobranca
        ? `${taxaServico.contasSemCobranca} conta(s) fechada(s) sem cobrar`
        : `${taxaServico.contasFechadas} conta(s) de mesa fechada(s)`,
      taxaServico.contasSemCobranca ? "alert-copper" : ""),
    metrica("Cancelados", String(resumo.cancelados || 0), (resumo.valorCancelado || 0) ? `valor ${reais(resumo.valorCancelado)}` : "nenhum no período",
      (resumo.cancelados || 0) ? "alert-danger" : ""),
    metrica("Descontos", reais(resumo.descontos), resumo.taxasEntrega ? `taxas entrega ${reais(resumo.taxasEntrega)}` : null),
    metrica("Estoque crítico", String(estoqueBaixo.length), estoqueBaixo.length ? "itens no mínimo" : "tudo certo",
      estoqueBaixo.length ? "alert-copper" : "")
  );

  const tituloDia = $("#day-chart-title");
  if (tituloDia) tituloDia.textContent = agrupadoPorMes ? "Vendas por mês" : "Vendas por dia";

  render($("#day-chart"), barras(
    porDia.map(linha => ({ rotulo: linha.rotulo, valor: linha.faturamento })),
    reais,
    agrupadoPorMes ? "Sem vendas registradas ainda." : "Sem vendas por dia neste período.",
    agrupadoPorMes ? "Assim que houver pedidos entregues, o histórico mensal aparece aqui." : "Troque para 7 dias ou 30 dias para enxergar a evolução."
  ));

  render($("#channel-chart"), barras(
    porCanal.map(linha => ({
      rotulo: CANAIS_ROTULO[linha.rotulo] || linha.rotulo || "-",
      valor: Number(linha.faturamento || 0),
      pedidos: linha.pedidos
    })),
    dinheiroEPedidos,
    "Nenhum canal movimentou neste período.",
    "iFood, 99Food, WhatsApp, loja e cardápio aparecem aqui."
  ));

  render($("#payment-chart"), barras(
    porPagamento.map(linha => ({
      rotulo: linha.rotulo || "não informado",
      valor: Number(linha.faturamento || 0),
      pedidos: linha.pedidos
    })),
    dinheiroEPedidos,
    "Sem pagamentos registrados.",
    "A divisão por forma de pagamento vai aparecer neste bloco."
  ));

  render($("#fulfillment-chart"), barras(
    porModalidade.map(linha => ({
      rotulo: MODALIDADES_ROTULO[linha.rotulo] || linha.rotulo || "-",
      valor: Number(linha.faturamento || 0),
      pedidos: linha.pedidos
    })),
    dinheiroEPedidos,
    "Sem modalidades registradas.",
    "Mostra quantas entregas, retiradas e mesas saíram."
  ));

  render($("#category-chart"), barras(
    porCategoria.map(linha => ({
      rotulo: rotuloCategoria(linha.rotulo) || linha.rotulo || "-",
      valor: Number(linha.faturamento || 0),
      unidades: linha.unidades
    })),
    dinheiroEUnidades,
    "Sem vendas por categoria neste período.",
    "Pizza, burguer, drink... a divisão por categoria aparece aqui."
  ));

  render($("#hour-chart"), barras(
    porHora.map(linha => ({
      rotulo: `${linha.hora}h`,
      valor: Number(linha.faturamento || 0),
      pedidos: linha.pedidos
    })),
    dinheiroEPedidos,
    "Sem movimento por hora.",
    "Quando o caixa rodar, este gráfico mostra os picos do dia."
  ));

  render($("#best-items"), barras(
    maisVendidos.map(linha => ({ rotulo: linha.rotulo, valor: linha.quantidade })),
    valor => `${valor}x`,
    "Sem itens vendidos ainda.",
    "Os produtos mais fortes do período entram aqui automaticamente."
  ));

  render($("#worst-items"), barras(
    menosVendidos.map(linha => ({ rotulo: linha.rotulo, valor: linha.quantidade })),
    valor => `${valor}x`,
    "Sem itens para comparar.",
    "Quando houver mais vendas, os itens fracos aparecem aqui."
  ));

  render($("#motoboy-chart"), barras(
    porMotoboy.map(linha => ({ rotulo: linha.rotulo, valor: linha.pedidos })),
    valor => `${valor} entregas`,
    "Nenhuma entrega com motoboy no período.",
    "Quando salvar o nome do motoboy na aba Motoboy, o resumo aparece aqui."
  ));

  render($("#stock-alert-chart"), estoqueBaixo.length
    ? barras(
        estoqueBaixo.map(item => ({ rotulo: item.nome, valor: item.estoque })),
        valor => `${valor} un.`
      )
    : estadoVazioGrafico(
        "Nenhum item no mínimo.",
        "Quando algo baixar, este bloco vira alerta visual."
      ));

  preencherFiltroPagamento(vendas, cancelados);
  renderizarListasVendas();
}

/* Exportacao em CSV com separador ponto-e-virgula e BOM: e o que o Excel em
 * portugues abre com as colunas certas sem passo de importacao. */
function exportarPlanilha() {
  if (!ultimoRelatorio) return;

  apiRelatorios.exportar(parametrosDashboard())
    .then(({ linhas, periodo }) => {
      const colunas = ["id", "data", "status", "canal", "modalidade", "cliente", "telefone", "endereco", "motivoCancelamento", "motoboy", "pagamento", "itens", "subtotal", "desconto", "taxaEntrega", "total"];
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
    .catch(erro => toastFalha(erro, "Exportação"));
}

export function ligarDashboard() {
  $("#sales-search")?.addEventListener("input", debounce(evento => {
    buscaVendas.termo = evento.target.value;
    renderizarListasVendas();
  }));
  $("#sales-filter-fulfillment")?.addEventListener("change", evento => {
    buscaVendas.fulfillment = evento.target.value;
    renderizarListasVendas();
  });
  $("#sales-filter-payment")?.addEventListener("change", evento => {
    buscaVendas.payment = evento.target.value;
    renderizarListasVendas();
  });

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

  $("#filter-payment")?.addEventListener("change", evento => {
    filtros.pagamento = evento.target.value;
    desenharDashboard();
  });
  $("#filter-category")?.addEventListener("change", evento => {
    filtros.categoria = evento.target.value;
    desenharDashboard();
  });

  $("#export-dashboard")?.addEventListener("click", exportarPlanilha);

  $("#apply-period")?.addEventListener("click", () => {
    const desde = $("#filter-from")?.value || "";
    const ate = $("#filter-to")?.value || "";
    if (!desde || !ate) return toastFalha(new Error("Escolha data inicial e final."), "Período");
    filtros.periodo = "personalizado";
    filtros.desde = desde;
    filtros.ate = ate;
    for (const outro of grupo.querySelectorAll("[data-period]")) outro.classList.remove("active");
    desenharDashboard();
  });

  delegar($("#dashboard-sales"), "click", "[data-action='cancel-sale']", async (_evento, botao) => {
    const linha = botao.closest(".sale-row");
    if (!linha) return;
    const motivo = (prompt("Motivo do cancelamento da venda (obrigatório):", "") ?? "").trim();
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
      toastOk("Nota enviada para reimpressão.");
    } catch (erro) {
      toastFalha(erro, "Reimpressão");
    } finally {
      botao.disabled = false;
    }
  });

  const alternarDetalhes = (_evento, botao) => {
    const detalhe = botao.closest(".sale-row")?.querySelector(".sale-detail");
    detalhe?.classList.toggle("hidden");
  };
  delegar($("#dashboard-sales"), "click", "[data-action='details-sale']", alternarDetalhes);
  delegar($("#dashboard-canceled"), "click", "[data-action='details-sale']", alternarDetalhes);

  const abrirExclusao = (_evento, botao) => {
    const linha = botao.closest(".sale-row");
    if (!linha) return;
    pedidoParaExcluir = linha.dataset.id;
    const erro = $("#order-delete-error");
    const senha = $("#order-delete-password");
    if (erro) { erro.textContent = ""; erro.classList.add("hidden"); }
    if (senha) senha.value = "";
    $("#order-delete-modal")?.classList.remove("hidden");
    senha?.focus();
  };
  delegar($("#dashboard-sales"), "click", "[data-action='delete-sale']", abrirExclusao);
  delegar($("#dashboard-canceled"), "click", "[data-action='delete-sale']", abrirExclusao);

  const fecharExclusao = () => {
    pedidoParaExcluir = null;
    $("#order-delete-modal")?.classList.add("hidden");
  };
  $("#order-delete-close")?.addEventListener("click", fecharExclusao);
  $("#order-delete-cancel")?.addEventListener("click", fecharExclusao);
  $("#order-delete-modal")?.addEventListener("click", evento => {
    if (evento.target === $("#order-delete-modal")) fecharExclusao();
  });

  $("#order-delete-confirm")?.addEventListener("click", async () => {
    const erro = $("#order-delete-error");
    const campoSenha = $("#order-delete-password");
    const senha = campoSenha?.value || "";
    if (erro) { erro.textContent = ""; erro.classList.add("hidden"); }

    if (!senha) {
      if (erro) { erro.textContent = "Digite sua senha de administrador."; erro.classList.remove("hidden"); }
      return;
    }
    if (!pedidoParaExcluir) return;

    const botao = $("#order-delete-confirm");
    botao.disabled = true;
    try {
      await apiPedidos.remover(pedidoParaExcluir, senha);
      toastOk("Pedido apagado.");
      fecharExclusao();
      await desenharDashboard();
    } catch (erroReq) {
      if (erro) { erro.textContent = erroReq.message || "Não foi possível apagar o pedido."; erro.classList.remove("hidden"); }
    } finally {
      botao.disabled = false;
    }
  });
}
