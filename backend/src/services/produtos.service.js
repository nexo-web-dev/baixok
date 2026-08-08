/* Regras de cadastro de produto e estoque. */
import { produtosRepo } from "../repositories/produtos.repo.js";
import { promocoesRepo } from "../repositories/promocoes.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { naoEncontrado, ErroApp } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";
import { uid } from "../lib/ids.js";
import { emTransacao } from "../db/postgres.js";

const SELO_POR_CATEGORIA = {
  pizzas: "Pizza", burgues: "Burguer", massas: "Massa", drinks: "Drink", porcoes: "Porcao"
};

export const produtosService = {
  listar: () => produtosRepo.listar(),
  emFalta: () => produtosRepo.emFalta(),

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

    return produtos.map(produto => ({
      ...produto,
      precoOriginal: promocoes.has(produto.id) ? produto.price : null,
      price: promocoes.get(produto.id) ?? produto.price,
      emPromocao: promocoes.has(produto.id)
    }));
  },

  async buscar(id) {
    const produto = await produtosRepo.buscar(id);
    if (!produto) throw naoEncontrado("Produto nao encontrado.");
    return produto;
  },

  async criar(dados, { usuario, ip }) {
    const produto = await produtosRepo.criar({
      ...dados,
      id: uid("prod"),
      badge: SELO_POR_CATEGORIA[dados.category] || "Item"
    });
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "produto_criado",
      entidade: "produto", entidadeId: produto.id, detalhes: { nome: produto.name, preco: produto.price }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return produto;
  },

  async atualizar(id, dados, { usuario, ip }) {
    const anterior = await this.buscar(id);
    const produto = await produtosRepo.atualizar(id, {
      ...dados,
      badge: SELO_POR_CATEGORIA[dados.category] || "Item"
    });

    /* A auditoria guarda o que mudou, nao o objeto inteiro: um relatorio de
     * "quem baixou o preco da pizza?" fica legivel. */
    const mudancas = Object.fromEntries(
      Object.entries(dados)
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
    if (indice === -1) throw naoEncontrado("Produto nao encontrado.");

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
    if (!(await produtosRepo.remover(id))) throw naoEncontrado("Produto nao encontrado.");
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
    if (!produto) throw naoEncontrado("Produto nao encontrado.");

    /* Regra que o schema nao consegue expressar: depende do preco cadastrado.
     * O painel antigo checava isso so na tela, entao uma chamada direta a API
     * criava "promocao" mais cara que o preco cheio. */
    if (dados.price >= produto.price) {
      throw new ErroApp(
        `O preco promocional precisa ser menor que R$ ${produto.price.toFixed(2)}.`,
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
    if (!(await promocoesRepo.remover(id))) throw naoEncontrado("Promocao nao encontrada.");
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "promocao_encerrada",
      entidade: "promocao", entidadeId: id, ip
    });
    publicar("promocoes", [CANAL.PUBLICO, CANAL.OPERACAO]);
  }
};
