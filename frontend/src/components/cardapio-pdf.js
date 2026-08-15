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
import QRCode from "qrcode";
import { el } from "../utils/dom.js";
import { reais } from "../utils/formato.js";
import { rotuloCategoria } from "../utils/categorias.js";

/* Mesma paleta do sistema (tokens.css) — o cardapio impresso usa as mesmas
 * cores da tela, nao um tema claro a parte so porque e pra imprimir. */
const BG = "#100e0c";
const PANEL = "#1e1913";
const SOFT = "#241d15";
const INK = "#f3ece3";
const MUTED = "#a99e8f";
const FAINT = "#6f665b";
const COPPER = "#c97443";
const GOLD = "#d99a68";
const GOLD_LIGHT = "#e8b184";
const ON_ACCENT = "#1a120c";
const LINE = "rgba(255,255,255,.08)";

const css = `
  @page { size: A4; margin: 10mm 12mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  body {
    margin: 0; background: ${BG}; color: ${INK};
    font-family: 'Figtree', Arial, sans-serif; font-size: 12px; line-height: 1.4;
  }
  .cover {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 22px 0 20px; margin-bottom: 16px; overflow: hidden;
    background:
      radial-gradient(circle at 50% 0%, rgba(201,116,67,.35), transparent 60%),
      linear-gradient(180deg, ${SOFT}, ${BG});
    border-bottom: 3px solid ${COPPER};
    text-align: center; break-after: avoid;
  }
  .cover img {
    position: relative; width: 88px; height: 88px; border-radius: 50%; object-fit: cover;
    border: 3px solid ${GOLD}; box-shadow: 0 0 0 6px rgba(217,154,104,.14);
  }
  .cover h1 {
    position: relative; margin: 8px 0 0; font-family: 'Bricolage Grotesque', Georgia, serif; font-weight: 800;
    font-size: 42px; letter-spacing: .01em; color: ${INK};
    text-shadow: 0 2px 18px rgba(201,116,67,.45);
  }
  .cover p {
    position: relative; margin: 2px 0 0; padding: 4px 16px; border-radius: 999px;
    background: rgba(217,154,104,.14); color: ${GOLD_LIGHT};
    font-size: 11px; text-transform: uppercase; letter-spacing: .12em; font-weight: 800;
  }
  .category { margin: 0 0 18px; break-inside: avoid-column; }
  .category h2 {
    display: flex; align-items: center; gap: 10px;
    margin: 0 0 10px; padding: 6px 12px; border-radius: 8px;
    background: linear-gradient(90deg, rgba(201,116,67,.22), transparent);
    border-left: 4px solid ${COPPER};
    font-family: 'Bricolage Grotesque', Georgia, serif;
    font-size: 16px; font-weight: 800; color: ${GOLD_LIGHT}; text-transform: uppercase; letter-spacing: .06em;
    break-after: avoid;
  }
  .grid { columns: 2; column-gap: 14px; }
  .item {
    display: grid; grid-template-columns: 48px 1fr; gap: 10px; align-items: start;
    margin: 0 0 10px; padding: 9px; border-radius: 10px;
    background: ${PANEL}; border: 1px solid ${LINE}; break-inside: avoid;
  }
  .item img, .item .no-photo {
    width: 48px; height: 48px; border-radius: 8px; object-fit: cover;
    background: ${SOFT}; border: 1px solid rgba(217,154,104,.35);
  }
  .item .no-photo { display: grid; place-items: center; font-size: 8px; color: ${FAINT}; text-align: center; }
  .item-body { min-width: 0; }
  .item-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .item-top strong { font-size: 12.5px; font-weight: 800; color: ${INK}; }
  .item-top span {
    flex: none; padding: 2px 8px; border-radius: 999px; background: ${GOLD};
    font-weight: 800; color: ${ON_ACCENT}; font-size: 11.5px; white-space: nowrap;
  }
  .item-body p { margin: 3px 0 0; color: ${MUTED}; font-size: 10px; line-height: 1.35; }
  .footer {
    margin-top: 6px; padding: 16px 18px; border-radius: 14px;
    background: linear-gradient(90deg, rgba(201,116,67,.22), rgba(217,154,104,.08));
    border: 1px solid rgba(217,154,104,.3);
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    break-inside: avoid;
  }
  .footer-text strong { display: block; font-size: 14px; color: ${INK}; }
  .footer-text span { display: block; margin-top: 3px; color: ${GOLD_LIGHT}; font-size: 11px; font-weight: 700; }
  .footer .qr-card { padding: 8px; border-radius: 10px; background: #ffffff; line-height: 0; }
  .footer .qr-card img { display: block; width: 62px; height: 62px; }
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
    qrDataUrl ? el("div.qr-card", {}, el("img", { src: qrDataUrl, alt: "QR do cardápio" })) : null
  ));

  return partes;
}

/* QR e opcional: sem endereco configurado, ou se a geracao falhar por
 * qualquer motivo, o cardapio sai sem ele — nunca trava a exportacao. */
async function gerarQrOpcional(menuUrl) {
  if (!menuUrl) return null;
  try {
    return await QRCode.toDataURL(menuUrl, {
      errorCorrectionLevel: "M", margin: 1, width: 240,
      color: { dark: ON_ACCENT, light: "#ffffff" }
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
