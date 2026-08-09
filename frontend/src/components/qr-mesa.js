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

function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const imagem = new Image();
    imagem.onload = () => resolve(imagem);
    imagem.onerror = reject;
    imagem.src = src;
  });
}

function escreverCentralizado(ctx, texto, y, tamanho, peso = 700) {
  ctx.font = `${peso} ${tamanho}px Arial, sans-serif`;
  ctx.fillText(texto, 360, y);
}

async function gerarQrParaImpressao(numero, url) {
  const qr = await QRCode.toDataURL(url, { ...OPCOES, width: 560, margin: 2 });
  const imagemQr = await carregarImagem(qr);
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 900;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.fillStyle = "#12100e";
  escreverCentralizado(ctx, "BAIXO K", 66, 34, 800);
  escreverCentralizado(ctx, `MESA ${numero}`, 138, 56, 900);
  escreverCentralizado(ctx, "Escaneie para pedir na mesa", 182, 24, 700);

  ctx.strokeStyle = "#12100e";
  ctx.lineWidth = 4;
  ctx.strokeRect(52, 96, 616, 112);
  ctx.drawImage(imagemQr, 80, 240, 560, 560);

  ctx.fillStyle = "#333333";
  escreverCentralizado(ctx, "Chame o garcom para fechar a conta.", 846, 21, 700);

  return canvas.toDataURL("image/png");
}

export async function abrirQrMesa(numero, menuUrl) {
  const modal = $("#qr-modal");
  if (!modal) return;

  const url = urlDaMesa(numero, menuUrl);
  $("#qr-title").textContent = `Mesa ${numero}`;
  $("#qr-url").textContent = url;

  try {
    const paraTela = await QRCode.toDataURL(url, { ...OPCOES, width: 220 });
    const paraImpressao = await gerarQrParaImpressao(numero, url);

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
