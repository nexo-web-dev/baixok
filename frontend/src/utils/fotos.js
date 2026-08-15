const CLASSES_PROPORCAO = ["photo-wide", "photo-balanced", "photo-tall"];
const CLASSES_FUNDO = ["photo-light-bg", "photo-bg-removed"];
const FUNDO_CACHE = new Map();
const THUMB_CACHE = new Map();

function aplicarProporcao(alvo, classe, proporcao) {
  if (!alvo) return;
  alvo.classList.remove(...CLASSES_PROPORCAO);
  alvo.classList.add(classe);
  alvo.style.setProperty("--image-ratio", proporcao.toFixed(4));
  alvo.dataset.imageRatio = proporcao.toFixed(2);
}

function aplicarClasseFundo(frame, classe) {
  if (!frame) return;
  frame.classList.remove(...CLASSES_FUNDO);
  if (classe) frame.classList.add(classe);
}

function normalizarFundoClaro(imagem, frame) {
  if (!imagem) return;
  aplicarClasseFundo(frame, "");

  const original = imagem.dataset.originalSrc || imagem.currentSrc || imagem.src;
  if (!original) return;
  if (!imagem.dataset.originalSrc) imagem.dataset.originalSrc = original;

  if (imagem.dataset.fundoNormalizado === "1") {
    aplicarClasseFundo(frame, imagem.dataset.fundoClasse || "");
    return;
  }

  const classe = FUNDO_CACHE.has(original) ? FUNDO_CACHE.get(original) : detectarFundoClaro(imagem);
  FUNDO_CACHE.set(original, classe);

  let classeFinal = classe;
  if (classe === "photo-light-bg") {
    const thumb = THUMB_CACHE.has(original) ? THUMB_CACHE.get(original) : criarMiniaturaFundoNeutro(imagem);
    THUMB_CACHE.set(original, thumb);
    if (thumb) {
      classeFinal = "photo-bg-removed";
      imagem.src = thumb;
    }
  }

  imagem.dataset.fundoClasse = classeFinal;
  imagem.dataset.fundoNormalizado = "1";
  aplicarClasseFundo(frame, classeFinal);
}

function detectarFundoClaro(imagem) {
  try {
    const maximo = 80;
    const escala = Math.min(1, maximo / Math.max(imagem.naturalWidth, imagem.naturalHeight));
    const largura = Math.max(1, Math.round(imagem.naturalWidth * escala));
    const altura = Math.max(1, Math.round(imagem.naturalHeight * escala));
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";

    ctx.drawImage(imagem, 0, 0, largura, altura);
    const { data } = ctx.getImageData(0, 0, largura, altura);
    let amostras = 0;
    let claras = 0;

    const contar = (x, y) => {
      const i = ((y * largura + x) * 4);
      if (data[i + 3] < 18) return;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const brilho = (r + g + b) / 3;
      amostras += 1;
      if (brilho > 210 && max - min < 62) claras += 1;
    };

    for (let x = 0; x < largura; x += 2) {
      contar(x, 0);
      contar(x, altura - 1);
    }
    for (let y = 0; y < altura; y += 2) {
      contar(0, y);
      contar(largura - 1, y);
    }

    return amostras && claras / amostras > 0.55 ? "photo-light-bg" : "";
  } catch {
    return "";
  }
}

function criarMiniaturaFundoNeutro(imagem) {
  try {
    const origem = document.createElement("canvas");
    const limite = 320;
    const escala = Math.min(1, limite / Math.max(imagem.naturalWidth, imagem.naturalHeight));
    const largura = Math.max(1, Math.round(imagem.naturalWidth * escala));
    const altura = Math.max(1, Math.round(imagem.naturalHeight * escala));
    origem.width = largura;
    origem.height = altura;

    const ctx = origem.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    ctx.drawImage(imagem, 0, 0, largura, altura);

    const imagemDados = ctx.getImageData(0, 0, largura, altura);
    const fundo = medirFundoClaro(imagemDados.data, largura, altura);
    if (!fundo || fundo.brilho < 188) return "";

    const mascaraFundo = marcarFundoConectado(imagemDados.data, largura, altura, fundo);
    const recorte = calcularRecorteSeguro(imagemDados.data, largura, altura, mascaraFundo);
    if (!recorte) return "";

    const recorteCanvas = document.createElement("canvas");
    recorteCanvas.width = recorte.w;
    recorteCanvas.height = recorte.h;
    const rctx = recorteCanvas.getContext("2d", { willReadFrequently: true });
    if (!rctx) return "";
    rctx.drawImage(origem, recorte.x, recorte.y, recorte.w, recorte.h, 0, 0, recorte.w, recorte.h);
    const recorteDados = rctx.getImageData(0, 0, recorte.w, recorte.h);
    for (let y = 0; y < recorte.h; y += 1) {
      for (let x = 0; x < recorte.w; x += 1) {
        const origemIndex = ((y + recorte.y) * largura) + x + recorte.x;
        if (!mascaraFundo[origemIndex]) continue;
        const i = (y * recorte.w + x) * 4;
        recorteDados.data[i + 3] = 0;
      }
    }
    rctx.putImageData(recorteDados, 0, 0);

    const saida = document.createElement("canvas");
    const lado = 360;
    saida.width = lado;
    saida.height = lado;
    const sctx = saida.getContext("2d");
    if (!sctx) return "";

    const gradiente = sctx.createRadialGradient(lado * .5, lado * .44, 8, lado * .5, lado * .5, lado * .74);
    gradiente.addColorStop(0, "#35251b");
    gradiente.addColorStop(.62, "#201712");
    gradiente.addColorStop(1, "#120e0b");
    sctx.fillStyle = gradiente;
    sctx.fillRect(0, 0, lado, lado);

    const maxDestino = lado * .96;
    const escalaDestino = Math.min(maxDestino / recorte.w, maxDestino / recorte.h);
    const destinoW = Math.round(recorte.w * escalaDestino);
    const destinoH = Math.round(recorte.h * escalaDestino);
    const destinoX = Math.round((lado - destinoW) / 2);
    const destinoY = Math.round((lado - destinoH) / 2);
    sctx.shadowColor = "rgba(0,0,0,.34)";
    sctx.shadowBlur = 18;
    sctx.shadowOffsetY = 10;
    sctx.drawImage(recorteCanvas, destinoX, destinoY, destinoW, destinoH);

    return saida.toDataURL("image/webp", .86);
  } catch {
    return "";
  }
}

