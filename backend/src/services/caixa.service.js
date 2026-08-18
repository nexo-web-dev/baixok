import { pedidosRepo } from "../repositories/pedidos.repo.js";
import { caixaRepo } from "../repositories/caixa.repo.js";
import { mesasRepo } from "../repositories/mesas.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { authService } from "./auth.service.js";
import { uid } from "../lib/ids.js";
import { naoEncontrado, conflito } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";

const paraSql = data => data.toISOString().replace("T", " ").slice(0, 19);
const arredondar = valor => Math.round(Number(valor || 0) * 100) / 100;

const rotuloCanal = {
  cardapio: "Cardápio",
  loja: "Loja",
  ifood: "iFood",
  "99food": "99Food",
  rappi: "Rappi",
  whatsapp: "WhatsApp"
};
const rotuloModalidade = { retirada: "Retirada", entrega: "Entrega", mesa: "Mesa" };

function contarModalidades(linhas) {
  const mapa = Object.fromEntries((linhas || []).map(linha => [linha.rotulo, Number(linha.pedidos || 0)]));
  return {
    entregas: mapa.entrega || 0,
    retiradas: mapa.retirada || 0,
    mesas: mapa.mesa || 0
  };
}

/* Separado de resumoFechamento porque e recalculado toda vez que o relatorio
 * e ABERTO, nao so na hora de fechar o caixa: um cartao que volta recusado ou
 * um cliente que nunca aparece costuma ser descoberto DEPOIS do fechamento,
 * as vezes so no dia seguinte. Se isso ficasse preso na foto do fechamento
 * (igual faturamento, cancelados etc.), marcar um pedido como nao pago depois
 * nunca apareceria no relatorio de quando ele realmente aconteceu. */
async function calcularNaoPagos(desde, ate) {
  /* Direto na coluna certa (pedidosRepo.listarNaoPagos), sem buscar todo
   * pedido entregue do periodo com item e foto so pra descartar quase tudo
   * em JS — um fechamento tem centenas de pedidos e normalmente 1 ou 2 nao
   * pagos, entao o custo de listar() inteiro era puro desperdicio aqui. */
  const lista = await pedidosRepo.listarNaoPagos({ desde, ate });
  return {
    calotes: lista.length,
    valorCalote: arredondar(lista.reduce((soma, pedido) => soma + Number(pedido.total || 0), 0)),
    naoPagosLista: lista.map(pedido => ({
      cliente: pedido.cliente || "Cliente",
      total: arredondar(pedido.total),
      motivo: pedido.motivo || ""
    }))
  };
}

/* Mesma ideia de calcularNaoPagos, mas pra cortesia: separado do que fica
 * gravado no fechamento porque tambem pode ser descoberto/corrigido depois. */
async function calcularCortesias(desde, ate) {
  const lista = await pedidosRepo.listarCortesias({ desde, ate });
  return {
    cortesias: lista.length,
    valorCortesia: arredondar(lista.reduce((soma, pedido) => soma + Number(pedido.valor || 0), 0)),
    cortesiasLista: lista.map(pedido => ({
      cliente: pedido.cliente || "Cliente",
      valor: arredondar(pedido.valor),
      motivo: pedido.motivo || ""
    }))
  };
}

