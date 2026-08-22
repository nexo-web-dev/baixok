/* Dashboard e relatorios.
 *
 * Tudo agregado no banco. O painel antigo carregava a lista inteira de pedidos
 * para o navegador e somava em JavaScript a cada troca de periodo — com alguns
 * meses de movimento isso trava o tablet. Aqui trafega so o resultado.
 *
 * Efeito colateral bem-vindo: o relatorio deixa de exigir que o navegador tenha
 * acesso a base de pedidos, que carrega nome, telefone e endereco de clientes. */
import { pedidosRepo } from "../repositories/pedidos.repo.js";
import { produtosRepo } from "../repositories/produtos.repo.js";
import { mesasFechamentosRepo } from "../repositories/mesas-fechamentos.repo.js";
import { HORA_VIRADA } from "../config/constants.js";
import { controlaEstoqueCategoria } from "../lib/estoque.js";

/* O dia operacional vira as 5h: pedido feito 1h da manha pertence ao movimento
 * da noite anterior, nao ao dia seguinte. */
function inicioDoDiaOperacional(quando = new Date()) {
  const inicio = new Date(quando);
  if (inicio.getHours() < HORA_VIRADA) inicio.setDate(inicio.getDate() - 1);
  inicio.setHours(HORA_VIRADA, 0, 0, 0);
  return inicio;
}

/* 'AAAA-MM-DD HH:MM:SS' e o formato que o repositorio converte com
 * `?::timestamptz` do lado do Postgres. Vem do tempo do SQLite, que comparava
 * data como texto, e continua servindo: o cast entende o literal e a comparacao
 * passa a ser entre timestamps de verdade. */
const paraSql = data => data.toISOString().replace("T", " ").slice(0, 19);

export function resolverPeriodo({ periodo, desde, ate }) {
  const agora = new Date();

  /* "-03:00" explicito e obrigatorio aqui: sem ele, "2026-08-17 00:00:00" vai
   * pro Postgres sem fuso nenhum, e o ?::timestamptz interpreta como UTC —
   * meia-noite em Brasilia vira 21h do dia anterior, e pedido feito depois
   * das 21h de hoje ficava de fora do proprio dia de hoje. O restante do
   * sistema nunca cai nessa pegadinha porque monta a data a partir de um
   * Date() de verdade (paraSql), nao de texto digitado pela pessoa. Fixo em
   * -03:00 porque o Brasil nao tem mais horario de verao desde 2019. */
  if (periodo === "personalizado" && desde && ate) {
    /* Com hora (datetime-local do navegador, "AAAA-MM-DDTHH:MM") usa o minuto
     * exato escolhido; so com data (formato antigo) continua cobrindo o dia
     * inteiro, de 00:00 a 23:59:59. */
    const comHora = valor => valor.length > 10;
    const desdeTexto = comHora(desde) ? `${desde}:00-03:00` : `${desde}T00:00:00-03:00`;
    const ateTexto = comHora(ate) ? `${ate}:00-03:00` : `${ate}T23:59:59-03:00`;
    const formatarRotulo = valor => comHora(valor)
      ? `${valor.slice(8, 10)}/${valor.slice(5, 7)} ${valor.slice(11, 16)}`
      : `${valor.slice(8, 10)}/${valor.slice(5, 7)}`;

    return {
      desde: desdeTexto,
      ate: ateTexto,
      rotulo: `${formatarRotulo(desde)} a ${formatarRotulo(ate)}`
    };
  }

  /* "Tudo" nao tem inicio calculado: pega o historico inteiro da loja, desde
   * antes de qualquer pedido possivel existir. */
  if (periodo === "tudo") {
    return { desde: "2000-01-01 00:00:00", ate: paraSql(agora), rotulo: "Tudo" };
  }

  /* "Ontem" e o unico periodo fixo que NAO vai ate agora — e o dia operacional
   * anterior inteiro, do inicio ao fim, pra nao misturar com o movimento de
   * hoje que ainda esta rolando. */
  if (periodo === "ontem") {
    const inicioHoje = inicioDoDiaOperacional(agora);
    const inicioOntem = new Date(inicioHoje);
    inicioOntem.setDate(inicioOntem.getDate() - 1);
    const fimOntem = new Date(inicioHoje.getTime() - 1000);
    return { desde: paraSql(inicioOntem), ate: paraSql(fimOntem), rotulo: "Ontem" };
  }

  const inicio = inicioDoDiaOperacional(agora);
  if (periodo === "7dias") inicio.setDate(inicio.getDate() - 6);
  if (periodo === "30dias") inicio.setDate(inicio.getDate() - 29);
  if (periodo === "mes") inicio.setDate(1);

  return {
    desde: paraSql(inicio),
    ate: paraSql(agora),
    rotulo: { hoje: "Hoje", "7dias": "Ultimos 7 dias", "30dias": "Ultimos 30 dias", mes: "Este mes" }[periodo] || "Hoje"
  };
}

