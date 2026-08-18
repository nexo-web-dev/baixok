import { todos, um, alteradas, paraBanco, doBanco } from "../db/postgres.js";

const paraApi = linha => linha && ({
  id: linha.id,
  name: linha.nome,
  category: linha.categoria,
  unit: linha.unidade,
  qty: Number(linha.quantidade),
  minQty: Number(linha.minimo),
  packageCost: Number(linha.custo_pacote || 0),
  packageQty: Number(linha.qtd_pacote || 0),
  /* Custo por unidade (R$/g, R$/ml, R$/un...) — o que a ficha tecnica do
   * produto usa pra chegar no CMV. Zero enquanto o pacote nao foi cadastrado. */
  unitCost: linha.qtd_pacote > 0 ? Math.round((linha.custo_pacote / linha.qtd_pacote) * 10000) / 10000 : 0,
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
      INSERT INTO insumos (nome, categoria, unidade, quantidade, minimo, custo_pacote, qtd_pacote, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [
      insumo.name,
      insumo.category || "Geral",
      insumo.unit || "un",
      insumo.qty,
      insumo.minQty,
      insumo.packageCost || 0,
      insumo.packageQty || 0,
      paraBanco(insumo.active)
    ]));
  },

  async atualizar(id, insumo) {
    return paraApi(await um(`
      UPDATE insumos
         SET nome = ?, categoria = ?, unidade = ?, quantidade = ?, minimo = ?,
             custo_pacote = ?, qtd_pacote = ?, ativo = ?, atualizado_em = now()
       WHERE id = ?
      RETURNING *
    `, [
      insumo.name,
      insumo.category || "Geral",
      insumo.unit || "un",
      insumo.qty,
      insumo.minQty,
      insumo.packageCost || 0,
      insumo.packageQty || 0,
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
