/* Cardapio para imprimir/exportar em PDF.
 *
 * Sem biblioteca de PDF: abre uma aba nova com uma pagina A4 estilizada e
 * chama print() — quem gera o PDF de verdade e o proprio navegador, no
 * destino "Salvar como PDF" da caixa de impressao. Mesmo caminho que os
 * tickets termicos ja usam (impressao.js), so que numa janela visivel em vez
 * de um iframe escondido: aqui o dono da loja quer olhar o resultado antes de
 * mandar pra grafica ou salvar o arquivo.
 *
 * Os nos vem de `el()` (texto por textContent, nunca HTML) e sao adotados na
 * janela nova com importNode — nome ou descricao de produto nunca vira marcacao
 * interpretada, nem aqui nem em document.write. */
import { el } from "../utils/dom.js";
import { reais } from "../utils/formato.js";
import { rotuloCategoria } from "../utils/categorias.js";

const COPPER = "#c97443";
const GOLD = "#a9662f";
const INK = "#241a10";
const MUTED = "#6b5c4c";
const LINE = "#e6dccb";
const CREAM = "#fbf6ee";

const css = `
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: ${CREAM}; color: ${INK};
    font-family: 'Figtree', Arial, sans-serif; font-size: 12px; line-height: 1.4;
  }
  .cover {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 14px 0 18px; margin-bottom: 10px; border-bottom: 2px solid ${COPPER};
    text-align: center; break-after: avoid;
  }
  .cover img { width: 76px; height: 76px; border-radius: 50%; object-fit: cover; border: 2px solid ${GOLD}; }
  .cover h1 {
    margin: 4px 0 0; font-family: 'Bricolage Grotesque', Georgia, serif; font-weight: 800;
    font-size: 34px; letter-spacing: .01em; color: ${INK};
  }
  .cover p { margin: 0; color: ${MUTED}; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
  .category { margin: 0 0 16px; break-inside: avoid-column; }
  .category h2 {
    display: flex; align-items: center; gap: 10px;
    margin: 0 0 8px; font-family: 'Bricolage Grotesque', Georgia, serif;
    font-size: 17px; font-weight: 800; color: ${GOLD}; text-transform: uppercase; letter-spacing: .04em;
    break-after: avoid;
  }
  .category h2::after { content: ""; flex: 1; height: 1px; background: ${LINE}; }
  .grid { columns: 2; column-gap: 20px; }
  .item {
    display: grid; grid-template-columns: 46px 1fr; gap: 10px; align-items: start;
    padding: 8px 0; border-bottom: 1px dashed ${LINE}; break-inside: avoid;
  }
  .item img, .item .no-photo { width: 46px; height: 46px; border-radius: 8px; object-fit: cover; background: #efe6d6; }
  .item .no-photo { display: grid; place-items: center; font-size: 8px; color: ${MUTED}; text-align: center; }
  .item-body { min-width: 0; }
  .item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .item-top strong { font-size: 12.5px; font-weight: 800; color: ${INK}; }
  .item-top span { flex: none; font-weight: 800; color: ${GOLD}; font-size: 12.5px; white-space: nowrap; }
  .item-body p { margin: 2px 0 0; color: ${MUTED}; font-size: 10.5px; line-height: 1.35; }
  .footer {
    margin-top: 18px; padding-top: 14px; border-top: 2px solid ${COPPER};
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    break-inside: avoid;
  }
  .footer-text strong { display: block; font-size: 13px; color: ${INK}; }
  .footer-text span { display: block; margin-top: 2px; color: ${MUTED}; font-size: 10.5px; }
  .footer img { width: 66px; height: 66px; }
`;

function fotoItem(produto) {
  if (!produto.image) return el("div.no-photo", {}, "Sem foto");
  return el("img", { src: produto.image, alt: "" });
}

function linhaItem(produto) {
  return el("article.item", {},
    fotoItem(produto),
    el("div.item-body", {},
      el("div.item-top", {},
        el("strong", {}, produto.name),
        el("span", {}, reais(produto.price))
      ),
      produto.description ? el("p", {}, produto.description) : null
    )
  );
}

function agruparPorCategoria(produtos) {
  const grupos = new Map();
  for (const produto of produtos) {
    const categoria = String(produto.category || "Sem categoria").trim();
    if (!grupos.has(categoria)) grupos.set(categoria, []);
    grupos.get(categoria).push(produto);
  }
  return grupos;
}

function secaoCategoria(categoria, itens) {
  return el("section.category", {},
    el("h2", {}, rotuloCategoria(categoria)),
    el("div.grid", {}, ...itens.map(linhaItem))
  );
}

function montarCorpo({ produtos, ajustes, qrDataUrl, menuUrl }) {
  const ativos = produtos.filter(produto => produto.active);
  const grupos = agruparPorCategoria(ativos);
  const nomeLoja = ajustes?.nome_loja || "Baixo K";
  const rodapeUrl = menuUrl ? menuUrl.replace(/^https?:\/\//, "") : "";

  const partes = [];
  partes.push(el("header.cover", {},
    el("img", { src: "/images/baixok-logo-v2.png", alt: "" }),
    el("h1", {}, nomeLoja),
    el("p", {}, "Pizza · Burguers · Massas · Drinks")
  ));

  if (grupos.size) {
    for (const [categoria, itens] of grupos) partes.push(secaoCategoria(categoria, itens));
  } else {
    partes.push(el("p", {}, "Nenhum produto ativo no cardápio."));
  }

  partes.push(el("footer.footer", {},
    el("div.footer-text", {},
      el("strong", {}, "Peça também pelo nosso cardápio digital"),
      rodapeUrl ? el("span", {}, rodapeUrl) : null
    ),
    qrDataUrl ? el("img", { src: qrDataUrl, alt: "QR do cardápio" }) : null
  ));

  return partes;
}

/* QR e opcional: sem a lib, ou sem endereco configurado, o cardapio sai sem
 * ele — nunca trava a exportacao por causa disso. */
async function gerarQrOpcional(menuUrl) {
  if (!menuUrl) return null;
  try {
    const { default: QRCode } = await import("qrcode");
    return await QRCode.toDataURL(menuUrl, {
      errorCorrectionLevel: "M", margin: 1, width: 240,
      color: { dark: INK, light: "#ffffff" }
    });
  } catch {
    return null;
  }
}

export async function exportarCardapioPdf(produtos, ajustes) {
  const menuUrl = (ajustes?.menu_url || `${location.origin}/index.html`).trim();
  const qrDataUrl = await gerarQrOpcional(menuUrl);

  const janela = window.open("", "_blank");
  if (!janela) throw new Error("O navegador bloqueou a aba de exportação. Permita pop-ups para este site.");

  const nomeLoja = ajustes?.nome_loja || "Baixo K";
  const doc = janela.document;
  doc.open();
  doc.write("<!doctype html><html><head><meta charset='utf-8'><title>Cardápio</title></head><body></body></html>");
  doc.close();
  doc.title = `${nomeLoja} - Cardápio`;

  const estilo = doc.createElement("style");
  estilo.textContent = css;
  doc.head.append(estilo);

  for (const parte of montarCorpo({ produtos, ajustes, qrDataUrl, menuUrl })) {
    doc.body.append(doc.importNode(parte, true));
  }

  janela.addEventListener("load", () => {
    janela.focus();
    janela.print();
  });
}
