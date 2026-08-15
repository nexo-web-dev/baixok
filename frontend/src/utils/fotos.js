const CLASSES_PROPORCAO = ["photo-wide", "photo-balanced", "photo-tall"];
const CLASSES_FUNDO = ["photo-light-bg", "photo-bg-removed"];

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

  imagem.dataset.fundoNormalizado = "1";
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
