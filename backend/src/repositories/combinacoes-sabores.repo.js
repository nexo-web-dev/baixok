/* Preco de cada combinacao de 2 sabores de pizza.
 *
 * Guardado sempre com produto_a_id < produto_b_id (ordem de string) — assim
 * "mussarela + calabresa" e "calabresa + mussarela" sao a mesma linha, e quem
 * le nunca precisa tentar as duas ordens. */
import { todos, um, alteradas } from "../db/postgres.js";

const normalizarPar = (idA, idB) => (idA < idB ? [idA, idB] : [idB, idA]);

const paraApi = linha => linha && ({
  produtoAId: linha.produto_a_id,
  produtoBId: linha.produto_b_id,
  nomeA: linha.nome_a,
  nomeB: linha.nome_b,
  preco: linha.preco
});

export const combinacoesSaboresRepo = {
  async listar() {
    const linhas = await todos(`
      SELECT c.*, a.nome AS nome_a, b.nome AS nome_b
        FROM combinacoes_sabores c
        JOIN produtos a ON a.id = c.produto_a_id
        JOIN produtos b ON b.id = c.produto_b_id
       ORDER BY a.nome, b.nome
    `);
    return linhas.map(paraApi);
  },

  async buscar(idA, idB) {
    const [a, b] = normalizarPar(idA, idB);
    const linha = await um("SELECT * FROM combinacoes_sabores WHERE produto_a_id = ? AND produto_b_id = ?", [a, b]);
    return paraApi(linha);
  },

  async salvar(idA, idB, preco) {
    const [a, b] = normalizarPar(idA, idB);
    await um(`
      INSERT INTO combinacoes_sabores (produto_a_id, produto_b_id, preco)
      VALUES (?, ?, ?)
      ON CONFLICT (produto_a_id, produto_b_id) DO UPDATE SET preco = excluded.preco, atualizado_em = now()
      RETURNING *
    `, [a, b, preco]);
    return this.buscar(a, b);
  },

  async remover(idA, idB) {
    const [a, b] = normalizarPar(idA, idB);
    return (await alteradas("DELETE FROM combinacoes_sabores WHERE produto_a_id = ? AND produto_b_id = ?", [a, b])) > 0;
  }
};
