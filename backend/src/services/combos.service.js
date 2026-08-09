/* Regras de cadastro de combo. */
import { combosRepo } from "../repositories/combos.repo.js";
import { produtosRepo } from "../repositories/produtos.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { naoEncontrado, ErroApp } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";
import { uid } from "../lib/ids.js";

/* Confere que cada produto do combo existe antes de gravar — sem isso, um id
 * digitado errado so aparece quebrado na hora do cliente tentar pedir. */
async function validarItens(itens) {
  for (const item of itens) {
    const produto = await produtosRepo.buscar(item.productId);
    if (!produto) throw new ErroApp(`Produto do combo não encontrado.`, 400, "produto_invalido");
  }
}

export const combosService = {
  listar: () => combosRepo.listar(),
  listarPublico: () => combosRepo.listarPublico(),

  async buscar(id) {
    const combo = await combosRepo.buscar(id);
    if (!combo) throw naoEncontrado("Combo não encontrado.");
    return combo;
  },

  async criar(dados, { usuario, ip }) {
    await validarItens(dados.items);
    const combo = await combosRepo.criar({ ...dados, id: uid("combo") });
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "combo_criado",
      entidade: "combo", entidadeId: combo.id,
      detalhes: { nome: combo.name, preco: combo.price, itens: combo.items.length }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return combo;
  },

  async atualizar(id, dados, { usuario, ip }) {
    await this.buscar(id);
    await validarItens(dados.items);
    const combo = await combosRepo.atualizar(id, dados);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "combo_alterado",
      entidade: "combo", entidadeId: id,
      detalhes: { nome: combo.name, preco: combo.price, itens: combo.items.length }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return combo;
  },

  async alternarAtivo(id, { usuario, ip }) {
    await this.buscar(id);
    const combo = await combosRepo.alternarAtivo(id);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario,
      acao: combo.active ? "combo_ativado" : "combo_pausado",
      entidade: "combo", entidadeId: id, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return combo;
  },

  async remover(id, { usuario, ip }) {
    const combo = await this.buscar(id);
    if (!(await combosRepo.remover(id))) throw naoEncontrado("Combo não encontrado.");
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "combo_removido",
      entidade: "combo", entidadeId: id, detalhes: { nome: combo.name }, ip
    });
    publicar("produtos", [CANAL.PUBLICO, CANAL.OPERACAO]);
  }
};
