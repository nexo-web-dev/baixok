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

const LIMITE_IMAGEM_API = 180_000;
const DATA_IMAGE_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s;

function imagemParaApi(valor) {
  const imagem = String(valor || "");
  if (!imagem.startsWith("data:image/")) return imagem;
  return imagem.length <= LIMITE_IMAGEM_API ? imagem : "";
}

function temImagemEmbutida(linha) {
  return linha?.imagem_embutida === true
    || linha?.imagem_embutida === 1
    || linha?.imagem_embutida === "1"
    || linha?.imagem_embutida === "true";
}

function imagemPublica(linha) {
  if (!linha) return "";
  if (temImagemEmbutida(linha)) {
    const versao = encodeURIComponent(linha.atualizado_em || "");
    return `/api/publico/produtos/${encodeURIComponent(linha.id)}/imagem${versao ? `?v=${versao}` : ""}`;
  }
  const imagem = String(linha.imagem || "");
  if (!imagem) return "";
  if (DATA_IMAGE_RE.test(imagem)) {
    const versao = encodeURIComponent(linha.atualizado_em || "");
    return `/api/publico/produtos/${encodeURIComponent(linha.id)}/imagem${versao ? `?v=${versao}` : ""}`;
  }
  return imagem;
}

let suporteDestaque = null;

async function temDestaqueOrdem() {
  if (suporteDestaque !== null) return suporteDestaque;
  const linha = await um(`
    SELECT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'produtos'
         AND column_name = 'destaque_ordem'
    ) AS existe
  `);
  suporteDestaque = Boolean(linha?.existe);
  return suporteDestaque;
}

const paraApi = linha => linha && ({
  id: linha.id,
  name: linha.nome,
  category: linha.categoria,
  price: linha.preco,
  stock: linha.estoque,
  minStock: linha.estoque_min,
  order: linha.ordem ?? 9999,
  featuredOrder: linha.destaque_ordem ?? 0,
  active: doBanco(linha.ativo),
  image: imagemPublica(linha),
  badge: linha.selo,
  description: linha.descricao,
  createdAt: linha.criado_em,
  updatedAt: linha.atualizado_em
});

export const produtosRepo = {
  async listar() {
    const destaque = await temDestaqueOrdem();
    return (await todos(`
      SELECT id, nome, categoria, preco, estoque, estoque_min, ordem, ${destaque ? "destaque_ordem" : "0 AS destaque_ordem"},
             ativo,
             CASE
               WHEN imagem LIKE 'data:image/%' AND length(imagem) > ${LIMITE_IMAGEM_API} THEN ''
               ELSE imagem
             END AS imagem,
             imagem LIKE 'data:image/%;base64,%' AS imagem_embutida,
             selo, descricao, criado_em, atualizado_em
        FROM produtos
       ORDER BY ordem ASC, categoria, nome
    `)).map(paraApi);
  },

  /* Cardapio publico: so o que esta a venda, e sem estoque_min nem custo —
   * quantas unidades restam e informacao de operacao, nao de vitrine. */
  async listarPublico() {
    const destaque = await temDestaqueOrdem();
    const linhas = await todos(`
      SELECT id, nome, categoria, preco,
             CASE
               WHEN imagem LIKE 'data:image/%;base64,%' THEN ''
               ELSE imagem
             END AS imagem,
             imagem LIKE 'data:image/%;base64,%' AS imagem_embutida,
             selo, descricao, estoque, ordem, atualizado_em, ${destaque ? "destaque_ordem" : "0 AS destaque_ordem"}
        FROM produtos
       WHERE ativo = 1
       ORDER BY ordem ASC, categoria, nome
    `);
    return linhas.map(linha => ({
      id: linha.id,
      name: linha.nome,
      category: linha.categoria,
      price: linha.preco,
      image: linha.imagem_embutida ? imagemPublica(linha) : imagemParaApi(linha.imagem),
      badge: linha.selo,
      description: linha.descricao,
      order: linha.ordem ?? 9999,
      featuredOrder: linha.destaque_ordem ?? 0,
      stock: linha.estoque,
      disponivel: linha.estoque > 0
    }));
  },

  async buscar(id) {
    return paraApi(await um("SELECT * FROM produtos WHERE id = ?", [id]));
  },

  async imagemPublica(id) {
    const linha = await um("SELECT imagem, atualizado_em FROM produtos WHERE id = ?", [id]);
    const match = String(linha?.imagem || "").match(DATA_IMAGE_RE);
    if (!match) return null;
    return {
      contentType: match[1],
      buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64"),
      updatedAt: linha.atualizado_em
    };
  },

  async criar(produto) {
    const ordem = produto.order || (await um("SELECT COALESCE(MAX(ordem), 0) + 1 AS proxima FROM produtos"))?.proxima || 1;
    const destaque = await temDestaqueOrdem();
    if (!destaque) {
      return paraApi(await um(`
        INSERT INTO produtos (id, nome, categoria, preco, estoque, estoque_min, ordem, ativo, imagem, selo, descricao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [
        produto.id, produto.name, produto.category, produto.price,
        produto.stock, produto.minStock, ordem, paraBanco(produto.active),
        produto.image, produto.badge, produto.description
      ]));
    }
    return paraApi(await um(`
      INSERT INTO produtos (id, nome, categoria, preco, estoque, estoque_min, ordem, destaque_ordem, ativo, imagem, selo, descricao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [
      produto.id, produto.name, produto.category, produto.price,
      produto.stock, produto.minStock, ordem, produto.featuredOrder || 0, paraBanco(produto.active),
      produto.image, produto.badge, produto.description
    ]));
  },

  async atualizar(id, produto) {
    const destaque = await temDestaqueOrdem();
    if (!destaque) {
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
    }
    return paraApi(await um(`
      UPDATE produtos
         SET nome = ?, categoria = ?, preco = ?, estoque = ?, estoque_min = ?, ordem = ?, destaque_ordem = ?,
             ativo = ?, imagem = ?, selo = ?, descricao = ?, atualizado_em = now()
       WHERE id = ?
      RETURNING *
    `, [
      produto.name, produto.category, produto.price, produto.stock, produto.minStock,
      produto.order || 9999, produto.featuredOrder || 0,
      paraBanco(produto.active), produto.image, produto.badge, produto.description, id
    ]));
  },

  async definirDestaque(id, ordem) {
    if (!(await temDestaqueOrdem())) return this.buscar(id);
    const destaque = Math.max(0, Math.min(3, Number(ordem || 0)));
    if (destaque > 0) {
      await alteradas("UPDATE produtos SET destaque_ordem = 0, atualizado_em = now() WHERE destaque_ordem = ? AND id <> ?", [destaque, id]);
    }
    return paraApi(await um(`
      UPDATE produtos
         SET destaque_ordem = ?, atualizado_em = now()
       WHERE id = ?
      RETURNING *
    `, [destaque, id]));
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
