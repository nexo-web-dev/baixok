/* Planilha de vendas em XLSX de verdade — nao CSV.
 *
 * O CSV anterior tinha um bug de acentuacao (o BOM ia como texto mangled em
 * vez do caractere de verdade, entao "Balcão" virava "BalcÃ£o" no Excel) e
 * saia com colunas todas do mesmo tamanho, sem cor nenhuma — dificil de ler
 * com qualquer catalogo maior. Aqui a largura de cada coluna e pensada pro
 * conteudo, o cabecalho usa a cor da casa, e valor sai formatado como
 * dinheiro de verdade (nao texto), pra somar/filtrar direto no Excel. */
import ExcelJS from "exceljs";
import { CANAIS_ROTULO, MODALIDADES_ROTULO, STATUS_ROTULO } from "../utils/categorias.js";

const COPPER = "FFC97443";
const DARK = "FF100E0C";
const GOLD_SOFT = "FFF2DFC9";
const INK = "FF1B1510";
const ZEBRA = "FFFBF5ED";

const MOEDA = '"R$" #,##0.00;[RED]-"R$" #,##0.00';

const COLUNAS = [
  { chave: "id", titulo: "Pedido", largura: 16 },
  { chave: "data", titulo: "Data", largura: 17 },
  { chave: "status", titulo: "Status", largura: 12 },
  { chave: "canal", titulo: "Canal", largura: 11 },
  { chave: "modalidade", titulo: "Modalidade", largura: 12 },
  { chave: "cliente", titulo: "Cliente", largura: 20 },
  { chave: "telefone", titulo: "Telefone", largura: 15 },
  { chave: "endereco", titulo: "Endereço", largura: 28 },
  { chave: "pagamento", titulo: "Pagamento", largura: 13 },
  { chave: "itens", titulo: "Itens", largura: 42 },
  { chave: "subtotal", titulo: "Subtotal", largura: 12, moeda: true },
  { chave: "desconto", titulo: "Desconto", largura: 12, moeda: true },
  { chave: "taxaEntrega", titulo: "Taxa entrega", largura: 12, moeda: true },
  { chave: "total", titulo: "Total", largura: 13, moeda: true },
  { chave: "motoboy", titulo: "Motoboy", largura: 16 },
  { chave: "motivoCancelamento", titulo: "Motivo cancelamento", largura: 26 },
  { chave: "motivoNaoPago", titulo: "Motivo não pago", largura: 26 }
];

function valorLinha(linha, coluna) {
  if (coluna.chave === "status") return STATUS_ROTULO[linha.status] || linha.status;
  if (coluna.chave === "canal") return CANAIS_ROTULO[linha.canal] || linha.canal;
  if (coluna.chave === "modalidade") return MODALIDADES_ROTULO[linha.modalidade] || linha.modalidade;
  return linha[coluna.chave];
}

export async function exportarPlanilhaVendas({ periodo, linhas }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Baixo K";
  workbook.created = new Date();

  const aba = workbook.addWorksheet("Vendas", {
    views: [{ state: "frozen", ySplit: 3 }]
  });
  aba.columns = COLUNAS.map(coluna => ({ key: coluna.chave, width: coluna.largura }));

  /* Titulo mesclado no topo, com a cor da casa — e o que faz a planilha
   * parecer da loja, nao um export generico de sistema. */
  aba.mergeCells(1, 1, 1, COLUNAS.length);
  const tituloCelula = aba.getCell(1, 1);
  tituloCelula.value = `Baixo K — Relatório de vendas — ${periodo?.rotulo || ""}`;
  tituloCelula.font = { bold: true, size: 14, color: { argb: GOLD_SOFT } };
  tituloCelula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
  tituloCelula.alignment = { vertical: "middle", horizontal: "left" };
  aba.getRow(1).height = 26;

  aba.mergeCells(2, 1, 2, COLUNAS.length);
  const subCelula = aba.getCell(2, 1);
  subCelula.value = `Gerado em ${new Date().toLocaleString("pt-BR")} · ${linhas.length} pedido(s)`;
  subCelula.font = { italic: true, size: 9, color: { argb: "FF6F665B" } };
  subCelula.alignment = { vertical: "middle" };
  aba.getRow(2).height = 16;

  const cabecalho = aba.getRow(3);
  COLUNAS.forEach((coluna, indice) => {
    const celula = cabecalho.getCell(indice + 1);
    celula.value = coluna.titulo;
    celula.font = { bold: true, color: { argb: "FFFFF6EA" } };
    celula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COPPER } };
    celula.alignment = { vertical: "middle", horizontal: coluna.moeda ? "right" : "left" };
    celula.border = { bottom: { style: "thin", color: { argb: COPPER } } };
  });
  cabecalho.height = 20;
  aba.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUNAS.length } };

  linhas.forEach((linha, indice) => {
    const linhaExcel = aba.addRow(COLUNAS.map(coluna => valorLinha(linha, coluna)));
    const dataCelula = linhaExcel.getCell(2);
    if (linha.data) {
      dataCelula.value = new Date(linha.data);
      dataCelula.numFmt = "dd/mm/yyyy hh:mm";
    }
    COLUNAS.forEach((coluna, i) => {
      const celula = linhaExcel.getCell(i + 1);
      celula.font = { color: { argb: INK }, size: 10 };
      celula.alignment = { vertical: "middle", horizontal: coluna.moeda ? "right" : "left", wrapText: coluna.chave === "itens" };
      if (coluna.moeda) celula.numFmt = MOEDA;
    });
    if (indice % 2 === 1) {
      linhaExcel.eachCell(celula => {
        celula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      });
    }
  });

  /* Linha de totais no fim — soma o que a casa mais confere: faturamento e
   * descontos do periodo exportado. */
  const indiceItens = COLUNAS.findIndex(coluna => coluna.chave === "itens") + 1;
  const linhaTotais = aba.addRow([]);
  if (indiceItens) {
    const rotuloCelula = linhaTotais.getCell(indiceItens);
    rotuloCelula.value = "Totais do período";
    rotuloCelula.font = { bold: true, color: { argb: INK } };
    rotuloCelula.alignment = { horizontal: "right" };
  }
  ["subtotal", "desconto", "taxaEntrega", "total"].forEach(chave => {
    const indice = COLUNAS.findIndex(coluna => coluna.chave === chave) + 1;
    if (!indice) return;
    const letra = aba.getColumn(indice).letter;
    const soma = linhas.reduce((total, linha) => total + (Number(linha[chave]) || 0), 0);
    const celula = linhaTotais.getCell(indice);
    /* `result` junto da formula: sem ele a celula fica em branco ate o Excel
     * recalcular, o que nao acontece sozinho no Modo de Exibicao Protegida
     * (todo arquivo baixado da internet abre assim por padrao). */
    celula.value = { formula: `SUM(${letra}4:${letra}${3 + linhas.length})`, result: soma };
    celula.numFmt = MOEDA;
    celula.font = { bold: true, color: { argb: INK } };
    celula.alignment = { horizontal: "right" };
  });
  linhaTotais.eachCell(celula => {
    celula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2C48D" } };
    celula.border = { top: { style: "double", color: { argb: COPPER } } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `baixok-${(periodo?.rotulo || "vendas").toLowerCase().replace(/\s+/g, "-")}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
