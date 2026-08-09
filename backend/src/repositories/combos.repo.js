/* Acesso as tabelas `combos` e `combo_itens`.
 *
 * Combo e um item vendavel proprio — aparece no cardapio como se fosse mais um
 * produto, com nome, foto e preco fechado. O estoque de verdade continua nos
 * produtos que o compoem; aqui so guardamos a receita (quais produtos, em que
 * quantidade). */
import { todos, um, alteradas, paraBanco, doBanco, emTransacao } from "../db/postgres.js";

const paraApi = (linha, itens = []) => linha && ({
  id: linha.id,
  name: linha.nome,
  description: linha.descricao,
  price: linha.preco,
  image: linha.imagem,
  active: doBanco(linha.ativo),
  order: linha.ordem ?? 9999,
  items: itens.map(item => ({
    productId: item.produto_id,
    name: item.produto_nome,
    quantity: item.quantidade
  })),
  createdAt: linha.criado_em,
  updatedAt: linha.atualizado_em
});

async function buscarItens(comboId) {
  return todos(`
    SELECT ci.produto_id, ci.quantidade, p.nome AS produto_nome
      FROM combo_itens ci
      JOIN produtos p ON p.id = ci.produto_id
     WHERE ci.combo_id = ?
     ORDER BY ci.id
  `, [comboId]);
}

async function definirItens(comboId, itens) {
  await alteradas("DELETE FROM combo_itens WHERE combo_id = ?", [comboId]);
  if (!itens.length) return;
  const valores = [];
  const marcadores = itens.map(item => {
    valores.push(comboId, item.productId, item.quantity);
    return "(?, ?, ?)";
  }).join(", ");
  await alteradas(`INSERT INTO combo_itens (combo_id, produto_id, quantidade) VALUES ${marcadores}`, valores);
}

export const combosRepo = {
  async listar() {
    const linhas = await todos("SELECT * FROM combos ORDER BY ordem ASC, nome ASC");
    const resultado = [];
    for (const linha of linhas) resultado.push(paraApi(linha, await buscarItens(linha.id)));
    return resultado;
  },

  async listarPublico() {
    const linhas = await todos("SELECT * FROM combos WHERE ativo = 1 ORDER BY ordem ASC, nome ASC");
    const resultado = [];
    for (const linha of linhas) resultado.push(paraApi(linha, await buscarItens(linha.id)));
    return resultado;
  },

  async buscar(id) {
    const linha = await um("SELECT * FROM combos WHERE id = ?", [id]);
    if (!linha) return null;
    return paraApi(linha, await buscarItens(id));
  },

  /* Componentes crus (sem nome), usados na hora de baixar/devolver estoque —
   * quem chama ja tem os produtos carregados e nao precisa do join. */
  async itensCrus(comboId) {
    return todos("SELECT produto_id, quantidade FROM combo_itens WHERE combo_id = ?", [comboId]);
  },

  async criar(combo) {
    return emTransacao(async () => {
      await um(`
        INSERT INTO combos (id, nome, descricao, preco, imagem, ativo, ordem)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [combo.id, combo.name, combo.description, combo.price, combo.image, paraBanco(combo.active), combo.order || 9999]);
      await definirItens(combo.id, combo.items);
      return this.buscar(combo.id);
    });
  },

  async atualizar(id, combo) {
    return emTransacao(async () => {
      await alteradas(`
        UPDATE combos
           SET nome = ?, descricao = ?, preco = ?, imagem = ?, ativo = ?, ordem = ?, atualizado_em = now()
         WHERE id = ?
      `, [combo.name, combo.description, combo.price, combo.image, paraBanco(combo.active), combo.order || 9999, id]);
      await definirItens(id, combo.items);
      return this.buscar(id);
    });
  },

  async alternarAtivo(id) {
    await alteradas("UPDATE combos SET ativo = CASE ativo WHEN 1 THEN 0 ELSE 1 END, atualizado_em = now() WHERE id = ?", [id]);
    return this.buscar(id);
  },

  async remover(id) {
    return (await alteradas("DELETE FROM combos WHERE id = ?", [id])) > 0;
  }
};
