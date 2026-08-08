/* Acesso a tabela `produtos`.
 *
 * Sobre os nomes: as colunas seguem o vocabulario do dominio em portugues, mas
 * o contrato da API mantem os nomes que o front ja usava (name, minStock,
 * active...). O de-para vive aqui, que e justamente o papel do repositorio —
 * trocar o esquema do banco depois nao obriga a mexer em tela nenhuma.
 *
 * Portado do node:sqlite para o Postgres do Supabase. Tres mudancas que se
 * repetem em todos os repositorios:
 *
 * 1. Tudo virou async. O SQLite embutido respondia na hora; o Postgres responde
 *    pela rede.
 * 2. `.changes` virou `alteradas()`, que devolve o rowCount.
 * 3. Escrita usa RETURNING no lugar de gravar e reler. No SQLite a releitura era
 *    de graca; aqui cada consulta e uma ida a rede, e RETURNING corta metade
 *    delas em toda operacao de escrita. */
import { todos, um, alteradas, paraBanco, doBanco } from "../db/postgres.js";

const paraApi = linha => linha && ({
  id: linha.id,
  name: linha.nome,
  category: linha.categoria,
  price: linha.preco,
  stock: linha.estoque,
  minStock: linha.estoque_min,
  order: linha.ordem ?? 9999,
  active: doBanco(linha.ativo),
  image: linha.imagem,
  badge: linha.selo,
  description: linha.descricao,
  createdAt: linha.criado_em,
  updatedAt: linha.atualizado_em
});

export const produtosRepo = {
  async listar() {
    return (await todos("SELECT * FROM produtos ORDER BY ordem ASC, categoria, nome")).map(paraApi);
  },

  /* Cardapio publico: so o que esta a venda, e sem estoque_min nem custo —
   * quantas unidades restam e informacao de operacao, nao de vitrine. */
  async listarPublico() {
    const linhas = await todos(`
      SELECT id, nome, categoria, preco, imagem, selo, descricao, estoque, ordem
        FROM produtos
       WHERE ativo = 1 AND estoque > 0
       ORDER BY ordem ASC, categoria, nome
    `);
    return linhas.map(linha => ({
      id: linha.id,
      name: linha.nome,
      category: linha.categoria,
      price: linha.preco,
      image: linha.imagem,
      badge: linha.selo,
      description: linha.descricao,
      order: linha.ordem ?? 9999,
      disponivel: linha.estoque > 0
    }));
  },

  async buscar(id) {
    return paraApi(await um("SELECT * FROM produtos WHERE id = ?", [id]));
  },

  async criar(produto) {
    const ordem = produto.order || (await um("SELECT COALESCE(MAX(ordem), 0) + 1 AS proxima FROM produtos"))?.proxima || 1;
    return paraApi(await um(`
      INSERT INTO produtos (id, nome, categoria, preco, estoque, estoque_min, ordem, ativo, imagem, selo, descricao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [
      produto.id, produto.name, produto.category, produto.price,
      produto.stock, produto.minStock, ordem, paraBanco(produto.active),
      produto.image, produto.badge, produto.description
    ]));
  },

  async atualizar(id, produto) {
    return paraApi(await um(`
      UPDATE produtos
         SET nome = ?, categoria = ?, preco = ?, estoque = ?, estoque_min = ?, ordem = ?,
             ativo = ?, imagem = ?, selo = ?, descricao = ?, atualizado_em = now()
       WHERE id = ?
      RETURNING *
    `, [
      produto.name, produto.category, produto.price, produto.stock, produto.minStock,
      produto.order || 9999,
      paraBanco(produto.active), produto.image, produto.badge, produto.description, id
    ]));
  },

  async reordenarIds(ids) {
    for (const [indice, id] of ids.entries()) {
      await alteradas("UPDATE produtos SET ordem = ?, atualizado_em = now() WHERE id = ?", [indice + 1, id]);
    }
  },

  async remover(id) {
    return (await alteradas("DELETE FROM produtos WHERE id = ?", [id])) > 0;
  },

  async alternarAtivo(id) {
    return paraApi(await um(`
      UPDATE produtos
         SET ativo = CASE ativo WHEN 1 THEN 0 ELSE 1 END, atualizado_em = now()
       WHERE id = ?
      RETURNING *
    `, [id]));
  },

  /* Ajuste manual de estoque, com piso em zero na propria consulta: um clique a
   * mais no "-" nao pode deixar estoque negativo.
   *
   * GREATEST e nao MAX: no Postgres, MAX e funcao de agregacao e nao compara
   * dois valores numa linha — usar MAX aqui daria erro de sintaxe. */
  async ajustarEstoque(id, delta) {
    return paraApi(await um(`
      UPDATE produtos
         SET estoque = GREATEST(0, estoque + ?), atualizado_em = now()
       WHERE id = ?
      RETURNING *
    `, [delta, id]));
  },

  async definirEstoque(id, quantidade) {
    return paraApi(await um(`
      UPDATE produtos SET estoque = ?, atualizado_em = now() WHERE id = ?
      RETURNING *
    `, [Math.max(0, quantidade), id]));
  },

  /* Usados dentro da transacao de pedido. O WHERE estoque >= ? faz a baixa e a
   * conferencia virarem um passo so: se outro pedido levou o ultimo item entre
   * uma coisa e outra, `alteradas` volta 0 e a transacao inteira e desfeita.
   *
   * Continua valendo no Postgres: dentro da transacao, o UPDATE trava a linha
   * ate o commit, entao o segundo pedido espera e ve o estoque ja baixado. */
  async baixarEstoque(id, quantidade) {
    const n = await alteradas(
      "UPDATE produtos SET estoque = estoque - ?, atualizado_em = now() WHERE id = ? AND estoque >= ?",
      [quantidade, id, quantidade]
    );
    return n > 0;
  },

  async devolverEstoque(id, quantidade) {
    await alteradas(
      "UPDATE produtos SET estoque = estoque + ?, atualizado_em = now() WHERE id = ?",
      [quantidade, id]
    );
  },

  async emFalta() {
    return (await todos("SELECT * FROM produtos WHERE estoque <= estoque_min ORDER BY estoque ASC")).map(paraApi);
  }
};
