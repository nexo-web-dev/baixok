/* Impressao termica 80mm (Elgin i8).
 *
 * A nota e montada com DOM dentro do iframe, e nao com document.write de uma
 * string. O original interpolava nome de cliente, endereco e observacao direto
 * na string do recibo — um `<script>` no campo de observacao rodava no momento
 * em que o atendente clicasse em imprimir, dentro da pagina do painel.
 *
 * O CSS abaixo e estatico: nenhum dado do pedido entra nele. */
import { el } from "../utils/dom.js";
import { dinheiro } from "../utils/formato.js";
import { CANAIS_ROTULO, MODALIDADES_ROTULO } from "../utils/categorias.js";
import { estado } from "../pages/admin/store.js";

const LARGURA_PADRAO_MM = 80;
const MARGEM_BOBINA_MM = 12;

const cssRecibo = (cozinha, larguraPapelMm = LARGURA_PADRAO_MM) => `
  @page { size: ${larguraPapelMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    width: ${Math.max(30, larguraPapelMm - MARGEM_BOBINA_MM)}mm; max-width: ${Math.max(30, larguraPapelMm - MARGEM_BOBINA_MM)}mm;
    margin: 0 auto; padding: 2mm 0;
    color: #000; background: #fff; font-family: Arial, sans-serif;
    font-size: ${cozinha ? "16px" : "12px"}; font-weight: 500; overflow-wrap: anywhere;
  }
  h1, h2, p { margin: 0; }
  .brand { text-align: center; padding-bottom: 4px; border-bottom: 1px solid #000; }
  .brand h1 { font-size: ${cozinha ? "22px" : "18px"}; }
  .brand p { margin-top: 1px; font-size: 9px; }
  .ticket-type { margin: 5px 0; padding: 4px 3px; border: 1px solid #000; text-align: center; font-size: ${cozinha ? "21px" : "15px"}; font-weight: 900; }
  .pickup { margin: 5px 0; padding: 5px 3px; color: #fff; background: #000; text-align: center; font-size: ${cozinha ? "22px" : "18px"}; font-weight: 900; }
  .meta, .totals, .obs { padding: 5px 0; border-top: 1px dashed #000; }
  .meta p { display: grid; grid-template-columns: 20mm minmax(0, 1fr); gap: 3mm; padding: 2px 0; align-items: start; }
  .meta strong { text-align: right; overflow-wrap: anywhere; word-break: break-word; }
  .line { display: grid; grid-template-columns: minmax(0, 1fr) 20mm; gap: 3mm; padding: 2px 0; }
  .big-code { display: block; text-align: center; font-size: ${cozinha ? "28px" : "22px"}; font-weight: 900; }
  .customer { margin: 5px 0; padding: 5px 3px; border: 1px solid #000; text-align: center; font-size: ${cozinha ? "20px" : "15px"}; font-weight: 900; overflow-wrap: anywhere; }
  .item { display: grid; grid-template-columns: ${cozinha ? "1fr" : "minmax(0, 1fr) 18mm"}; gap: 3mm; padding: ${cozinha ? "8px 0" : "4px 0"}; border-top: 1px solid #000; }
  .item strong { display: block; font-size: ${cozinha ? "19px" : "13px"}; line-height: 1.16; overflow-wrap: anywhere; }
  .item span { text-align: right; font-weight: 800; }
  .gift-tag { display: block; margin-top: 2px; font-size: ${cozinha ? "14px" : "10px"}; font-weight: 900; text-transform: uppercase; }
  .obs { border: 1px solid #000; margin-top: 6px; padding: 5px; }
  .obs strong { display: block; margin-bottom: 4px; font-size: ${cozinha ? "20px" : "13px"}; }
  .obs p { font-size: ${cozinha ? "19px" : "13px"}; font-weight: 900; }
  .cut { margin-top: 10px; text-align: center; font-size: 12px; }
`;

const horaCurta = valor => {
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? ""
    : data.toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
};

