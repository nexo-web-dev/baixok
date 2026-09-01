/* Acesso a tabela `promocoes`. Uma por produto, garantido pelo UNIQUE. */
import { todos, um, alteradas, doBanco, paraBanco } from "../db/postgres.js";

const paraApi = linha => linha && ({
  id: linha.id,
  productId: linha.produto_id,
  price: linha.preco,
  until: linha.ate,
  createdAt: linha.criado_em
});

const paraApiBrinde = linha => linha && ({
  id: linha.id,
  buyProductId: linha.produto_compra_id,
  giftProductId: linha.produto_brinde_id,
  buyQty: linha.quantidade_compra,
  giftQty: linha.quantidade_brinde,
  until: linha.ate,
  active: doBanco(linha.ativo),
  createdAt: linha.criado_em
});

export const promocoesRepo = {
  async listar() {
    return (await todos("SELECT * FROM promocoes ORDER BY criado_em DESC")).map(paraApi);
  },

  async listarBrindes() {
    return (await todos("SELECT * FROM promocoes_brindes ORDER BY criado_em DESC")).map(paraApiBrinde);
  },

  /* Cardapio publico: o preco promocional ja e aplicado na vitrine, entao o
   * cliente so precisa saber qual produto esta em promocao e por quanto. */
  async listarPublico() {
    const linhas = await todos("SELECT produto_id, preco FROM promocoes");
    return linhas.map(linha => ({ productId: linha.produto_id, price: linha.preco }));
  },

  async listarBrindesPublico() {
    return (await todos(`
      SELECT id, produto_compra_id, produto_brinde_id, quantidade_compra, quantidade_brinde, ate, ativo, criado_em
      FROM promocoes_brindes
      WHERE ativo = 1
      ORDER BY criado_em DESC
    `)).map(paraApiBrinde);
  },

  /* Pro resumo do dashboard: quantas promoções (preço) e brindes (compre X
   * leve Y) estão valendo AGORA — nao e recorte de periodo, e uma foto do
   * catalogo no instante. `ate = ''` e o sentinela de "sem validade" (ver
   * migracao 001); comparar como texto ISO (YYYY-MM-DD) funciona porque a
   * ordem lexicografica bate com a cronologica, sem risco do cast ::date
   * falhar num valor antigo fora do formato esperado. */
  async contarAtivas() {
    return await um(`
      SELECT
        (SELECT COUNT(*)::int FROM promocoes
          WHERE ate = '' OR ate >= to_char(now(), 'YYYY-MM-DD')) AS precos,
        (SELECT COUNT(*)::int FROM promocoes_brindes
          WHERE ativo = 1 AND (ate = '' OR ate >= to_char(now(), 'YYYY-MM-DD'))) AS brindes
    `);
  },

  async buscarPorProduto(produtoId) {
    return paraApi(await um("SELECT * FROM promocoes WHERE produto_id = ?", [produtoId]));
  },

  /* Substitui a promocao do produto se ja houver uma. O front antigo fazia isso
   * com `filter` + `unshift` no array inteiro; aqui e o UNIQUE do banco. */
  async salvar({ id, productId, price, until = "" }) {
    return paraApi(await um(`
      INSERT INTO promocoes (id, produto_id, preco, ate)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (produto_id) DO UPDATE SET preco = excluded.preco, ate = excluded.ate
      RETURNING *
    `, [id, productId, price, until]));
  },

  async salvarBrinde({ id, buyProductId, giftProductId, buyQty = 1, giftQty = 1, until = "", active = true }) {
    return paraApiBrinde(await um(`
      INSERT INTO promocoes_brindes (
        id, produto_compra_id, produto_brinde_id, quantidade_compra, quantidade_brinde, ate, ativo
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (produto_compra_id, produto_brinde_id) DO UPDATE SET
        quantidade_compra = excluded.quantidade_compra,
        quantidade_brinde = excluded.quantidade_brinde,
        ate = excluded.ate,
        ativo = excluded.ativo,
        atualizado_em = CURRENT_TIMESTAMP
      RETURNING *
    `, [id, buyProductId, giftProductId, buyQty, giftQty, until, paraBanco(active)]));
  },

  async remover(id) {
    return (await alteradas("DELETE FROM promocoes WHERE id = ?", [id])) > 0;
  },

  async removerBrinde(id) {
    return (await alteradas("DELETE FROM promocoes_brindes WHERE id = ?", [id])) > 0;
  }
};
