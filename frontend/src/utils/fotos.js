const CLASSES_PROPORCAO = ["photo-wide", "photo-balanced", "photo-tall"];

function aplicarProporcao(alvo, classe, proporcao) {
  if (!alvo) return;
  alvo.classList.remove(...CLASSES_PROPORCAO);
  alvo.classList.add(classe);
  alvo.style.setProperty("--image-ratio", proporcao.toFixed(4));
  alvo.dataset.imageRatio = proporcao.toFixed(2);
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
}
