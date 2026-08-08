import { insumosRepo } from "../repositories/insumos.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { naoEncontrado } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";

export const insumosService = {
  listar: () => insumosRepo.listar(),

  async buscar(id) {
    const insumo = await insumosRepo.buscar(id);
    if (!insumo) throw naoEncontrado("Insumo nao encontrado.");
    return insumo;
  },

  async criar(dados, { usuario, ip }) {
    const insumo = await insumosRepo.criar(dados);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "insumo_criado",
      entidade: "insumo", entidadeId: insumo.id,
      detalhes: { nome: insumo.name, quantidade: insumo.qty, unidade: insumo.unit }, ip
    });
    publicar("insumos", [CANAL.OPERACAO]);
    return insumo;
  },

  async atualizar(id, dados, { usuario, ip }) {
    const anterior = await this.buscar(id);
    const insumo = await insumosRepo.atualizar(id, dados);
    if (!insumo) throw naoEncontrado("Insumo nao encontrado.");

    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "insumo_alterado",
      entidade: "insumo", entidadeId: id,
      detalhes: {
        nome: insumo.name,
        quantidade: { de: anterior.qty, para: insumo.qty },
        minimo: { de: anterior.minQty, para: insumo.minQty }
      }, ip
    });
    publicar("insumos", [CANAL.OPERACAO]);
    return insumo;
  },

  async ajustar(id, ajuste, { usuario, ip }) {
    const anterior = await this.buscar(id);
    const insumo = await insumosRepo.ajustar(id, ajuste);
    if (!insumo) throw naoEncontrado("Insumo nao encontrado.");

    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "insumo_estoque",
      entidade: "insumo", entidadeId: id,
      detalhes: { nome: insumo.name, de: anterior.qty, para: insumo.qty, unidade: insumo.unit }, ip
    });
    publicar("insumos", [CANAL.OPERACAO]);
    return insumo;
  },

  async remover(id, { usuario, ip }) {
    const insumo = await this.buscar(id);
    if (!(await insumosRepo.remover(id))) throw naoEncontrado("Insumo nao encontrado.");
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "insumo_removido",
      entidade: "insumo", entidadeId: id, detalhes: { nome: insumo.name }, ip
    });
    publicar("insumos", [CANAL.OPERACAO]);
  }
};