async function resumoFechamento(caixa, fechadoEm = new Date()) {
  const filtro = { desde: paraSql(new Date(caixa.abertoEm)), ate: paraSql(fechadoEm) };
  const [resumo, cancelados, naoPago, cortesia, pagamentos, canais, modalidades, motoboys] = await Promise.all([
    pedidosRepo.resumoPeriodo(filtro),
    pedidosRepo.resumoCancelados(filtro),
    calcularNaoPagos(filtro.desde, filtro.ate),
    calcularCortesias(filtro.desde, filtro.ate),
    pedidosRepo.agruparPor("pagamento", filtro),
    pedidosRepo.agruparPor("canal", filtro),
    pedidosRepo.agruparPor("modalidade", filtro),
    pedidosRepo.porMotoboy(filtro)
  ]);
  const contagem = contarModalidades(modalidades);

  return {
    fechadoEm: fechadoEm.toISOString(),
    /* Total de pedidos que saiu da loja no periodo — pago ou nao. Faturamento
     * continua so com o que pagou; aqui e volume de operacao, nao dinheiro. */
    pedidos: Number(resumo.pedidos || 0) + naoPago.calotes,
    faturamento: arredondar(resumo.faturamento),
    descontos: arredondar(resumo.descontos),
    taxasEntrega: arredondar(resumo.taxas_entrega),
    ticketMedio: arredondar(resumo.ticket_medio),
    cancelados: Number(cancelados?.pedidos || 0),
    valorCancelado: arredondar(cancelados?.valor),
    calotes: naoPago.calotes,
    valorCalote: naoPago.valorCalote,
    naoPagosLista: naoPago.naoPagosLista,
    cortesias: cortesia.cortesias,
    valorCortesia: cortesia.valorCortesia,
    cortesiasLista: cortesia.cortesiasLista,
    entregas: contagem.entregas,
    retiradas: contagem.retiradas,
    mesas: contagem.mesas,
    pagamentos: pagamentos.map(linha => ({
      rotulo: linha.rotulo || "Não informado",
      pedidos: linha.pedidos,
      faturamento: arredondar(linha.faturamento)
    })),
    canais: canais.map(linha => ({
      rotulo: rotuloCanal[linha.rotulo] || linha.rotulo || "Não informado",
      pedidos: linha.pedidos,
      faturamento: arredondar(linha.faturamento)
    })),
    modalidades: modalidades.map(linha => ({
      rotulo: rotuloModalidade[linha.rotulo] || linha.rotulo || "Não informado",
      pedidos: linha.pedidos,
      faturamento: arredondar(linha.faturamento)
    })),
    motoboys: motoboys.map(linha => ({
      rotulo: linha.rotulo || "Sem motoboy",
      pedidos: linha.pedidos,
      faturamento: arredondar(linha.faturamento),
      taxasEntrega: arredondar(linha.taxas_entrega)
    }))
  };
}

const escapar = valor => String(valor ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const moeda = valor => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
}).format(Number(valor || 0));

const dataHora = valor => new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short"
}).format(new Date(valor));

/* Vira o <title> da pagina, e o navegador usa o <title> como nome sugerido
 * do arquivo ao "Salvar como PDF" — sem a data ali, dois fechamentos do
 * mesmo mes salvam com nome identico e um sobrescreve o outro sem avisar.
 * Sem dois-pontos: ":" nao e permitido em nome de arquivo no Windows. */
