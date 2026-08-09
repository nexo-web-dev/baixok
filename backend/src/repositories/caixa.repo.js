import { todos, um, alteradas } from "../db/postgres.js";

const json = valor => {
  try { return valor ? JSON.parse(valor) : []; } catch { return []; }
};

const paraApi = linha => linha && ({
  id: linha.id,
  status: linha.status,
  abertoEm: linha.aberto_em,
  fechadoEm: linha.fechado_em,
  abertoPor: linha.aberto_por,
  abertoPorNome: linha.aberto_por_nome,
  fechadoPor: linha.fechado_por,
  fechadoPorNome: linha.fechado_por_nome,
  pedidos: linha.pedidos,
  faturamento: linha.faturamento,
  descontos: linha.descontos,
  taxasEntrega: linha.taxas_entrega,
  ticketMedio: linha.ticket_medio,
  cancelados: linha.cancelados,
  valorCancelado: linha.valor_cancelado,
  entregas: linha.entregas,
  retiradas: linha.retiradas,
  mesas: linha.mesas,
  pagamentos: json(linha.pagamentos),
  canais: json(linha.canais),
  modalidades: json(linha.modalidades),
  observacao: linha.observacao || ""
});

export const caixaRepo = {
  async atual() {
    return paraApi(await um(`
      SELECT * FROM caixa_fechamentos
       WHERE status = 'aberto'
       ORDER BY aberto_em DESC
       LIMIT 1
    `));
  },

  async listar({ limite = 100 } = {}) {
    const linhas = await todos(`
      SELECT * FROM caixa_fechamentos
       ORDER BY COALESCE(fechado_em, aberto_em) DESC
       LIMIT ?
    `, [limite]);
    return linhas.map(paraApi);
  },

  async buscar(id) {
    return paraApi(await um("SELECT * FROM caixa_fechamentos WHERE id = ?", [id]));
  },

  async abrir({ id, usuario }) {
    await alteradas(`
      INSERT INTO caixa_fechamentos (id, status, aberto_em, aberto_por, aberto_por_nome)
      VALUES (?, 'aberto', now(), ?, ?)
    `, [id, usuario.id, usuario.nome || usuario.usuario || ""]);
    return this.buscar(id);
  },

  async fechar(id, resumo, { usuario, observacao = "" }) {
    await alteradas(`
      UPDATE caixa_fechamentos
         SET status = 'fechado',
             fechado_em = ?::timestamptz,
             fechado_por = ?,
             fechado_por_nome = ?,
             pedidos = ?,
             faturamento = ?,
             descontos = ?,
             taxas_entrega = ?,
             ticket_medio = ?,
             cancelados = ?,
             valor_cancelado = ?,
             entregas = ?,
             retiradas = ?,
             mesas = ?,
             pagamentos = ?,
             canais = ?,
             modalidades = ?,
             observacao = ?,
             atualizado_em = now()
       WHERE id = ? AND status = 'aberto'
    `, [
      resumo.fechadoEm, usuario.id, usuario.nome || usuario.usuario || "",
      resumo.pedidos, resumo.faturamento, resumo.descontos, resumo.taxasEntrega, resumo.ticketMedio,
      resumo.cancelados, resumo.valorCancelado, resumo.entregas, resumo.retiradas, resumo.mesas,
      JSON.stringify(resumo.pagamentos), JSON.stringify(resumo.canais), JSON.stringify(resumo.modalidades),
      observacao, id
    ]);
    return this.buscar(id);
  }
};
