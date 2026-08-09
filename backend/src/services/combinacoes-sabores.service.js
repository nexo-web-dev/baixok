/* Regras de preco das combinacoes de 2 sabores de pizza. */
import { combinacoesSaboresRepo } from "../repositories/combinacoes-sabores.repo.js";
import { produtosRepo } from "../repositories/produtos.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { naoEncontrado, ErroApp } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";

async function exigirSaborPizza(id) {
  const produto = await produtosRepo.buscar(id);
  if (!produto) throw new ErroApp("Produto não encontrado.", 400, "produto_invalido");
  if (!produto.saborPizza) {
    throw new ErroApp(`${produto.name} não está marcado como sabor de pizza.`, 422, "nao_e_sabor_pizza");
  }
  return produto;
}

export const combinacoesSaboresService = {
  listar: () => combinacoesSaboresRepo.listar(),

  async salvar({ produtoAId, produtoBId, preco }, { usuario, ip }) {
    const [produtoA, produtoB] = await Promise.all([
      exigirSaborPizza(produtoAId),
      exigirSaborPizza(produtoBId)
    ]);

    const combinacao = await combinacoesSaboresRepo.salvar(produtoAId, produtoBId, preco);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "combinacao_sabor_salva",
      entidade: "combinacao_sabor", entidadeId: `${combinacao.produtoAId}+${combinacao.produtoBId}`,
      detalhes: { sabores: `${produtoA.name} + ${produtoB.name}`, preco }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return combinacao;
  },

  async remover(produtoAId, produtoBId, { usuario, ip }) {
    if (!(await combinacoesSaboresRepo.remover(produtoAId, produtoBId))) {
      throw naoEncontrado("Combinação não encontrada.");
    }
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "combinacao_sabor_removida",
      entidade: "combinacao_sabor", entidadeId: `${produtoAId}+${produtoBId}`, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
  }
};