export const relatoriosService = {
  async dashboard({ periodo, desde, ate, canal, pagamento, categoria }) {
    const intervalo = resolverPeriodo({ periodo, desde, ate });
    const filtro = {
      desde: intervalo.desde, ate: intervalo.ate,
      canal: canal || null, pagamento: pagamento || null, categoria: categoria || null
    };

    /* Agregacoes independentes. Em fila seriam varias idas ao Postgres, uma
     * esperando a outra — o dashboard e a tela mais lenta do painel e nao ha
     * ordem entre elas. */
    /* "Tudo" agrupa por mes: com o historico inteiro, um grafico por dia vira
     * uma lista ilegivel de centenas de barras. */
    const agrupadoPorMes = periodo === "tudo";

    const [
      resumo, canceladosResumo, naoPagoResumo, cortesiaResumo, emFalta, porHora, porDia, porCanal, porPagamento, porModalidade, porCategoria,
      porMotoboy, maisVendidos, menosVendidos, vendas, cancelados, taxaServico
    ] = await Promise.all([
      pedidosRepo.resumoPeriodo(filtro),
      pedidosRepo.resumoCancelados(filtro),
      pedidosRepo.resumoNaoPago(filtro),
      pedidosRepo.resumoCortesia(filtro),
      produtosRepo.emFalta(),
      pedidosRepo.porHora(filtro),
      agrupadoPorMes ? pedidosRepo.porMes(filtro) : pedidosRepo.porDia(filtro),
      pedidosRepo.agruparPor("canal", filtro),
      pedidosRepo.agruparPor("pagamento", filtro),
      pedidosRepo.agruparPor("modalidade", filtro),
      pedidosRepo.porCategoria(filtro),
      pedidosRepo.porMotoboy(filtro),
      pedidosRepo.maisVendidos({ ...filtro, limite: 10 }),
      pedidosRepo.menosVendidos({ ...filtro, limite: 10 }),
      pedidosRepo.listar({ ...filtro, status: "entregue", limite: 200 }),
      pedidosRepo.listar({ ...filtro, status: "cancelado", limite: 100 }),
      mesasFechamentosRepo.resumoPeriodo(filtro)
    ]);

    return {
      periodo: intervalo,
      resumo: {
        pedidos: resumo.pedidos,
        faturamento: Math.round(resumo.faturamento * 100) / 100,
        ticketMedio: Math.round(resumo.ticket_medio * 100) / 100,
        descontos: Math.round(resumo.descontos * 100) / 100,
        taxasEntrega: Math.round(resumo.taxas_entrega * 100) / 100,
        cancelados: canceladosResumo.pedidos,
        valorCancelado: Math.round(canceladosResumo.valor * 100) / 100,
        naoPagos: naoPagoResumo.pedidos,
        valorNaoPago: Math.round(naoPagoResumo.valor * 100) / 100,
        cortesias: cortesiaResumo.pedidos,
        valorCortesia: Math.round(cortesiaResumo.valor * 100) / 100
      },
      taxaServico: {
        total: Math.round(taxaServico.total * 100) / 100,
        contasFechadas: taxaServico.contasFechadas,
        contasSemCobranca: taxaServico.contasSemCobranca
      },
      porHora,
      porDia,
      agrupadoPorMes,
      porCanal,
      porPagamento,
      porModalidade,
      porCategoria,
      porMotoboy,
      maisVendidos,
      menosVendidos,
      /* A lista bruta (nao os graficos) nao filtra por categoria: o pedido pode
       * misturar categorias na mesma linha, e aqui e a conferencia do pedido
       * inteiro — filtrar sumiria com o resto do que a pessoa comprou. */
      vendas: vendas.filter(pedido => (!canal || pedido.channel === canal) && (!pagamento || pedido.payment === pagamento)),
      cancelados: cancelados.filter(pedido => (!canal || pedido.channel === canal) && (!pagamento || pedido.payment === pagamento)),
      estoqueBaixo: emFalta
        .filter(produto => controlaEstoqueCategoria(produto.category))
        .map(produto => ({
          id: produto.id, nome: produto.name, estoque: produto.stock, minimo: produto.minStock
        }))
    };
  },

  /* Linhas cruas do periodo para a exportacao. Inclui dados de entrega porque
   * a casa usa a planilha para conferencia operacional e repasse de motoboy. */
  async exportacao({ periodo, desde, ate, canal, pagamento }) {
    const intervalo = resolverPeriodo({ periodo, desde, ate });
    const pedidos = await pedidosRepo.listar({ desde: intervalo.desde, ate: intervalo.ate, status: "entregue", limite: 1000 });

    return {
      periodo: intervalo,
      linhas: pedidos
        .filter(pedido => (!canal || pedido.channel === canal) && (!pagamento || pedido.payment === pagamento))
        .map(pedido => ({
          id: pedido.id,
          data: pedido.createdAt,
          status: pedido.status,
          canal: pedido.channel,
          modalidade: pedido.fulfillment,
          cliente: pedido.customer,
          telefone: pedido.phone,
          endereco: pedido.place,
          motivoCancelamento: pedido.cancelReason,
          motivoNaoPago: pedido.naoPagoReason,
          motoboy: pedido.motoboy,
          /* "Dividido" sozinho na planilha nao ajuda quem confere caixa —
           * escreve a quebra por extenso (ver definirPagamentoDividido). */
          pagamento: pedido.payment === "Dividido" && pedido.paymentSplit?.length
            ? pedido.paymentSplit.map(parte => `${parte.forma}: ${Number(parte.valor).toFixed(2)}`).join(" + ")
            : pedido.payment,
          itens: pedido.items.map(item => `${item.qty}x ${item.name}`).join("; "),
          /* Total continua o valor cheio do pedido (o que saiu da cozinha) —
           * cortesia fica numa coluna a parte pra quem confere ver quanto
           * daquele total nao virou dinheiro de verdade, e por que. */
          cortesia: pedido.cortesiaValue > 0 ? `${pedido.cortesiaReason} (${pedido.cortesiaValue.toFixed(2)})` : "",
          subtotal: pedido.subtotal,
          desconto: pedido.discount,
          taxaEntrega: pedido.deliveryFee,
          total: pedido.total
        }))
    };
  }
};