const dataArquivo = valor => new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit"
}).format(new Date(valor)).replace(/\//g, "-").replace(",", "").replace(":", "h");

function linhasTabela(linhas) {
  if (!linhas?.length) return "<tr><td colspan=\"3\" class=\"empty-row\">Sem movimento neste caixa.</td></tr>";
  return linhas.map(linha => `
    <tr>
      <td>${escapar(linha.rotulo)}</td>
      <td class="num">${Number(linha.pedidos || 0)}</td>
      <td class="num money">${moeda(linha.faturamento)}</td>
    </tr>
  `).join("");
}

function linhasNaoPagos(linhas) {
  if (!linhas?.length) return "<tr><td colspan=\"3\" class=\"empty-row\">Nenhum pedido não pago neste caixa.</td></tr>";
  return linhas.map(linha => `
    <tr>
      <td>${escapar(linha.cliente)}</td>
      <td class="num money">${moeda(linha.total)}</td>
      <td>${escapar(linha.motivo || "-")}</td>
    </tr>
  `).join("");
}

function linhasCortesias(linhas) {
  if (!linhas?.length) return "<tr><td colspan=\"3\" class=\"empty-row\">Nenhuma cortesia neste caixa.</td></tr>";
  return linhas.map(linha => `
    <tr>
      <td>${escapar(linha.cliente)}</td>
      <td class="num money">${moeda(linha.valor)}</td>
      <td>${escapar(linha.motivo || "-")}</td>
    </tr>
  `).join("");
}

function linhasMotoboy(linhas) {
  if (!linhas?.length) return "<tr><td colspan=\"4\" class=\"empty-row\">Sem entrega com motoboy neste caixa.</td></tr>";
  return linhas.map(linha => `
    <tr>
      <td>${escapar(linha.rotulo)}</td>
      <td class="num">${Number(linha.pedidos || 0)}</td>
      <td class="num money">${moeda(linha.taxasEntrega)}</td>
      <td class="num money">${moeda(linha.faturamento)}</td>
    </tr>
  `).join("");
}

function htmlRelatorio(caixa) {
  const periodo = `${dataHora(caixa.abertoEm)} até ${dataHora(caixa.fechadoEm)}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Fechamento de caixa - Baixo K - ${dataArquivo(caixa.fechadoEm)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    :root {
      --bg: #f4eee5;
      --paper: #fffaf3;
      --ink: #1b1510;
      --muted: #6b5d50;
      --line: #e5d5c3;
      --copper: #c97443;
      --gold: #e0a66d;
      --green: #66784e;
      --danger: #b75f54;
      --dark: #17120e;
    }
    body {
      margin: 0;
      padding: 22px;
      color: var(--ink);
      background: var(--bg);
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      max-width: 1120px;
      margin: 0 auto;
      overflow: hidden;
      border-radius: 24px;
      background: var(--paper);
      border: 1px solid var(--line);
      box-shadow: 0 22px 70px rgba(55,35,21,.16);
    }
    .print-btn {
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 10;
      min-height: 42px;
      padding: 0 18px;
      border: 0;
      border-radius: 999px;
      color: #1b120c;
      background: linear-gradient(135deg, #f2c17d, #c97443);
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 12px 30px rgba(201,116,67,.25);
    }
    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 22px;
      padding: 26px 30px;
      color: #fff6e8;
      background:
        radial-gradient(circle at 85% 0%, rgba(224,166,109,.26), transparent 28%),
        linear-gradient(135deg, #120e0b, #2c1d14);
    }
    .brand { display: flex; gap: 16px; align-items: center; }
    .brand img {
      width: 74px;
      height: 74px;
      object-fit: cover;
      border-radius: 18px;
      border: 1px solid rgba(224,166,109,.45);
      background: #100d0a;
    }
    h1 { margin: 0; font-size: 29px; line-height: 1.05; }
    .subtitle { margin: 6px 0 0; color: #d8c7b7; font-size: 13px; }
    .tag {
      align-self: start;
      min-width: 170px;
      padding: 12px 14px;
      border-radius: 16px;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.14);
      text-align: right;
    }
    .tag span { display: block; color: #d8c7b7; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .tag strong { display: block; margin-top: 3px; color: var(--gold); font-size: 15px; }
    .meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      padding: 16px 30px;
      background: #211811;
      color: #f7eadb;
      border-top: 1px solid rgba(255,255,255,.08);
    }
    .meta div { display: grid; gap: 4px; min-width: 0; }
    .meta span, .metric span, .section-title span { color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .meta strong { color: #fffaf3; font-size: 12px; overflow-wrap: anywhere; }
    main { padding: 24px 30px 28px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
    .metric {
      min-height: 96px;
      padding: 15px 16px;
      border-radius: 18px;
      background: #fff6eb;
      border: 1px solid var(--line);
    }
    .metric strong { display: block; margin-top: 9px; font-size: 24px; line-height: 1.05; }
    .metric.money strong { color: var(--copper); }
    .metric.green strong { color: var(--green); }
    .metric.danger strong { color: var(--danger); }
    .tables { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .table-card {
      overflow: hidden;
      border-radius: 18px;
      background: #fffdf8;
      border: 1px solid var(--line);
    }
    .table-card.full { grid-column: 1 / -1; }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      background: #2a1c13;
      color: #fff4e5;
    }
    .section-title h2 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: .04em; }
    .section-title span { color: var(--gold); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 11px 14px; text-align: left; border-bottom: 1px solid #efe2d3; font-size: 12px; }
    th { color: var(--muted); background: #fff6eb; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
    tbody tr:nth-child(even) td { background: #fff8ef; }
    tbody tr:last-child td { border-bottom: 0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .money { font-weight: 800; color: var(--copper); }
    .empty-row { color: var(--muted); text-align: center; padding: 18px; }
    .obs {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 16px;
      background: #fff6eb;
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .guide {
      margin-bottom: 20px;
      padding: 14px 16px;
      border-radius: 16px;
      background: #fff6eb;
      border: 1px dashed var(--line);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .guide strong { color: var(--ink); }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 30px 20px;
      color: #7b6b5c;
      border-top: 1px solid var(--line);
      font-size: 11px;
    }
    footer a { color: var(--copper); font-weight: 800; text-decoration: none; }
    @media print {
      body { padding: 0; background: #fff; }
      .sheet { max-width: none; border: 0; border-radius: 0; box-shadow: none; }
      .print-btn { display: none; }
      header { padding: 20px 22px; }
      main { padding: 18px 22px; }
      footer { padding: 12px 22px; }
      .metric { break-inside: avoid; }
      .table-card { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <button class="print-btn" type="button">Imprimir ou salvar PDF</button>
  <script src="/relatorio-caixa.js"></script>
  <div class="sheet">
    <header>
      <div class="brand">
        <img src="/images/baixok-logo-v2.png" alt="Baixo K">
        <div>
          <h1>Fechamento de caixa</h1>
          <p class="subtitle">Baixo K | Relatório gerencial do movimento</p>
        </div>
      </div>
      <div class="tag">
        <span>Total faturado</span>
        <strong>${moeda(caixa.faturamento)}</strong>
      </div>
    </header>

    <section class="meta">
      <div><span>Caixa</span><strong>${escapar(caixa.id)}</strong></div>
      <div><span>Período</span><strong>${periodo}</strong></div>
      <div><span>Responsável</span><strong>${escapar(caixa.fechadoPorNome || caixa.abertoPorNome || "-")}</strong></div>
    </section>

    <main>
      <p class="guide">
        <strong>Como ler este relatório:</strong> "Faturamento" é só o dinheiro que realmente entrou no período.
        Pedidos <strong>cancelados</strong>, <strong>não pagos</strong> e <strong>cortesias</strong> ficam de fora dessa
        conta — cancelado é o que nunca chegou a sair da loja; não pago é quando o produto saiu mas o cliente não pagou
        (cartão recusado, cliente sumiu etc.); cortesia é quando a própria casa decidiu não cobrar, de propósito.
        A lista de cada um, com o motivo, está nas tabelas mais abaixo.
      </p>
      <section class="grid">
        <div class="metric green"><span>Total pedidos</span><strong>${caixa.pedidos}</strong></div>
        <div class="metric money"><span>Faturamento</span><strong>${moeda(caixa.faturamento)}</strong></div>
        <div class="metric money"><span>Ticket médio</span><strong>${moeda(caixa.ticketMedio)}</strong></div>
        <div class="metric danger"><span>Cancelados</span><strong>${caixa.cancelados}</strong></div>
        <div class="metric danger"><span>Não pagos</span><strong>${caixa.calotes || 0}</strong></div>
        <div class="metric"><span>Cortesias</span><strong>${caixa.cortesias || 0}</strong></div>
        <div class="metric"><span>Entregas</span><strong>${caixa.entregas}</strong></div>
        <div class="metric"><span>Retiradas</span><strong>${caixa.retiradas}</strong></div>
        <div class="metric"><span>Mesas</span><strong>${caixa.mesas}</strong></div>
        <div class="metric money"><span>Taxas de entrega</span><strong>${moeda(caixa.taxasEntrega)}</strong></div>
      </section>

      <section class="tables">
        <div class="table-card">
          <div class="section-title"><h2>Formas de pagamento</h2><span>${caixa.pedidos} pedidos</span></div>
          <table><thead><tr><th>Forma</th><th class="num">Pedidos</th><th class="num">Total</th></tr></thead><tbody>${linhasTabela(caixa.pagamentos)}</tbody></table>
        </div>

        <div class="table-card">
          <div class="section-title"><h2>Canais de venda</h2><span>${moeda(caixa.faturamento)}</span></div>
          <table><thead><tr><th>Canal</th><th class="num">Pedidos</th><th class="num">Total</th></tr></thead><tbody>${linhasTabela(caixa.canais)}</tbody></table>
        </div>

        <div class="table-card full">
          <div class="section-title"><h2>Retirada, entrega e mesa</h2><span>operação</span></div>
          <table><thead><tr><th>Tipo</th><th class="num">Pedidos</th><th class="num">Total</th></tr></thead><tbody>${linhasTabela(caixa.modalidades)}</tbody></table>
        </div>

        <div class="table-card full">
          <div class="section-title"><h2>Entregas por motoboy</h2><span>repasse</span></div>
          <table><thead><tr><th>Motoboy</th><th class="num">Entregas</th><th class="num">Taxas</th><th class="num">Total vendido</th></tr></thead><tbody>${linhasMotoboy(caixa.motoboys)}</tbody></table>
        </div>

        <div class="table-card full">
          <div class="section-title"><h2>Pedidos não pagos</h2><span>prejuízo · ${moeda(caixa.valorCalote)}</span></div>
          <table><thead><tr><th>Cliente</th><th class="num">Valor</th><th>Motivo</th></tr></thead><tbody>${linhasNaoPagos(caixa.naoPagosLista)}</tbody></table>
        </div>

        <div class="table-card full">
          <div class="section-title"><h2>Cortesias</h2><span>${moeda(caixa.valorCortesia)}</span></div>
          <table><thead><tr><th>Cliente</th><th class="num">Valor</th><th>Motivo</th></tr></thead><tbody>${linhasCortesias(caixa.cortesiasLista)}</tbody></table>
        </div>
      </section>

      ${caixa.observacao ? `<section class="obs"><strong>Observação do fechamento:</strong> ${escapar(caixa.observacao)}</section>` : ""}
    </main>

    <footer>
      <span>Aberto por ${escapar(caixa.abertoPorNome || "-")} | Fechado por ${escapar(caixa.fechadoPorNome || "-")}</span>
      <span>Desenvolvido pela <a href="https://portfolio-nexo.netlify.app/">Nexo Developer</a></span>
    </footer>
  </div>
</body>
</html>`;
}

/* Exportado so pra teste (tests/csp-html.test.js): garante que o HTML deste
 * relatorio nunca reintroduza atributo de evento inline (onclick= e afins),
 * que o CSP do servidor bloqueia sem avisar ninguem — ja aconteceu de verdade
 * no botao de imprimir. */
export { htmlRelatorio };

export const caixaService = {
  atual: () => caixaRepo.atual(),
  listar: filtros => caixaRepo.listar(filtros),

  async buscar(id) {
    const caixa = await caixaRepo.buscar(id);
    if (!caixa) throw naoEncontrado("Fechamento de caixa não encontrado.");
    return caixa;
  },

  async abrir({ usuario, ip }, { senha } = {}) {
    const aberto = await caixaRepo.atual();
    if (aberto) throw conflito("Já existe um caixa aberto.");
    await authService.confirmarSenha({ usuarioAtual: usuario, senha });

    const caixa = await caixaRepo.abrir({ id: uid("cx"), usuario });
    await auditoriaRepo.registrar({
      usuarioId: usuario.id,
      usuario: usuario.usuario,
      acao: "caixa_aberto",
      entidade: "caixa",
      entidadeId: caixa.id,
      detalhes: { abertoEm: caixa.abertoEm },
      ip
    });
    publicar("caixa", [CANAL.OPERACAO, CANAL.PUBLICO]);
    return caixa;
  },

  async fechar({ usuario, ip }, { observacao = "" } = {}) {
    const aberto = await caixaRepo.atual();
    if (!aberto) throw naoEncontrado("Não existe caixa aberto para fechar.");

    const [pedidosAbertos, mesas] = await Promise.all([
      pedidosRepo.listarAbertos(),
      mesasRepo.listar()
    ]);
    if (pedidosAbertos.length) {
      throw conflito(`Finalize ou cancele ${pedidosAbertos.length} pedido(s) aberto(s) antes de fechar o caixa.`);
    }

    const mesasAbertas = mesas.filter(mesa => mesa.status !== "livre");
    if (mesasAbertas.length) {
      throw conflito(`Feche e libere ${mesasAbertas.length} mesa(s) antes de fechar o caixa.`);
    }

    const resumo = await resumoFechamento(aberto);
    const caixa = await caixaRepo.fechar(aberto.id, resumo, {
      usuario,
      observacao: String(observacao || "").trim().slice(0, 500)
    });

    await auditoriaRepo.registrar({
      usuarioId: usuario.id,
      usuario: usuario.usuario,
      acao: "caixa_fechado",
      entidade: "caixa",
      entidadeId: caixa.id,
      detalhes: { pedidos: caixa.pedidos, faturamento: caixa.faturamento, cancelados: caixa.cancelados },
      ip
    });
    publicar("caixa", [CANAL.OPERACAO, CANAL.PUBLICO]);
    return caixa;
  },

  async relatorioHtml(id) {
    const caixa = await this.buscar(id);
    if (caixa.status !== "fechado") throw conflito("Feche o caixa antes de gerar o relatório.");

    /* Recalcula os nao-pagos na hora de abrir o relatorio (ver comentario em
     * calcularNaoPagos) — o resto do fechamento continua sendo a foto de
     * quando o caixa fechou. "pedidos" e reconstituido pra bater: paga a
     * parte que ja estava paga (congelada) mais os nao-pagos de agora. */
    const naoPago = await calcularNaoPagos(paraSql(new Date(caixa.abertoEm)), paraSql(new Date(caixa.fechadoEm)));
    const cortesia = await calcularCortesias(paraSql(new Date(caixa.abertoEm)), paraSql(new Date(caixa.fechadoEm)));
    const pedidosPagos = caixa.pedidos - caixa.calotes;

    return htmlRelatorio({
      ...caixa,
      pedidos: pedidosPagos + naoPago.calotes,
      calotes: naoPago.calotes,
      valorCalote: naoPago.valorCalote,
      naoPagosLista: naoPago.naoPagosLista,
      cortesias: cortesia.cortesias,
      valorCortesia: cortesia.valorCortesia,
      cortesiasLista: cortesia.cortesiasLista
    });
  },

  async remover(id, { senha } = {}, { usuario, ip }) {
    await authService.confirmarSenha({ usuarioAtual: usuario, senha });

    const caixa = await this.buscar(id);
    if (caixa.status === "aberto") throw conflito("Feche o caixa antes de apagar o registro.");

    const removido = await caixaRepo.remover(id);
    if (!removido) throw naoEncontrado("Fechamento de caixa não encontrado.");

    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "fechamento_excluido",
      entidade: "caixa", entidadeId: id,
      detalhes: { faturamento: caixa.faturamento, pedidos: caixa.pedidos, fechadoEm: caixa.fechadoEm },
      ip
    });
  }
};
