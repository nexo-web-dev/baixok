/* Carrinho do cliente.
 *
 * Este e o unico localStorage que sobrou, e ele e legitimo: o carrinho pertence
 * aquele navegador e nao existe para mais ninguem. O que saiu do localStorage
 * foi o CATALOGO — preco, estoque, promocao e cupom agora vem do servidor a
 * cada carregamento, e nao de uma copia que o cliente podia editar.
 *
 * Guardamos so o necessario pra identificar O QUE foi escolhido: produto
 * normal (id), combo (comboId) ou pizza de 2 sabores (id + id2). O preco vem
 * sempre do cardapio recem-carregado, e o total real e sempre o que o
 * servidor calcular no fechamento.
 *
 * Como uma linha pode nao ter `id` (caso do combo), a chave de identidade de
 * cada linha e `chave()` — nao mais o id sozinho. */
const CHAVE_CARRINHO = "baixok.carrinho.v3";
const CHAVE_CUPOM = "baixok.cupom.v2";

const ouvintes = new Set();
const avisar = () => ouvintes.forEach(callback => callback());

export const aoMudarCarrinho = callback => {
  ouvintes.add(callback);
  return () => ouvintes.delete(callback);
};

/* Identidade de uma linha: mesmo combo, ou mesmo par de sabores (em qualquer
 * ordem de escolha), somam quantidade na mesma linha em vez de duplicar. */
export function chaveLinha({ id, id2, comboId }) {
  if (comboId) return `combo:${comboId}`;
  if (id2) return `sabor:${[id, id2].sort().join("+")}`;
  return `produto:${id}`;
}

function saneando(linha) {
  const qty = Math.max(1, Math.min(99, Math.floor(Number(linha?.qty) || 1)));
  if (linha && typeof linha.comboId === "string" && linha.comboId) {
    return { id: null, id2: null, comboId: linha.comboId, qty };
  }
  if (linha && typeof linha.id === "string" && linha.id) {
    const id2 = typeof linha.id2 === "string" && linha.id2 ? linha.id2 : null;
    return { id: linha.id, id2, comboId: null, qty };
  }
  return null;
}

function ler() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_CARRINHO) || "[]");
    if (!Array.isArray(bruto)) return [];
    return bruto.map(saneando).filter(Boolean);
  } catch {
    return [];
  }
}

function gravar(linhas) {
  localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(linhas));
  avisar();
}

/* Preco da combinacao de 2 sabores: sempre o que o lojista configurou para o
 * par, nunca calculado (media, sabor mais caro...). Sem preco configurado, a
 * linha nao tem como ser cobrada — comCatalogo() tira ela do carrinho. */
function precoDaCombinacao(combinacoesMap, idA, idB) {
  return combinacoesMap?.get([idA, idB].sort().join("|"));
}

export const carrinho = {
  linhas: ler,

  /* Reconciliado com o cardapio: devolve as linhas ja com nome, preco e foto
   * atuais, mais os avisos do que mudou desde que o item entrou. Sem isso o
   * cliente ve um total na tela e o servidor cobra outro. */
  comCatalogo({ produtosPorId, combosPorId, combinacoesMap }) {
    const avisos = [];
    const validas = [];
    let mudou = false;

    for (const linha of ler()) {
      const chave = chaveLinha(linha);

      if (linha.comboId) {
        const combo = combosPorId?.get(linha.comboId);
        if (!combo || !combo.active) {
          mudou = true;
          avisos.push("Um combo saiu do cardápio e foi retirado do seu pedido.");
          continue;
        }
        validas.push({
          chave, id: null, id2: null, comboId: combo.id,
          qty: linha.qty, name: combo.name, price: combo.price, image: combo.image
        });
        continue;
      }

      const produto = produtosPorId?.get(linha.id);
      if (!produto) {
        mudou = true;
        avisos.push("Um item saiu do cardápio e foi retirado do seu pedido.");
        continue;
      }

      if (linha.id2) {
        const produto2 = produtosPorId?.get(linha.id2);
        const preco = produto2 ? precoDaCombinacao(combinacoesMap, linha.id, linha.id2) : undefined;
        if (!produto2 || preco === undefined) {
          mudou = true;
          avisos.push("Uma combinação de sabores deixou de estar disponível e foi retirada do seu pedido.");
          continue;
        }
        validas.push({
          chave, id: produto.id, id2: produto2.id, comboId: null,
          qty: linha.qty, name: `Pizza 1/2 ${produto.name} + 1/2 ${produto2.name}`,
          price: preco, image: produto.image
        });
        continue;
      }

      validas.push({ chave, id: produto.id, id2: null, comboId: null, qty: linha.qty, name: produto.name, price: produto.price, image: produto.image });
    }

    if (mudou) gravar(validas.map(linha => ({ id: linha.id, id2: linha.id2, comboId: linha.comboId, qty: linha.qty })));
    return { linhas: validas, avisos };
  },

  /* Produto simples, sem escolha de sabor. */
  adicionar(id) {
    this.adicionarComposto({ id });
  },

  /* Combo ou pizza de 2 sabores — e tambem o caminho generico usado por
   * `adicionar()` acima. */
  adicionarComposto({ id = null, id2 = null, comboId = null }) {
    const nova = { id, id2, comboId };
    const chave = chaveLinha(nova);
    const linhas = ler();
    const existente = linhas.find(linha => chaveLinha(linha) === chave);
    if (existente) existente.qty = Math.min(99, existente.qty + 1);
    else linhas.push({ ...nova, qty: 1 });
    gravar(linhas);
  },

  mudarQuantidade(chave, delta) {
    const linhas = ler()
      .map(linha => (chaveLinha(linha) === chave ? { ...linha, qty: linha.qty + delta } : linha))
      .filter(linha => linha.qty > 0);
    gravar(linhas);
  },

  remover(chave) {
    gravar(ler().filter(linha => chaveLinha(linha) !== chave));
  },

  limpar() {
    localStorage.removeItem(CHAVE_CARRINHO);
    localStorage.removeItem(CHAVE_CUPOM);
    avisar();
  },

  quantidadeTotal() {
    return ler().reduce((soma, linha) => soma + linha.qty, 0);
  }
};

/* Guardamos so o codigo digitado. Quanto ele vale e decisao do servidor, e o
 * painel antigo entregava a lista inteira de cupons ao navegador justamente
 * para responder isso aqui. */
export const cupomGuardado = {
  ler: () => localStorage.getItem(CHAVE_CUPOM) || "",
  gravar(code) {
    localStorage.setItem(CHAVE_CUPOM, code);
    avisar();
  },
  limpar() {
    localStorage.removeItem(CHAVE_CUPOM);
    avisar();
  }
};
