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

  if (periodo === "personalizado" && desde && ate) {
    return {
      desde: `${desde} 00:00:00`,
      ate: `${ate} 23:59:59`,
      rotulo: `${desde} a ${ate}`
    };
  }

  /* "Tudo" nao tem inicio calculado: pega o historico inteiro da loja, desde
   * antes de qualquer pedido possivel existir. */
  if (periodo === "tudo") {
    return { desde: "2000-01-01 00:00:00", ate: paraSql(agora), rotulo: "Tudo" };
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
  async dashboard({ periodo, desde, ate, canal }) {
    const intervalo = resolverPeriodo({ periodo, desde, ate });
    const filtro = { desde: intervalo.desde, ate: intervalo.ate, canal: canal || null };

    /* Agregacoes independentes. Em fila seriam varias idas ao Postgres, uma
     * esperando a outra — o dashboard e a tela mais lenta do painel e nao ha
     * ordem entre elas. */
    const [
      resumo, canceladosResumo, emFalta, porHora, porDia, porCanal, porPagamento, porModalidade, porMotoboy,
      maisVendidos, menosVendidos, vendas, cancelados, taxaServico
    ] = await Promise.all([
      pedidosRepo.resumoPeriodo(filtro),
      pedidosRepo.resumoCancelados(filtro),
      produtosRepo.emFalta(),
      pedidosRepo.porHora(filtro),
      pedidosRepo.porDia(filtro),
      pedidosRepo.agruparPor("canal", filtro),
      pedidosRepo.agruparPor("pagamento", filtro),
      pedidosRepo.agruparPor("modalidade", filtro),
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
        valorCancelado: Math.round(canceladosResumo.valor * 100) / 100
      },
      taxaServico: {
        total: Math.round(taxaServico.total * 100) / 100,
        contasFechadas: taxaServico.contasFechadas,
        contasSemCobranca: taxaServico.contasSemCobranca
      },
      porHora,
      porDia,
      porCanal,
      porPagamento,
      porModalidade,
      porMotoboy,
      maisVendidos,
      menosVendidos,
      vendas: vendas.filter(pedido => !canal || pedido.channel === canal),
      cancelados: cancelados.filter(pedido => !canal || pedido.channel === canal),
      estoqueBaixo: emFalta
        .filter(produto => controlaEstoqueCategoria(produto.category))
        .map(produto => ({
          id: produto.id, nome: produto.name, estoque: produto.stock, minimo: produto.minStock
        }))
    };
  },

  /* Linhas cruas do periodo para a exportacao. Inclui dados de entrega porque
   * a casa usa a planilha para conferencia operacional e repasse de motoboy. */
  async exportacao({ periodo, desde, ate, canal }) {
    const intervalo = resolverPeriodo({ periodo, desde, ate });
    const pedidos = await pedidosRepo.listar({ desde: intervalo.desde, ate: intervalo.ate, status: "entregue", limite: 1000 });

    return {
      periodo: intervalo,
      linhas: pedidos
        .filter(pedido => !canal || pedido.channel === canal)
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
          motoboy: pedido.motoboy,
          pagamento: pedido.payment,
          itens: pedido.items.map(item => `${item.qty}x ${item.name}`).join("; "),
          subtotal: pedido.subtotal,
          desconto: pedido.discount,
          taxaEntrega: pedido.deliveryFee,
          total: pedido.total
        }))
    };
  }
};
