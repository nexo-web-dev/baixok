import { pedidosRepo } from "../repositories/pedidos.repo.js";
import { caixaRepo } from "../repositories/caixa.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { uid } from "../lib/ids.js";
import { naoEncontrado, conflito } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";

const paraSql = data => data.toISOString().replace("T", " ").slice(0, 19);
const arredondar = valor => Math.round(Number(valor || 0) * 100) / 100;

const rotuloCanal = {
  cardapio: "Cardapio",
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

async function resumoFechamento(caixa, fechadoEm = new Date()) {
  const filtro = { desde: paraSql(new Date(caixa.abertoEm)), ate: paraSql(fechadoEm) };
  const [resumo, cancelados, pagamentos, canais, modalidades] = await Promise.all([
    pedidosRepo.resumoPeriodo(filtro),
    pedidosRepo.resumoCancelados(filtro),
    pedidosRepo.agruparPor("pagamento", filtro),
    pedidosRepo.agruparPor("canal", filtro),
    pedidosRepo.agruparPor("modalidade", filtro)
  ]);
  const contagem = contarModalidades(modalidades);

  return {
    fechadoEm: fechadoEm.toISOString(),
    pedidos: Number(resumo.pedidos || 0),
    faturamento: arredondar(resumo.faturamento),
    descontos: arredondar(resumo.descontos),
    taxasEntrega: arredondar(resumo.taxas_entrega),
    ticketMedio: arredondar(resumo.ticket_medio),
    cancelados: Number(cancelados?.pedidos || 0),
    valorCancelado: arredondar(cancelados?.valor),
    entregas: contagem.entregas,
    retiradas: contagem.retiradas,
    mesas: contagem.mesas,
    pagamentos: pagamentos.map(linha => ({
      rotulo: linha.rotulo || "Nao informado",
      pedidos: linha.pedidos,
      faturamento: arredondar(linha.faturamento)
    })),
    canais: canais.map(linha => ({
      rotulo: rotuloCanal[linha.rotulo] || linha.rotulo || "Nao informado",
      pedidos: linha.pedidos,
      faturamento: arredondar(linha.faturamento)
    })),
    modalidades: modalidades.map(linha => ({
      rotulo: rotuloModalidade[linha.rotulo] || linha.rotulo || "Nao informado",
      pedidos: linha.pedidos,
      faturamento: arredondar(linha.faturamento)
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

function linhasTabela(linhas) {
  if (!linhas?.length) return "<tr><td colspan=\"3\">Sem movimento.</td></tr>";
  return linhas.map(linha => `
    <tr>
      <td>${escapar(linha.rotulo)}</td>
      <td>${Number(linha.pedidos || 0)}</td>
      <td>${moeda(linha.faturamento)}</td>
    </tr>
  `).join("");
}

function htmlRelatorio(caixa) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Fechamento de caixa - Baixo K</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #16120f; font-family: Arial, sans-serif; }
    header { border-bottom: 3px solid #16120f; padding-bottom: 12px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 26px; letter-spacing: .02em; }
    h2 { margin: 22px 0 8px; font-size: 15px; text-transform: uppercase; }
    p { margin: 4px 0; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
    .metric { border: 1px solid #222; padding: 10px; min-height: 72px; }
    .metric span { display: block; font-size: 11px; text-transform: uppercase; color: #555; }
    .metric strong { display: block; margin-top: 7px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #222; padding: 8px; text-align: left; font-size: 12px; }
    th { background: #eee; text-transform: uppercase; font-size: 11px; }
    footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #888; color: #555; font-size: 11px; text-align: center; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <button onclick="window.print()">Imprimir ou salvar PDF</button>
  <header>
    <h1>Baixo K - Fechamento de caixa</h1>
    <p><strong>Caixa:</strong> ${escapar(caixa.id)}</p>
    <p><strong>Aberto:</strong> ${dataHora(caixa.abertoEm)} por ${escapar(caixa.abertoPorNome || "-")}</p>
    <p><strong>Fechado:</strong> ${dataHora(caixa.fechadoEm)} por ${escapar(caixa.fechadoPorNome || "-")}</p>
  </header>

  <section class="grid">
    <div class="metric"><span>Pedidos</span><strong>${caixa.pedidos}</strong></div>
    <div class="metric"><span>Faturamento</span><strong>${moeda(caixa.faturamento)}</strong></div>
    <div class="metric"><span>Ticket medio</span><strong>${moeda(caixa.ticketMedio)}</strong></div>
    <div class="metric"><span>Cancelados</span><strong>${caixa.cancelados}</strong></div>
    <div class="metric"><span>Entrega</span><strong>${caixa.entregas}</strong></div>
    <div class="metric"><span>Retirada</span><strong>${caixa.retiradas}</strong></div>
    <div class="metric"><span>Mesa</span><strong>${caixa.mesas}</strong></div>
    <div class="metric"><span>Taxas entrega</span><strong>${moeda(caixa.taxasEntrega)}</strong></div>
  </section>

  <h2>Formas de pagamento</h2>
  <table><thead><tr><th>Forma</th><th>Pedidos</th><th>Total</th></tr></thead><tbody>${linhasTabela(caixa.pagamentos)}</tbody></table>

  <h2>Canais de venda</h2>
  <table><thead><tr><th>Canal</th><th>Pedidos</th><th>Total</th></tr></thead><tbody>${linhasTabela(caixa.canais)}</tbody></table>

  <h2>Modalidades</h2>
  <table><thead><tr><th>Tipo</th><th>Pedidos</th><th>Total</th></tr></thead><tbody>${linhasTabela(caixa.modalidades)}</tbody></table>

  ${caixa.observacao ? `<h2>Observacao</h2><p>${escapar(caixa.observacao)}</p>` : ""}
  <footer>Desenvolvido pela Nexo Developer</footer>
</body>
</html>`;
}

export const caixaService = {
  atual: () => caixaRepo.atual(),
  listar: filtros => caixaRepo.listar(filtros),

  async buscar(id) {
    const caixa = await caixaRepo.buscar(id);
    if (!caixa) throw naoEncontrado("Fechamento de caixa nao encontrado.");
    return caixa;
  },

  async abrir({ usuario, ip }) {
    const aberto = await caixaRepo.atual();
    if (aberto) throw conflito("Ja existe um caixa aberto.");

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
    publicar("caixa", [CANAL.OPERACAO]);
    return caixa;
  },

  async fechar({ usuario, ip }, { observacao = "" } = {}) {
    const aberto = await caixaRepo.atual();
    if (!aberto) throw naoEncontrado("Nao existe caixa aberto para fechar.");

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
    publicar("caixa", [CANAL.OPERACAO]);
    return caixa;
  },

  async relatorioHtml(id) {
    const caixa = await this.buscar(id);
    if (caixa.status !== "fechado") throw conflito("Feche o caixa antes de gerar o relatorio.");
    return htmlRelatorio(caixa);
  }
};
