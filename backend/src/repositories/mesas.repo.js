/* Acesso a `mesas` e `mesa_itens`. */
import { todos, um, alteradas } from "../db/postgres.js";

const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function imagemProduto(linha) {
  const imagem = String(linha.produto_imagem || "").trim();
  if (!imagem) return "";
  if (DATA_IMAGE_RE.test(imagem)) {
    const versao = encodeURIComponent(linha.produto_atualizado_em || "");
    return `/api/publico/produtos/${encodeURIComponent(linha.produto_id)}/imagem${versao ? `?v=${versao}` : ""}`;
  }
  return imagem;
}

const paraApi = (linha, itens = []) => linha && ({
  n: linha.n,
  status: linha.status,
  openedAt: linha.aberta_em,
  closedAt: linha.fechada_em,
  items: itens
});

const itemParaApi = linha => ({
  id: linha.produto_id,
  name: linha.nome,
  qty: linha.quantidade,
  price: linha.preco_unit,
  image: imagemProduto(linha),
  orderId: linha.pedido_id
});

export const mesasRepo = {
  async listar() {
    const mesas = await todos("SELECT * FROM mesas ORDER BY n");
    if (!mesas.length) return [];

    /* Uma consulta para as mesas e uma para todos os itens. Buscar item dentro
     * do map faria N+1 — no SQLite ja era ruim, aqui cada uma seria uma ida a
     * rede. */
    const itens = await todos(`
      SELECT i.*, p.imagem AS produto_imagem, p.atualizado_em AS produto_atualizado_em
        FROM mesa_itens i
        LEFT JOIN produtos p ON p.id = i.produto_id
       ORDER BY i.id
    `);
    const porMesa = new Map();
    for (const item of itens) {
      if (!porMesa.has(item.mesa_n)) porMesa.set(item.mesa_n, []);
      porMesa.get(item.mesa_n).push(itemParaApi(item));
    }
    return mesas.map(mesa => paraApi(mesa, porMesa.get(mesa.n) || []));
  },

  /* O cliente que le o QR code precisa saber se a mesa esta aberta — e so isso.
   * A comanda dele vem por rota propria; o que a mesa 4 consumiu nao e assunto
   * de quem esta na mesa 7. */
  async listarPublico() {
    return await todos("SELECT n, status FROM mesas ORDER BY n");
  },

  async buscar(n) {
    const mesa = await um("SELECT * FROM mesas WHERE n = ?", [n]);
    if (!mesa) return null;
    const itens = await todos(`
      SELECT i.*, p.imagem AS produto_imagem, p.atualizado_em AS produto_atualizado_em
        FROM mesa_itens i
        LEFT JOIN produtos p ON p.id = i.produto_id
       WHERE i.mesa_n = ?
       ORDER BY i.id
    `, [n]);
    return paraApi(mesa, itens.map(itemParaApi));
  },

  async criar(n) {
    await alteradas("INSERT INTO mesas (n, status) VALUES (?, 'livre')", [n]);
    return this.buscar(n);
  },

  async proximoNumero() {
    const linha = await um("SELECT COALESCE(MAX(n), 0) AS maior FROM mesas");
    return linha.maior + 1;
  },

  async remover(n) {
    return (await alteradas("DELETE FROM mesas WHERE n = ?", [n])) > 0;
  },

  async abrir(n) {
    await alteradas(`
      UPDATE mesas
         SET status = 'aberta', aberta_em = now(), fechada_em = NULL, atualizado_em = now()
       WHERE n = ?
    `, [n]);
    return this.buscar(n);
  },

  async marcarFechando(n) {
    await alteradas("UPDATE mesas SET status = 'fechando', atualizado_em = now() WHERE n = ?", [n]);
    return this.buscar(n);
  },

  /* Liberar limpa a comanda: a mesa volta a zero para o proximo cliente. Os
   * itens continuam nos pedidos, que sao o registro contabil.
   *
   * As duas escritas precisam cair juntas — quem chama envolve em emTransacao. */
  async liberar(n) {
    await alteradas("DELETE FROM mesa_itens WHERE mesa_n = ?", [n]);
    await alteradas(`
      UPDATE mesas
         SET status = 'livre', aberta_em = NULL, fechada_em = now(), atualizado_em = now()
       WHERE n = ?
    `, [n]);
    return this.buscar(n);
  },

  /* Um INSERT so com todos os itens. No SQLite o laco custava quase nada; aqui
   * cada item viraria uma ida a rede dentro da transacao do pedido. */
  async adicionarItens(mesaN, pedidoId, itens) {
    if (!itens.length) return;

    const valores = [];
    const marcadores = itens.map(item => {
      valores.push(mesaN, pedidoId, item.id, item.name, item.qty, item.price);
      return "(?, ?, ?, ?, ?, ?)";
    }).join(", ");

    await alteradas(`
      INSERT INTO mesa_itens (mesa_n, pedido_id, produto_id, nome, quantidade, preco_unit)
      VALUES ${marcadores}
    `, valores);
  },

  async totalDaMesa(n) {
    const linha = await um(
      "SELECT COALESCE(SUM(quantidade * preco_unit), 0) AS subtotal FROM mesa_itens WHERE mesa_n = ?",
      [n]
    );
    return Number(linha.subtotal);
  }
};
