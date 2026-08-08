import { todos, um, alteradas, paraBanco, doBanco } from "../db/postgres.js";

const paraApi = linha => linha && ({
  id: linha.id,
  name: linha.nome,
  category: linha.categoria,
  unit: linha.unidade,
  qty: Number(linha.quantidade),
  minQty: Number(linha.minimo),
  active: doBanco(linha.ativo),
  createdAt: linha.criado_em,
  updatedAt: linha.atualizado_em
});

export const insumosRepo = {
  async listar() {
    return (await todos(`
      SELECT * FROM insumos
       ORDER BY ativo DESC, categoria, nome
    `)).map(paraApi);
  },

  async buscar(id) {
    return paraApi(await um("SELECT * FROM insumos WHERE id = ?", [id]));
  },

  async criar(insumo) {
    return paraApi(await um(`
      INSERT INTO insumos (nome, categoria, unidade, quantidade, minimo, ativo)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [
      insumo.name,
      insumo.category || "Geral",
      insumo.unit || "un",
      insumo.qty,
      insumo.minQty,
      paraBanco(insumo.active)
    ]));
  },

  async atualizar(id, insumo) {
    return paraApi(await um(`
      UPDATE insumos
         SET nome = ?, categoria = ?, unidade = ?, quantidade = ?, minimo = ?,
             ativo = ?, atualizado_em = now()
       WHERE id = ?
      RETURNING *
    `, [
      insumo.name,
      insumo.category || "Geral",
      insumo.unit || "un",
      insumo.qty,
      insumo.minQty,
      paraBanco(insumo.active),
      id
    ]));
  },

  async ajustar(id, { delta, valor }) {
    const sql = valor !== undefined
      ? "UPDATE insumos SET quantidade = ?, atualizado_em = now() WHERE id = ? RETURNING *"
      : "UPDATE insumos SET quantidade = GREATEST(0, quantidade + ?), atualizado_em = now() WHERE id = ? RETURNING *";
    return paraApi(await um(sql, [valor !== undefined ? valor : delta, id]));
  },

  async remover(id) {
    return (await alteradas("DELETE FROM insumos WHERE id = ?", [id])) > 0;
  }
};
