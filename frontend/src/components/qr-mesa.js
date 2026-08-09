/* QR code da mesa, gerado no proprio navegador.
 *
 * O sistema antigo montava a imagem com api.qrserver.com — um servico de
 * terceiro. Isso significava: o endereco do cardapio da loja saia para fora a
 * cada abertura do modal, e o QR simplesmente nao aparecia sem internet, o que
 * na rede local da loja e um cenario comum. Com a geracao local nao ha saida de
 * dado nem dependencia de rede externa. */
import QRCode from "qrcode";
import { $, mostrar } from "../utils/dom.js";
import { toastErro } from "./toast.js";

const OPCOES = {
  errorCorrectionLevel: "M",
  margin: 1,
  color: { dark: "#12100e", light: "#ffffff" }
};

export function urlDaMesa(numero, menuUrl) {
  /* Sem menu_url configurado usamos a origem atual: na rede da loja isso ja
   * funciona, e evita imprimir QR apontando para lugar nenhum. */
  const base = (menuUrl || `${location.origin}/index.html`).replace(/\/$/, "");
  const separador = base.includes("?") ? "&" : "?";
  return `${base}${separador}mesa=${numero}`;
}

export async function abrirQrMesa(numero, menuUrl) {
  const modal = $("#qr-modal");
  if (!modal) return;

  const url = urlDaMesa(numero, menuUrl);
  $("#qr-title").textContent = `Mesa ${numero}`;
  $("#qr-url").textContent = url;

  try {
    const paraTela = await QRCode.toDataURL(url, { ...OPCOES, width: 220 });
    const paraImpressao = await QRCode.toDataURL(url, { ...OPCOES, width: 800, margin: 2 });

    $("#qr-image").src = paraTela;
    $("#qr-print").href = paraImpressao;
    $("#qr-print").download = `qr-mesa-${numero}.png`;
    mostrar(modal, true);
  } catch {
    toastErro("Não foi possível gerar o QR code desta mesa.");
  }
}

export function fecharQrMesa() {
  mostrar($("#qr-modal"), false);
}
