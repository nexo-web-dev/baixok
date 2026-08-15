/* Regras de cadastro de produto e estoque. */
import { produtosRepo } from "../repositories/produtos.repo.js";
import { promocoesRepo } from "../repositories/promocoes.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { naoEncontrado, ErroApp } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";
import { uid } from "../lib/ids.js";
import { emTransacao } from "../db/postgres.js";
import { controlaEstoqueCategoria } from "../lib/estoque.js";

const SELO_POR_CATEGORIA = {
  pizzas: "Pizza", burgues: "Burguer", massas: "Massa", drinks: "Drink", porcoes: "Porcao"
};

/* Categoria e texto livre ("Pizzas Salgadas", "Pizzas Doces", "pizzas"...),
 * entao a checagem e por conter "pizza", nao por bater a string inteira —
 * assim toda variante de pizza cai na regra sem precisar padronizar o nome
 * exato da categoria no cadastro. */
function ehCategoriaPizza(categoria) {
  return String(categoria || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .includes("pizza");
}

function normalizarEstoqueDoProduto(dados) {
  const controla = controlaEstoqueCategoria(dados.category);
  return {
    ...dados,
    stock: controla ? Number(dados.stock || 0) : 0,
    minStock: controla ? Number(dados.minStock ?? 4) : 0,
    /* Pizza de 2 sabores nao e escolha por produto: e a categoria inteira.
     * Quais combinacoes realmente vendem quem decide e a tela de
     * combinacoes de sabores — aqui e so "esse produto e um sabor". Ignora o
     * que vier do cliente de proposito, igual ao preco: decisao da casa, nao
     * do formulario. */
    saborPizza: ehCategoriaPizza(dados.category)
  };
}

export const produtosService = {
  listar: () => produtosRepo.listar(),
  imagemPublica: id => produtosRepo.imagemPublica(id),

  async emFalta() {
    return (await produtosRepo.emFalta()).filter(produto => controlaEstoqueCategoria(produto.category));
  },

  /* Cardapio publico: produtos a venda ja com o preco promocional aplicado.
   * O cliente nunca ve estoque_min nem a quantidade exata em estoque — sao
   * dados de operacao. */
  async cardapioPublico() {
    /* As duas consultas nao dependem uma da outra: em paralelo, o cardapio custa
     * uma ida ao banco em vez de duas em fila. */
    const [promos, brindes, produtos] = await Promise.all([
      promocoesRepo.listarPublico(),
      promocoesRepo.listarBrindesPublico(),
      produtosRepo.listarPublico()
    ]);
    const promocoes = new Map(promos.map(promo => [promo.productId, promo.price]));
    const produtosPorId = new Map(produtos.map(produto => [produto.id, produto]));
    /* Uma regra "leve e ganhe" e uma linha por par (produto comprado, produto
     * de brinde), entao um mesmo produto comprado pode ter varias regras —
     * uma pessoa levando 2 pizzas pode ganhar tanto um refrigerante quanto
     * uma batata, por exemplo. Por isso agrupa em lista, nao um unico valor. */
    const brindesPorProduto = new Map();
    for (const brinde of brindes) {
      const lista = brindesPorProduto.get(brinde.buyProductId) || [];
      lista.push(brinde);
      brindesPorProduto.set(brinde.buyProductId, lista);
    }

    return produtos
      .filter(produto => !controlaEstoqueCategoria(produto.category) || produto.stock > 0)
      .map(({ stock: _stock, ...produto }) => {
        const brindesPromocionais = (brindesPorProduto.get(produto.id) || [])
          .map(brinde => {
            const produtoBrinde = produtosPorId.get(brinde.giftProductId);
            return produtoBrinde ? {
              buyQty: brinde.buyQty,
              giftQty: brinde.giftQty,
              giftProductId: brinde.giftProductId,
              giftName: produtoBrinde.name,
              giftImage: produtoBrinde.image || "",
              until: brinde.until
            } : null;
          })
          .filter(Boolean);

        return {
          ...produto,
          disponivel: true,
          precoOriginal: promocoes.has(produto.id) ? produto.price : null,
          price: promocoes.get(produto.id) ?? produto.price,
          emPromocao: promocoes.has(produto.id),
          brindesPromocionais
        };
      });
  },

  async buscar(id) {
    const produto = await produtosRepo.buscar(id);
    if (!produto) throw naoEncontrado("Produto não encontrado.");
    return produto;
  },

  async criar(dados, { usuario, ip }) {
    const normalizado = normalizarEstoqueDoProduto(dados);
    const produto = await emTransacao(async () => {
      const criado = await produtosRepo.criar({
        ...normalizado,
        featuredOrder: 0,
        id: uid("prod"),
        badge: SELO_POR_CATEGORIA[normalizado.category] || "Item"
      });
      return normalizado.featuredOrder
        ? produtosRepo.definirDestaque(criado.id, normalizado.featuredOrder)
        : criado;
    });
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "produto_criado",
      entidade: "produto", entidadeId: produto.id,
      detalhes: { nome: produto.name, preco: produto.price, destaque: produto.featuredOrder || 0 }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return produto;
  },

  async atualizar(id, dados, { usuario, ip }) {
    const anterior = await this.buscar(id);
    const normalizado = normalizarEstoqueDoProduto(dados);
    const produto = await emTransacao(async () => {
      await produtosRepo.atualizar(id, {
        ...normalizado,
        badge: SELO_POR_CATEGORIA[normalizado.category] || "Item"
      });
      return produtosRepo.definirDestaque(id, normalizado.featuredOrder || 0);
    });

    /* A auditoria guarda o que mudou, nao o objeto inteiro: um relatorio de
     * "quem baixou o preco da pizza?" fica legivel. */
    const mudancas = Object.fromEntries(
      Object.entries(normalizado)
        .filter(([chave, valor]) => anterior[chave] !== valor && chave !== "image")
        .map(([chave, valor]) => [chave, { de: anterior[chave], para: valor }])
    );
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "produto_alterado",
      entidade: "produto", entidadeId: id, detalhes: mudancas, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return produto;
  },

  async moverOrdem(id, direction, { usuario, ip }) {
    const produtos = await produtosRepo.listar();
    const indice = produtos.findIndex(produto => produto.id === id);
    if (indice === -1) throw naoEncontrado("Produto não encontrado.");

    const destino = direction === "up" ? indice - 1 : indice + 1;
    if (destino < 0 || destino >= produtos.length) return produtos[indice];

    const ids = produtos.map(produto => produto.id);
    [ids[indice], ids[destino]] = [ids[destino], ids[indice]];
    await emTransacao(() => produtosRepo.reordenarIds(ids));
    const produto = await this.buscar(id);

    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "produto_ordem",
      entidade: "produto", entidadeId: id,
      detalhes: { nome: produto.name, ordem: produto.order }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return produto;
  },

  async reordenarLista(ids, { usuario, ip }) {
    const produtos = await produtosRepo.listar();
    const existentes = new Set(produtos.map(produto => produto.id));
    const ordenados = ids.filter(id => existentes.has(id));
    if (!ordenados.length) throw naoEncontrado("Produto nao encontrado.");

    const usados = new Set(ordenados);
    const fila = [...ordenados];
    const ordemFinal = produtos.map(produto => usados.has(produto.id) ? fila.shift() : produto.id);

    await emTransacao(() => produtosRepo.reordenarIds(ordemFinal));
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "produto_ordem",
      entidade: "produto", entidadeId: ordenados[0],
      detalhes: { quantidade: ordenados.length, modo: "arrastar" }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return produtosRepo.listar();
  },

  async remover(id, { usuario, ip }) {
    const produto = await this.buscar(id);
    /* Nao apagamos produto que ja apareceu em pedido: a exclusao levaria junto o
     * historico de vendas. O caminho para tirar do cardapio e desativar. */
    if (!(await produtosRepo.remover(id))) throw naoEncontrado("Produto não encontrado.");
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "produto_removido",
      entidade: "produto", entidadeId: id, detalhes: { nome: produto.name }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
  },

  async alternarAtivo(id, { usuario, ip }) {
    await this.buscar(id);
    const produto = await produtosRepo.alternarAtivo(id);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario,
      acao: produto.active ? "produto_ativado" : "produto_pausado",
      entidade: "produto", entidadeId: id, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return produto;
  },

  async ajustarEstoque(id, { delta, valor, minStock }, { usuario, ip }) {
    const anterior = await this.buscar(id);
    if (!controlaEstoqueCategoria(anterior.category)) {
      throw new ErroApp("Estoque operacional e usado apenas para bebidas, refrigerantes e drinks.", 422, "estoque_nao_controlado");
    }

    let produto = anterior;
    if (valor !== undefined) produto = await produtosRepo.definirEstoque(id, valor);
    else if (delta !== undefined) produto = await produtosRepo.ajustarEstoque(id, delta);
    if (minStock !== undefined) produto = await produtosRepo.definirEstoqueMinimo(id, minStock);

    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "estoque_ajustado",
      entidade: "produto", entidadeId: id,
      detalhes: {
        de: anterior.stock, para: produto.stock,
        minimoDe: anterior.minStock, minimoPara: produto.minStock, nome: produto.name
      }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return produto;
  }
};

export const promocoesService = {
  listar: () => promocoesRepo.listar(),
  listarBrindes: () => promocoesRepo.listarBrindes(),

  async salvar(dados, { usuario, ip }) {
    const produto = await produtosRepo.buscar(dados.productId);
    if (!produto) throw naoEncontrado("Produto não encontrado.");

    /* Regra que o schema nao consegue expressar: depende do preco cadastrado.
     * O painel antigo checava isso so na tela, entao uma chamada direta a API
     * criava "promocao" mais cara que o preco cheio. */
    if (dados.price >= produto.price) {
      throw new ErroApp(
        `O preço promocional precisa ser menor que R$ ${produto.price.toFixed(2)}.`,
        422,
        "promocao_invalida"
      );
    }

    const promocao = await promocoesRepo.salvar({ ...dados, id: uid("promo") });
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "promocao_salva",
      entidade: "promocao", entidadeId: promocao.id,
      detalhes: { produto: produto.name, de: produto.price, para: dados.price }, ip
    });
    publicar("promocoes", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return promocao;
  },

  async remover(id, { usuario, ip }) {
    if (!(await promocoesRepo.remover(id))) throw naoEncontrado("Promoção não encontrada.");
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "promocao_encerrada",
      entidade: "promocao", entidadeId: id, ip
    });
    publicar("promocoes", [CANAL.PUBLICO, CANAL.OPERACAO]);
  },

  async salvarBrinde(dados, { usuario, ip }) {
    const [produtoCompra, produtoBrinde] = await Promise.all([
      produtosRepo.buscar(dados.buyProductId),
      produtosRepo.buscar(dados.giftProductId)
    ]);
    if (!produtoCompra) throw naoEncontrado("Produto de compra nao encontrado.");
    if (!produtoBrinde) throw naoEncontrado("Produto de brinde nao encontrado.");

    const brinde = await promocoesRepo.salvarBrinde({ ...dados, id: uid("brinde") });
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "promocao_brinde_salva",
      entidade: "promocao_brinde", entidadeId: brinde.id,
      detalhes: {
        comprando: produtoCompra.name,
        quantidadeCompra: brinde.buyQty,
        ganha: produtoBrinde.name,
        quantidadeBrinde: brinde.giftQty,
        ate: brinde.until || ""
      },
      ip
    });
    publicar("promocoes", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return brinde;
  },

  async removerBrinde(id, { usuario, ip }) {
    if (!(await promocoesRepo.removerBrinde(id))) throw naoEncontrado("Promocao leve e ganhe nao encontrada.");
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "promocao_brinde_encerrada",
      entidade: "promocao_brinde", entidadeId: id, ip
    });
    publicar("promocoes", [CANAL.PUBLICO, CANAL.OPERACAO]);
  }
};
