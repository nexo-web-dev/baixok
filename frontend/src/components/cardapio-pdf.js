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
  @page { size: A4; margin: 8mm 10mm; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  body {
    margin: 0; background: ${BG}; color: ${INK};
    font-family: 'Figtree', Arial, sans-serif; font-size: 11px; line-height: 1.3;
  }
  /* Escala aplicada em JS (auto-fit.js) depois de medir a altura real —
   * transform-origin no topo pra encolher "de cima pra baixo" sem descentrar. */
  #folha { transform-origin: top left; }
  .cover {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px;
    padding: 14px 0 12px; margin-bottom: 10px; overflow: hidden;
    background:
      radial-gradient(circle at 50% 0%, rgba(201,116,67,.35), transparent 60%),
      linear-gradient(180deg, ${SOFT}, ${BG});
    border-bottom: 3px solid ${COPPER};
    text-align: center; break-after: avoid;
  }
  .cover img {
    position: relative; width: 56px; height: 56px; border-radius: 50%; object-fit: cover;
    border: 2px solid ${GOLD}; box-shadow: 0 0 0 4px rgba(217,154,104,.14);
  }
  .cover h1 {
    position: relative; margin: 6px 0 0; font-family: 'Bricolage Grotesque', Georgia, serif; font-weight: 800;
    font-size: 26px; letter-spacing: .01em; color: ${INK};
    text-shadow: 0 2px 18px rgba(201,116,67,.45);
  }
  .cover p {
    position: relative; margin: 2px 0 0; padding: 3px 12px; border-radius: 999px;
    background: rgba(217,154,104,.14); color: ${GOLD_LIGHT};
    font-size: 9px; text-transform: uppercase; letter-spacing: .1em; font-weight: 800;
  }
  .category { margin: 0 0 9px; break-inside: avoid-column; }
  .category h2 {
    display: flex; align-items: center; margin: 0 0 6px; break-after: avoid;
  }
  .cat-icon {
    flex: none; z-index: 1; display: grid; place-items: center;
    width: 19px; height: 19px; margin-right: -9px; border-radius: 50%;
    background: ${BG}; border: 1.5px solid ${GOLD}; font-size: 10px; line-height: 1;
  }
  .cat-label {
    flex: 1; min-width: 0; padding: 4px 10px 4px 17px; border-radius: 999px;
    background: linear-gradient(90deg, ${COPPER}, rgba(201,116,67,.55));
    font-family: 'Bricolage Grotesque', Georgia, serif;
    font-size: 11px; font-weight: 800; color: #fff6ea; text-transform: uppercase; letter-spacing: .06em;
  }
  /* 3 colunas, sem descricao: e o que faz o cardapio inteiro caber numa
   * pagina — descricao era o maior consumo de altura de cada item. */
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px 9px; }
  .item {
    display: grid; grid-template-columns: 26px 1fr; gap: 6px; align-items: center;
    min-width: 0; padding: 4px 6px; border-radius: 6px;
    background: ${PANEL}; border: 1px solid ${LINE}; break-inside: avoid;
  }
  .item img, .item .no-photo {
    width: 26px; height: 26px; border-radius: 5px; object-fit: cover;
    background: ${SOFT}; border: 1px solid rgba(217,154,104,.35);
  }
  .item .no-photo { display: grid; place-items: center; font-size: 5px; color: ${FAINT}; text-align: center; }
  /* Nome ...linha pontilhada... preco — o classico de cardapio impresso, feito
   * so com um span flexivel de borda pontilhada entre os dois. */
  .item-body { min-width: 0; display: flex; align-items: baseline; gap: 4px; }
  .item-body strong {
    flex: none; max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 9px; font-weight: 700; color: ${INK};
  }
  .item-body .dots { flex: 1; min-width: 4px; margin-bottom: 2px; border-bottom: 1px dotted ${FAINT}; }
  .item-body em { flex: none; font-weight: 800; color: ${GOLD}; font-size: 9px; font-style: normal; white-space: nowrap; }
  .footer {
    margin-top: 4px; padding: 10px 12px; border-radius: 10px;
    background: linear-gradient(90deg, rgba(201,116,67,.22), rgba(217,154,104,.08));
    border: 1px solid rgba(217,154,104,.3);
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    break-inside: avoid;
  }
  .footer-text strong { display: block; font-size: 10.5px; color: ${INK}; }
  .footer-text span { display: block; margin-top: 2px; color: ${GOLD_LIGHT}; font-size: 8.5px; font-weight: 700; }
  .footer .qr-card { padding: 5px; border-radius: 8px; background: #ffffff; line-height: 0; }
  .footer .qr-card img { display: block; width: 44px; height: 44px; }
  /* Faixa de contato — so aparece se endereco e/ou whatsapp estiverem
   * preenchidos em Ajustes; sem os dois, nao ha o que mostrar aqui. */
  .contact-bar {
    margin-top: 6px; border-radius: 10px; overflow: hidden;
    background: ${BG}; border: 1px solid rgba(217,154,104,.28);
    display: flex; break-inside: avoid;
  }
  .contact-col {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
    padding: 8px 10px; border-left: 1px solid rgba(217,154,104,.2);
  }
  .contact-col:first-child { border-left: 0; }
  .contact-col i { flex: none; font-size: 14px; font-style: normal; }
  .contact-col div { min-width: 0; }
  .contact-col strong {
    display: block; font-size: 7.5px; font-weight: 800; color: ${GOLD};
    text-transform: uppercase; letter-spacing: .04em;
  }
  .contact-col span {
    display: block; margin-top: 1px; font-size: 8.5px; font-weight: 700; color: ${INK};
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
`;

function fotoItem(produto) {
  if (!produto.image) return el("div.no-photo", {}, "Sem foto");
  return el("img", { src: produto.image, alt: "" });
}

function linhaItem(produto) {
  return el("article.item", { title: produto.description || produto.name },
    fotoItem(produto),
    el("div.item-body", {},
      el("strong", {}, produto.name),
      el("span.dots", {}),
      el("em", {}, reais(produto.price))
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

/* Sem arte propria pro cardapio impresso, o emoji por categoria substitui os
 * icones desenhados a mao — casa com a paleta do sistema sem depender de
 * nenhum arquivo externo. Por trecho do nome (nao igualdade exata): categoria
 * no catalogo e texto livre, ver categorias.js. */
function iconeCategoria(categoria) {
  const nome = String(categoria || "").toLowerCase();
  if (nome.includes("pizza")) return "🍕";
  if (nome.includes("burg")) return "🍔";
  if (nome.includes("mass")) return "🍝";
  if (nome.includes("porç") || nome.includes("porc") || nome.includes("batata")) return "🍟";
  if (nome.includes("drink") || nome.includes("bebid") || nome.includes("suco") || nome.includes("refri")) return "🥤";
  if (nome.includes("combo")) return "🎉";
  if (nome.includes("sobrem") || nome.includes("doce")) return "🍰";
  return "🍽️";
}

function secaoCategoria(categoria, itens) {
  return el("section.category", {},
    el("h2", {},
      el("span.cat-icon", {}, iconeCategoria(categoria)),
      el("span.cat-label", {}, rotuloCategoria(categoria))
    ),
    el("div.grid", {}, ...itens.map(linhaItem))
  );
}

function faixaContato(ajustes) {
  const endereco = String(ajustes?.endereco_loja || "").trim();
  const whatsapp = String(ajustes?.whatsapp_entrega || "").trim();
  if (!endereco && !whatsapp) return null;

  return el("div.contact-bar", {},
    el("div.contact-col", {},
      el("i", {}, "🛵"),
      el("div", {}, el("strong", {}, "Bateu aquela fome?"), el("span", {}, "Peça agora!"))
    ),
    endereco
      ? el("div.contact-col", {},
          el("i", {}, "📍"),
          el("div", {}, el("strong", {}, "Nosso endereço"), el("span", {}, endereco))
        )
      : null,
    whatsapp
      ? el("div.contact-col", {},
          el("i", {}, "💬"),
          el("div", {}, el("strong", {}, "Peça pelo"), el("span", {}, `WhatsApp ${whatsapp}`))
        )
      : null
  );
}

function montarCorpo({ produtos, ajustes, qrDataUrl, menuUrl }) {
  const ativos = produtos.filter(produto => produto.active);
  const grupos = agruparPorCategoria(ativos);
  const nomeLoja = ajustes?.nome_loja || "Baixo K";
  const rodapeUrl = menuUrl ? menuUrl.replace(/^https?:\/\//, "") : "";

  const secoes = grupos.size
    ? [...grupos.entries()].map(([categoria, itens]) => secaoCategoria(categoria, itens))
    : [el("p", {}, "Nenhum produto ativo no cardápio.")];

  return el("div#folha", {},
    el("header.cover", {},
      el("img", { src: "/images/baixok-logo-v2.png", alt: "" }),
      el("h1", {}, nomeLoja),
      el("p", {}, "Pizza · Burguers · Massas · Drinks")
    ),
    ...secoes,
    el("footer.footer", {},
      el("div.footer-text", {},
        el("strong", {}, "Peça também pelo nosso cardápio digital"),
        rodapeUrl ? el("span", {}, rodapeUrl) : null
      ),
      qrDataUrl ? el("div.qr-card", {}, el("img", { src: qrDataUrl, alt: "QR do cardápio" })) : null
    ),
    faixaContato(ajustes)
  );
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
  /* Links de fonte sao estaticos (sem dado de produto), entao document.write
   * direto e seguro aqui — o resto do documento (nome, descricao) so entra
   * via el()/importNode, nunca por string. Sem isso a aba nova nao herda o
   * <link> do Google Fonts do admin.html e cai pra Georgia/Arial. */
  doc.open();
  doc.write(
    "<!doctype html><html><head><meta charset='utf-8'><title>Cardápio</title>" +
    "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">" +
    "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>" +
    "<link href=\"https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700;800&family=Figtree:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">" +
    "</head><body></body></html>"
  );
  doc.close();
  doc.title = `${nomeLoja} - Cardápio`;

  const estilo = doc.createElement("style");
  estilo.textContent = css;
  doc.head.append(estilo);

  doc.body.append(doc.importNode(montarCorpo({ produtos, ajustes, qrDataUrl, menuUrl }), true));

  /* Espera a fonte baixar antes de imprimir — sem isso a caixa de impressao
   * as vezes abre a tempo de pegar so a fonte de fallback. Teto de 1.5s pra
   * nunca travar a exportacao numa rede lenta. */
  const fontesProntas = doc.fonts?.ready
    ? Promise.race([doc.fonts.ready, new Promise(resolve => setTimeout(resolve, 1500))])
    : Promise.resolve();

  /* Margem do @page e "8mm 10mm": altura util = 297mm - 2*8mm, em px a 96dpi
   * (e o que o layout na tela ja usa, entao a medida bate com a impressao). */
  const ALTURA_UTIL_PX = (297 - 16) * (96 / 25.4);

  /* Encolhe o cardapio inteiro pra caber numa pagina so, medindo a altura de
   * verdade em vez de chutar por quantidade de produto — funciona igual com
   * 20 ou 200 itens no cardapio. `zoom` (nao-padrao, mas suportado pelos
   * navegadores baseados em Chromium) encolhe fonte, foto e espacamento
   * juntos, mantendo tudo legivel. Teto de 62%: abaixo disso a letra fica
   * pequena demais pra ler, e melhor deixar estourar pra segunda pagina do
   * que entregar um cardapio ilegivel. */
  function ajustarParaUmaPagina() {
    const folha = doc.getElementById("folha");
    if (!folha) return;
    const altura = folha.scrollHeight;
    if (altura <= ALTURA_UTIL_PX) return;
    const escala = Math.max(0.62, ALTURA_UTIL_PX / altura);
    folha.style.zoom = escala;
  }

  janela.addEventListener("load", () => {
    fontesProntas.then(() => {
      ajustarParaUmaPagina();
      janela.focus();
      janela.print();
    });
  });
}