function medirFundoClaro(data, largura, altura) {
  const margemX = Math.max(1, Math.round(largura * .08));
  const margemY = Math.max(1, Math.round(altura * .08));
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;

  const somar = (x, y) => {
    const i = (y * largura + x) * 4;
    if (data[i + 3] < 18) return;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    total += 1;
  };

  for (let y = 0; y < altura; y += Math.max(1, Math.round(altura / 42))) {
    for (let x = 0; x < largura; x += Math.max(1, Math.round(largura / 42))) {
      if (x <= margemX || x >= largura - margemX || y <= margemY || y >= altura - margemY) somar(x, y);
    }
  }

  if (!total) return null;
  const cor = { r: r / total, g: g / total, b: b / total };
  const brilho = (cor.r + cor.g + cor.b) / 3;
  const saturacao = Math.max(cor.r, cor.g, cor.b) - Math.min(cor.r, cor.g, cor.b);
  return { ...cor, brilho, saturacao };
}

function pixelParecidoComFundo(data, indice, fundo) {
  if (data[indice + 3] < 24) return true;
  const r = data[indice];
  const g = data[indice + 1];
  const b = data[indice + 2];
  const brilho = (r + g + b) / 3;
  const saturacao = Math.max(r, g, b) - Math.min(r, g, b);
  const distancia = Math.hypot(r - fundo.r, g - fundo.g, b - fundo.b);
  return brilho > 172 && distancia < 54 && saturacao <= fundo.saturacao + 48;
}

function marcarFundoConectado(data, largura, altura, fundo) {
  const total = largura * altura;
  const visitado = new Uint8Array(total);
  const fila = [];

  const tentarAdicionar = (x, y) => {
    if (x < 0 || y < 0 || x >= largura || y >= altura) return;
    const p = y * largura + x;
    if (visitado[p]) return;
    if (!pixelParecidoComFundo(data, p * 4, fundo)) return;
    visitado[p] = 1;
    fila.push(p);
  };

  for (let x = 0; x < largura; x += 1) {
    tentarAdicionar(x, 0);
    tentarAdicionar(x, altura - 1);
  }
  for (let y = 0; y < altura; y += 1) {
    tentarAdicionar(0, y);
    tentarAdicionar(largura - 1, y);
  }

  for (let cursor = 0; cursor < fila.length; cursor += 1) {
    const p = fila[cursor];
    const x = p % largura;
    const y = Math.floor(p / largura);
    tentarAdicionar(x + 1, y);
    tentarAdicionar(x - 1, y);
    tentarAdicionar(x, y + 1);
    tentarAdicionar(x, y - 1);
  }

  return visitado;
}

function calcularRecorteSeguro(data, largura, altura, mascaraFundo) {
  let minX = largura;
  let minY = altura;
  let maxX = -1;
  let maxY = -1;
  let pontos = 0;

  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const p = y * largura + x;
      if (mascaraFundo[p]) continue;
      const i = p * 4;
      if (data[i + 3] < 24) continue;

      pontos += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (pontos < Math.max(24, largura * altura * .002)) return null;

  const margem = Math.max(5, Math.round(Math.max(largura, altura) * .025));
  minX = Math.max(0, minX - margem);
  minY = Math.max(0, minY - margem);
  maxX = Math.min(largura - 1, maxX + margem);
  maxY = Math.min(altura - 1, maxY + margem);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w <= 0 || h <= 0) return null;
  if (w > largura * .98 && h > altura * .98) return null;
  return { x: minX, y: minY, w, h };
}

export function marcarProporcaoImagem(evento) {
  const imagem = evento?.currentTarget || evento?.target;
  if (!imagem?.naturalWidth || !imagem?.naturalHeight) return;

  const frame = imagem.closest(".photo-frame, .fit-media");
  if (!frame) return;

  const proporcao = imagem.naturalWidth / imagem.naturalHeight;
  const classe = proporcao >= 1.28
    ? "photo-wide"
    : proporcao <= 0.82
      ? "photo-tall"
      : "photo-balanced";

  aplicarProporcao(frame, classe, proporcao);
  aplicarProporcao(frame.closest(".product"), classe, proporcao);
  aplicarProporcao(frame.closest(".cart-row"), classe, proporcao);
  aplicarProporcao(frame.closest(".signature-strip article"), classe, proporcao);
  aplicarProporcao(frame.closest(".product-detail"), classe, proporcao);
  normalizarFundoClaro(imagem, frame);
}