function corpoDoRecibo(pedido, cozinha) {
  const senha = pedido.codeLabel || `Pedido ${String(pedido.id).slice(-3).toUpperCase()}`;
  const partes = [];

  partes.push(el("section.brand", {},
    el("h1", {}, "BAIXO K"),
    el("p", {}, "PIZZA | BURGUES | MASSAS | DRINKS")
  ));
  partes.push(el("div.ticket-type", {}, cozinha ? "COZINHA" : "BALCAO"));
  partes.push(el("strong.big-code", {}, senha));
  if (pedido.fulfillment === "retirada") partes.push(el("div.pickup", {}, "RETIRADA"));
  partes.push(el("div.customer", {}, pedido.customer || "CLIENTE"));

  const meta = el("div.meta", {},
    el("p", {}, el("span", {}, "Canal"), el("strong", {}, CANAIS_ROTULO[pedido.channel] || pedido.channel || "")),
    el("p", {}, el("span", {}, "Tipo"), el("strong", {}, MODALIDADES_ROTULO[pedido.fulfillment] || pedido.fulfillment || "")),
    el("p", {}, el("span", {}, "Horário"), el("strong", {}, horaCurta(pedido.createdAt))),
    el("p", {}, el("span", {}, "Local"), el("strong", {}, pedido.place || ""))
  );
  /* Telefone so na via do balcao. A via da cozinha fica pendurada no passe e
   * circula pela area de producao — nao ha motivo para carregar o telefone do
   * cliente ali. */
  if (pedido.phone && !cozinha) {
    meta.append(el("p", {}, el("span", {}, "Telefone"), el("strong", {}, pedido.phone)));
  }
  partes.push(meta);

  for (const item of pedido.items || []) {
    partes.push(el("div.item", {},
      el("div", {},
        el("strong", {}, `${item.qty}x ${item.name}`),
        item.gift ? el("span.gift-tag", {}, "BRINDE - LEVE E GANHE") : null
      ),
      cozinha ? null : el("span", {}, item.gift ? "Grátis" : `R$ ${dinheiro(item.price * item.qty)}`)
    ));
  }

  if (pedido.note) {
    partes.push(el("div.obs", {}, el("strong", {}, "OBSERVACAO"), el("p", {}, pedido.note)));
  }

  if (!cozinha) {
    const totais = el("div.totals");
    if (Number(pedido.discount || 0) > 0) {
      totais.append(
        el("div.line", {}, el("span", {}, "Subtotal"), el("strong", {}, `R$ ${dinheiro(pedido.subtotal || pedido.total)}`)),
        el("div.line", {}, el("span", {}, `Cupom ${pedido.coupon || ""}`), el("strong", {}, `- R$ ${dinheiro(pedido.discount)}`))
      );
    }
    if (Number(pedido.deliveryFee || 0) > 0) {
      totais.append(el("div.line", {}, el("span", {}, "Taxa de entrega"), el("strong", {}, `R$ ${dinheiro(pedido.deliveryFee)}`)));
    }
    if (String(pedido.payment || "").toLowerCase().includes("dinheiro") && Number(pedido.trocoPara || 0) > 0) {
      const troco = Math.max(0, Number(pedido.trocoPara) - Number(pedido.total || 0));
      totais.append(
        el("div.line", {}, el("span", {}, "Troco para"), el("strong", {}, `R$ ${dinheiro(pedido.trocoPara)}`)),
        el("div.line", {}, el("span", {}, "Troco"), el("strong", {}, `R$ ${dinheiro(troco)}`))
      );
    }
    totais.append(
      el("div.line", {}, el("span", {}, "Total"), el("strong", {}, `R$ ${dinheiro(pedido.total)}`)),
      el("div.line", {}, el("span", {}, "Pagamento"), el("strong", {}, pedido.payment || ""))
    );
    partes.push(totais);
  }

  partes.push(el("p.cut", {}, "------------------------------"));
  return partes;
}

export function imprimir(pedido, tipo = "counter") {
  const frame = document.getElementById("print-frame");
  if (!frame) return;

  const cozinha = tipo === "kitchen";
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) return;

  /* Balcão sempre 80mm — é a bobina que já funciona perfeita. A cozinha pode
   * ser uma impressora diferente, com papel mais estreito; o ajuste fica na
   * aba Pedidos, ao lado do botão "Teste cozinha". */
  const larguraPapel = cozinha
    ? Math.max(40, Math.min(120, Number(estado.ajustes?.largura_papel_cozinha) || LARGURA_PADRAO_MM))
    : LARGURA_PADRAO_MM;

  doc.open();
  doc.write("<!doctype html><html><head><meta charset='utf-8'><title>Baixo K</title></head><body></body></html>");
  doc.close();

  const estilo = doc.createElement("style");
  estilo.textContent = cssRecibo(cozinha, larguraPapel);
  doc.head.append(estilo);

  /* Os nos vem do documento do painel; adotamos para o do iframe. */
  for (const parte of corpoDoRecibo(pedido, cozinha)) {
    doc.body.append(doc.importNode(parte, true));
  }

  frame.contentWindow.focus();
  frame.contentWindow.print();
}

/* Aprovar um pedido imprime as duas vias: cozinha monta, balcao entrega. */
export function imprimirAmbas(pedido) {
  imprimir(pedido, "kitchen");
  setTimeout(() => imprimir(pedido, "counter"), 700);
}

export function imprimirTeste(tipo) {
  imprimir({
    id: "teste",
    codeLabel: "TESTE",
    createdAt: new Date().toISOString(),
    channel: "loja",
    fulfillment: "retirada",
    customer: "Cliente teste",
    place: "Balcão",
    payment: "Pix",
    note: "Teste Elgin i8",
    total: 39.8,
    subtotal: 39.8,
    discount: 0,
    items: [
      { name: "Burguer Classico", price: 22.9, qty: 1 },
      { name: "Drink Limao", price: 16.9, qty: 1 }
    ]
  }, tipo);
}
