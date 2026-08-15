const CLASSES_PROPORCAO = ["photo-wide", "photo-balanced", "photo-tall"];
const CLASSES_FUNDO = ["photo-light-bg", "photo-bg-removed"];
const cacheFundoClaro = new Map();

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

function distanciaCor(r, g, b, cor) {
  return Math.abs(r - cor.r) + Math.abs(g - cor.g) + Math.abs(b - cor.b);
}

function mediaBorda(dados, largura, altura) {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;

  const somar = (x, y) => {
    const indice = (y * largura + x) * 4;
    const alpha = dados[indice + 3];
    if (alpha < 20) return;
    r += dados[indice];
    g += dados[indice + 1];
    b += dados[indice + 2];
    total += 1;
  };

  for (let x = 0; x < largura; x += 1) {
    somar(x, 0);
    somar(x, altura - 1);
  }
  for (let y = 1; y < altura - 1; y += 1) {
    somar(0, y);
    somar(largura - 1, y);
  }

  if (!total) return null;
  return {
    r: r / total,
    g: g / total,
    b: b / total
  };
}

function corEhFundoClaro(dados, indice, cor) {
  const alpha = dados[indice + 3];
  if (alpha < 20) return true;

  const r = dados[indice];
  const g = dados[indice + 1];
  const b = dados[indice + 2];
  const brilho = (r + g + b) / 3;
  const variacao = Math.max(r, g, b) - Math.min(r, g, b);

  return brilho > 176 && variacao < 54 && distanciaCor(r, g, b, cor) < 92;
}

function removerFundoClaro(imagem) {
  const larguraOriginal = imagem.naturalWidth;
  const alturaOriginal = imagem.naturalHeight;
  if (!larguraOriginal || !alturaOriginal) return null;

  const maximo = 620;
  const escala = Math.min(1, maximo / Math.max(larguraOriginal, alturaOriginal));
  const largura = Math.max(1, Math.round(larguraOriginal * escala));
  const altura = Math.max(1, Math.round(alturaOriginal * escala));
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(imagem, 0, 0, largura, altura);

  const imagemDados = ctx.getImageData(0, 0, largura, altura);
  const dados = imagemDados.data;
  const cor = mediaBorda(dados, largura, altura);
  if (!cor) return null;

  const brilhoBorda = (cor.r + cor.g + cor.b) / 3;
  const variacaoBorda = Math.max(cor.r, cor.g, cor.b) - Math.min(cor.r, cor.g, cor.b);
  if (brilhoBorda < 205 || variacaoBorda > 58) return null;

  const visitado = new Uint8Array(largura * altura);
  const fila = [];
  const adicionar = (x, y) => {
    const pos = y * largura + x;
    if (visitado[pos]) return;
    const indice = pos * 4;
    if (!corEhFundoClaro(dados, indice, cor)) return;
    visitado[pos] = 1;
    fila.push(pos);
  };

  for (let x = 0; x < largura; x += 1) {
    adicionar(x, 0);
    adicionar(x, altura - 1);
  }
  for (let y = 1; y < altura - 1; y += 1) {
    adicionar(0, y);
    adicionar(largura - 1, y);
  }

  let removidos = 0;
  for (let ponteiro = 0; ponteiro < fila.length; ponteiro += 1) {
    const pos = fila[ponteiro];
    const x = pos % largura;
    const y = Math.floor(pos / largura);
    dados[pos * 4 + 3] = 0;
    removidos += 1;

    if (x > 0) adicionar(x - 1, y);
    if (x < largura - 1) adicionar(x + 1, y);
    if (y > 0) adicionar(x, y - 1);
    if (y < altura - 1) adicionar(x, y + 1);
  }

  if (removidos / (largura * altura) < 0.08) return null;
  ctx.putImageData(imagemDados, 0, 0);
  return canvas.toDataURL("image/png");
}

function normalizarFundoClaro(imagem, frame) {
  if (!imagem || imagem.dataset.fundoNormalizado === "1") return;
  const origem = imagem.dataset.originalSrc || imagem.currentSrc || imagem.src;
  if (!origem) return;
  imagem.dataset.originalSrc = origem;

  const aplicarResultado = resultado => {
    if (!resultado) {
      aplicarClasseFundo(frame, "");
      return;
    }
    aplicarClasseFundo(frame, "photo-bg-removed");
    imagem.dataset.fundoNormalizado = "1";
    imagem.src = resultado;
  };

  const emCache = cacheFundoClaro.get(origem);
  if (emCache) {
    Promise.resolve(emCache).then(aplicarResultado).catch(() => aplicarClasseFundo(frame, ""));
    return;
  }

  const processar = () => {
    try {
      aplicarClasseFundo(frame, "photo-light-bg");
      return removerFundoClaro(imagem);
    } catch {
      return null;
    }
  };

  const tarefa = new Promise(resolve => {
    const executar = () => resolve(processar());
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(executar, { timeout: 600 });
    } else {
      window.setTimeout(executar, 40);
    }
  });

  cacheFundoClaro.set(origem, tarefa);
  tarefa.then(resultado => {
    cacheFundoClaro.set(origem, resultado);
    aplicarResultado(resultado);
  }).catch(() => {
    cacheFundoClaro.set(origem, null);
    aplicarClasseFundo(frame, "");
  });
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
