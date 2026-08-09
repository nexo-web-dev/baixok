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

const COPPER = "#c97443";
const GOLD = "#d99a68";
const INK = "#20180f";
const MUTED = "#8a7d6c";

function escreverCentralizado(ctx, texto, x, y, tamanho, peso = 700, cor = INK) {
  ctx.font = `${peso} ${tamanho}px Arial, sans-serif`;
  ctx.fillStyle = cor;
  ctx.fillText(texto, x, y);
}

function retanguloArredondado(ctx, x, y, largura, altura, raio) {
  ctx.beginPath();
  ctx.moveTo(x + raio, y);
  ctx.arcTo(x + largura, y, x + largura, y + altura, raio);
  ctx.arcTo(x + largura, y + altura, x, y + altura, raio);
  ctx.arcTo(x, y + altura, x, y, raio);
  ctx.arcTo(x, y, x + largura, y, raio);
  ctx.closePath();
}

async function gerarQrParaImpressao(numero, url) {
  const qr = await QRCode.toDataURL(url, { ...OPCOES, width: 640, margin: 1 });
  const [imagemQr, logo] = await Promise.all([
    carregarImagem(qr),
    carregarImagem("/images/baixok-logo-v2.png").catch(() => null)
  ]);

  const LARGURA = 760;
  const ALTURA = 1260;
  const CENTRO = LARGURA / 2;
  const canvas = document.createElement("canvas");
  canvas.width = LARGURA;
  canvas.height = ALTURA;

  const ctx = canvas.getContext("2d");
  ctx.textAlign = "center";

  // Fundo e faixa de topo — o resto da folha fica branco de proposito, pra
  // gastar o minimo de tinta possivel numa impressora de balcao.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LARGURA, ALTURA);
  ctx.fillStyle = COPPER;
  ctx.fillRect(0, 0, LARGURA, 14);

  // Logo + marca.
  if (logo) {
    const raioLogo = 44;
    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTRO, 96, raioLogo, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(logo, CENTRO - raioLogo, 96 - raioLogo, raioLogo * 2, raioLogo * 2);
    ctx.restore();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CENTRO, 96, raioLogo, 0, Math.PI * 2);
    ctx.stroke();
  }
  escreverCentralizado(ctx, "BAIXO K", CENTRO, 182, 30, 800, INK);

  // Numero da mesa em destaque — e o que precisa ser lido de longe.
  const pillY = 218;
  const pillH = 96;
  ctx.fillStyle = COPPER;
  retanguloArredondado(ctx, CENTRO - 220, pillY, 440, pillH, pillH / 2);
  ctx.fill();
  escreverCentralizado(ctx, `MESA ${numero}`, CENTRO, pillY + pillH / 2 + 20, 54, 900, "#ffffff");

  escreverCentralizado(ctx, "Aponte a câmera do celular para o código abaixo", CENTRO, pillY + pillH + 46, 22, 600, MUTED);

  // Cartao do QR, com respiro generoso em volta.
  const qrLado = 560;
  const cartaoLado = qrLado + 96;
  const cartaoX = CENTRO - cartaoLado / 2;
  const cartaoY = pillY + pillH + 78;
  ctx.strokeStyle = "#e7dfd3";
  ctx.lineWidth = 2;
  retanguloArredondado(ctx, cartaoX, cartaoY, cartaoLado, cartaoLado, 28);
  ctx.stroke();
  ctx.drawImage(imagemQr, cartaoX + 48, cartaoY + 48, qrLado, qrLado);

  // Rodape: chamada de acao dentro de um badge leve, com mais distancia do QR.
  const rodapeY = cartaoY + cartaoLado + 70;
  ctx.fillStyle = "#f7ede3";
  retanguloArredondado(ctx, CENTRO - 260, rodapeY, 520, 56, 28);
  ctx.fill();
  escreverCentralizado(ctx, "Chame o garçom para fechar a conta", CENTRO, rodapeY + 36, 22, 700, "#8a4a24");

  escreverCentralizado(ctx, "Escaneie, monte seu pedido e envie direto para a cozinha", CENTRO, rodapeY + 100, 19, 500, MUTED);

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
