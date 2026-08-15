const CLASSES_PROPORCAO = ["photo-wide", "photo-balanced", "photo-tall"];
const CLASSES_FUNDO = ["photo-light-bg", "photo-bg-removed"];
const FUNDO_CACHE = new Map();

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

  if (imagem.dataset.originalSrc && imagem.src !== imagem.dataset.originalSrc) {
    imagem.src = imagem.dataset.originalSrc;
  }

  const classe = detectarFundoClaro(imagem);
  aplicarClasseFundo(frame, classe);
  imagem.dataset.fundoNormalizado = "1";
}

function detectarFundoClaro(imagem) {
  const chave = imagem.currentSrc || imagem.src;
  if (!chave) return "";
  if (FUNDO_CACHE.has(chave)) return FUNDO_CACHE.get(chave);

  let classe = "";
  try {
    const tamanho = 48;
    const canvas = document.createElement("canvas");
    canvas.width = tamanho;
    canvas.height = tamanho;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";

    ctx.drawImage(imagem, 0, 0, tamanho, tamanho);
    const { data } = ctx.getImageData(0, 0, tamanho, tamanho);
    let amostras = 0;
    let claras = 0;

    for (let y = 0; y < tamanho; y += 1) {
      for (let x = 0; x < tamanho; x += 1) {
        const borda = x < 6 || x >= tamanho - 6 || y < 6 || y >= tamanho - 6;
        if (!borda) continue;

        const i = (y * tamanho + x) * 4;
        const alpha = data[i + 3];
        if (alpha < 16) continue;

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const brilho = (r + g + b) / 3;

        amostras += 1;
        if (brilho > 220 && max - min < 42) claras += 1;
      }
    }

    if (amostras && claras / amostras > 0.54) classe = "photo-light-bg";
  } catch {
    classe = "";
  }

  FUNDO_CACHE.set(chave, classe);
  return classe;
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
