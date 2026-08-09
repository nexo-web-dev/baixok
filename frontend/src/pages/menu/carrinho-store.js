/* Carrinho do cliente.
 *
 * Este e o unico localStorage que sobrou, e ele e legitimo: o carrinho pertence
 * aquele navegador e nao existe para mais ninguem. O que saiu do localStorage
 * foi o CATALOGO — preco, estoque, promocao e cupom agora vem do servidor a
 * cada carregamento, e nao de uma copia que o cliente podia editar.
 *
 * Guardamos apenas id e quantidade. O preco vem do cardapio recem-carregado, e
 * o total real e sempre o que o servidor calcular no fechamento. */
const CHAVE_CARRINHO = "baixok.carrinho.v2";
const CHAVE_CUPOM = "baixok.cupom.v2";

const ouvintes = new Set();
const avisar = () => ouvintes.forEach(callback => callback());

export const aoMudarCarrinho = callback => {
  ouvintes.add(callback);
  return () => ouvintes.delete(callback);
};

function ler() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_CARRINHO) || "[]");
    if (!Array.isArray(bruto)) return [];
    /* Saneia na leitura: o conteudo veio do disco e pode ter sido editado a mao
     * ou ter sobrado de uma versao anterior do formato. */
    return bruto
      .filter(linha => linha && typeof linha.id === "string")
      .map(linha => ({ id: linha.id, qty: Math.max(1, Math.min(99, Math.floor(Number(linha.qty) || 1))) }));
  } catch {
    return [];
  }
}

function gravar(linhas) {
  localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(linhas));
  avisar();
}

export const carrinho = {
  linhas: ler,

  /* Reconciliado com o cardapio: devolve as linhas ja com nome e preco atuais,
   * mais os avisos do que mudou desde que o item entrou. Sem isso o cliente ve
   * um total na tela e o servidor cobra outro. */
  comCatalogo(produtosPorId) {
    const avisos = [];
    const validas = [];
    let mudou = false;

    for (const linha of ler()) {
      const produto = produtosPorId.get(linha.id);
      if (!produto) {
        mudou = true;
        avisos.push("Um item saiu do cardápio e foi retirado do seu pedido.");
        continue;
      }
      validas.push({ id: produto.id, qty: linha.qty, name: produto.name, price: produto.price, image: produto.image });
    }

    if (mudou) gravar(validas.map(linha => ({ id: linha.id, qty: linha.qty })));
    return { linhas: validas, avisos };
  },

  adicionar(id) {
    const linhas = ler();
    const existente = linhas.find(linha => linha.id === id);
    if (existente) existente.qty = Math.min(99, existente.qty + 1);
    else linhas.push({ id, qty: 1 });
    gravar(linhas);
  },

  mudarQuantidade(id, delta) {
    const linhas = ler()
      .map(linha => (linha.id === id ? { ...linha, qty: linha.qty + delta } : linha))
      .filter(linha => linha.qty > 0);
    gravar(linhas);
  },

  remover(id) {
    gravar(ler().filter(linha => linha.id !== id));
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
