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
    const [promos, produtos] = await Promise.all([
      promocoesRepo.listarPublico(),
      produtosRepo.listarPublico()
    ]);
    const promocoes = new Map(promos.map(promo => [promo.productId, promo.price]));

    return produtos
      .filter(produto => !controlaEstoqueCategoria(produto.category) || produto.stock > 0)
      .map(({ stock: _stock, ...produto }) => ({
        ...produto,
        disponivel: true,
        precoOriginal: promocoes.has(produto.id) ? produto.price : null,
        price: promocoes.get(produto.id) ?? produto.price,
        emPromocao: promocoes.has(produto.id)
      }));
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

  async ajustarEstoque(id, { delta, valor }, { usuario, ip }) {
    const anterior = await this.buscar(id);
    if (!controlaEstoqueCategoria(anterior.category)) {
      throw new ErroApp("Estoque operacional e usado apenas para bebidas, refrigerantes e drinks.", 422, "estoque_nao_controlado");
    }
    const produto = valor !== undefined
      ? await produtosRepo.definirEstoque(id, valor)
      : await produtosRepo.ajustarEstoque(id, delta);

    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "estoque_ajustado",
      entidade: "produto", entidadeId: id,
      detalhes: { de: anterior.stock, para: produto.stock, nome: produto.name }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return produto;
  }
};

export const promocoesService = {
  listar: () => promocoesRepo.listar(),

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
  }
};
