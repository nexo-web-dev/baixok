/* Acesso as tabelas `combos`, `combo_itens`, `combo_escolhas` e
 * `combo_escolha_opcoes`.
 *
 * Combo e um item vendavel proprio — aparece no cardapio como se fosse mais um
 * produto, com nome, foto e preco fechado. O estoque de verdade continua nos
 * produtos que o compoem; aqui so guardamos a receita.
 *
 * Duas coisas diferentes dentro do combo:
 * - `combo_itens`: produto fixo, sempre entra (ex: 1 hamburguer + 1 batata).
 * - `combo_escolhas`: o cliente escolhe UMA opcao entre varias na hora do
 *   pedido (ex: "Escolha o refrigerante"), cada opcao com seu acrescimo. */
import { todos, um, alteradas, paraBanco, doBanco, emTransacao } from "../db/postgres.js";

const paraApi = (linha, itens = [], escolhas = []) => linha && ({
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
  choices: escolhas.map(escolha => ({
    id: escolha.id,
    name: escolha.nome,
    options: (escolha.opcoes || []).map(opcao => ({
      productId: opcao.produto_id,
      name: opcao.produto_nome,
      extraPrice: opcao.preco_extra
    }))
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

async function buscarEscolhas(comboId) {
  const escolhas = await todos(`
    SELECT id, nome, ordem FROM combo_escolhas WHERE combo_id = ? ORDER BY ordem, id
  `, [comboId]);
  if (!escolhas.length) return [];

  const marcadores = escolhas.map(() => "?").join(",");
  const opcoes = await todos(`
    SELECT eo.id, eo.escolha_id, eo.produto_id, eo.preco_extra, p.nome AS produto_nome
      FROM combo_escolha_opcoes eo
      JOIN produtos p ON p.id = eo.produto_id
     WHERE eo.escolha_id IN (${marcadores})
     ORDER BY eo.id
  `, escolhas.map(escolha => escolha.id));

  const porEscolha = new Map();
  for (const opcao of opcoes) {
    if (!porEscolha.has(opcao.escolha_id)) porEscolha.set(opcao.escolha_id, []);
    porEscolha.get(opcao.escolha_id).push(opcao);
  }
  return escolhas.map(escolha => ({ ...escolha, opcoes: porEscolha.get(escolha.id) || [] }));
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

/* Apaga e recria — mais simples que sincronizar id a id, e a quantidade de
 * escolhas por combo e sempre pequena (uma ou duas). */
async function definirEscolhas(comboId, escolhas) {
  await alteradas(`
    DELETE FROM combo_escolha_opcoes WHERE escolha_id IN (SELECT id FROM combo_escolhas WHERE combo_id = ?)
  `, [comboId]);
  await alteradas("DELETE FROM combo_escolhas WHERE combo_id = ?", [comboId]);

  for (const [indice, escolha] of escolhas.entries()) {
    const linha = await um(`
      INSERT INTO combo_escolhas (combo_id, nome, ordem) VALUES (?, ?, ?) RETURNING id
    `, [comboId, escolha.name, indice + 1]);

    if (!escolha.options.length) continue;
    const valores = [];
    const marcadores = escolha.options.map(opcao => {
      valores.push(linha.id, opcao.productId, opcao.extraPrice || 0);
      return "(?, ?, ?)";
    }).join(", ");
    await alteradas(`INSERT INTO combo_escolha_opcoes (escolha_id, produto_id, preco_extra) VALUES ${marcadores}`, valores);
  }
}

export const combosRepo = {
  async listar() {
    const linhas = await todos("SELECT * FROM combos ORDER BY ordem ASC, nome ASC");
    const resultado = [];
    for (const linha of linhas) resultado.push(paraApi(linha, await buscarItens(linha.id), await buscarEscolhas(linha.id)));
    return resultado;
  },

  async listarPublico() {
    const linhas = await todos("SELECT * FROM combos WHERE ativo = 1 ORDER BY ordem ASC, nome ASC");
    const resultado = [];
    for (const linha of linhas) resultado.push(paraApi(linha, await buscarItens(linha.id), await buscarEscolhas(linha.id)));
    return resultado;
  },

  async buscar(id) {
    const linha = await um("SELECT * FROM combos WHERE id = ?", [id]);
    if (!linha) return null;
    return paraApi(linha, await buscarItens(id), await buscarEscolhas(id));
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
      await definirEscolhas(combo.id, combo.choices || []);
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
      await definirEscolhas(id, combo.choices || []);
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
