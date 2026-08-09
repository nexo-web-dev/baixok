/* Acesso a `pedidos` e `pedido_itens`.
 *
 * Os itens viraram linhas proprias. Antes eram um array JSON dentro do pedido,
 * e por isso "mais vendidos do mes" obrigava a carregar todos os pedidos do
 * periodo para dentro do navegador e percorrer na mao. Agora o agrupamento e
 * uma consulta.
 *
 * Nota da migracao para o Postgres: `criado_em` agora e TIMESTAMPTZ, e nao mais
 * texto. Isso corrige de vez um bug que o SQLite escondia — o INSERT gravava
 * ISO ("2026-08-06T22:29:13.735Z") e os relatorios filtravam com espaco
 * ("2026-08-06 22:30:43"). Como o SQLite compara data como texto e 'T' > ' ',
 * `criado_em <= ate` dava falso sempre e o dashboard mostrava zero pedidos
 * mesmo com a loja vendendo. Agora quem compara e o Postgres, com tipo de data
 * de verdade. */
import { todos, um, alteradas, paraBanco, doBanco } from "../db/postgres.js";

const telefoneDigits = valor => {
  const digits = String(valor || "").replace(/\D/g, "");
  return digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
};

const paraApi = (linha, itens = []) => linha && ({
  id: linha.id,
  createdAt: linha.criado_em,
  status: linha.status,
  channel: linha.canal,
  fulfillment: linha.modalidade,
  customer: linha.cliente,
  phone: linha.telefone,
  place: linha.local,
  note: linha.observacao,
  cancelReason: linha.motivo_cancelamento || "",
  payment: linha.pagamento,
  trocoPara: linha.troco_para,
  tableNumber: linha.mesa_n,
  subtotal: linha.subtotal,
  discount: linha.desconto,
  coupon: linha.cupom_code,
  deliveryFee: linha.taxa_entrega,
  deliveryKm: linha.entrega_km,
  deliveryZone: linha.entrega_faixa,
  total: linha.total,
  motoboy: linha.motoboy || "",
  printed: doBanco(linha.impresso),
  stockDeducted: doBanco(linha.estoque_baixado),
  createdBy: linha.criado_por,
  createdByName: linha.criado_por_nome ?? null,
  items: itens
});

const itemParaApi = linha => ({
  id: linha.produto_id,
  name: linha.nome,
  qty: linha.quantidade,
  price: linha.preco_unit
});

/* Uma consulta para os pedidos e uma para todos os itens desses pedidos.
 * Buscar os itens dentro de um `.map()` faria N+1 consultas — com o movimento
 * de um sabado, o painel abriria centenas delas a cada atualizacao. */
async function anexarItens(linhas) {
  if (!linhas.length) return [];
  const marcadores = linhas.map(() => "?").join(",");
  const itens = await todos(
    `SELECT * FROM pedido_itens WHERE pedido_id IN (${marcadores}) ORDER BY id`,
    linhas.map(linha => linha.id)
  );

  const porPedido = new Map();
  for (const item of itens) {
    if (!porPedido.has(item.pedido_id)) porPedido.set(item.pedido_id, []);
    porPedido.get(item.pedido_id).push(itemParaApi(item));
  }
  return linhas.map(linha => paraApi(linha, porPedido.get(linha.id) || []));
}

const SELECT_BASE = `
  SELECT p.*, u.nome AS criado_por_nome
    FROM pedidos p
    LEFT JOIN usuarios u ON u.id = p.criado_por
`;

export const pedidosRepo = {
  /* Os `::tipo` nos filtros opcionais sao obrigatorios: com o parametro nulo, o
   * Postgres nao deduz o tipo e recusa a consulta inteira. */
  async listar({ desde = null, ate = null, status = null, limite = 500 } = {}) {
    const linhas = await todos(`
      ${SELECT_BASE}
      WHERE (?::timestamptz IS NULL OR p.criado_em >= ?::timestamptz)
        AND (?::timestamptz IS NULL OR p.criado_em <= ?::timestamptz)
        AND (?::text IS NULL OR p.status = ?::text)
      ORDER BY p.criado_em DESC
      LIMIT ?
    `, [desde, desde, ate, ate, status, status, limite]);
    return anexarItens(linhas);
  },

  async listarAbertos() {
    const linhas = await todos(`
      ${SELECT_BASE}
      WHERE p.status IN ('novo', 'preparo', 'pronto')
      ORDER BY p.criado_em ASC
    `);
    return anexarItens(linhas);
  },

  /* Alimenta o telao do salao.
   *
   * Nome, situacao e itens — o que o cliente precisa para se reconhecer na
   * chamada e conferir o pedido. Telefone e endereco ficam de fora: e uma tela
   * virada para o salao inteiro, e quem fotografa a TV nao leva o cadastro de
   * ninguem junto. */
  async listarParaTelao() {
    const linhas = await todos(`
      SELECT id, cliente, status, criado_em, modalidade
        FROM pedidos
       WHERE status IN ('preparo', 'pronto')
       ORDER BY criado_em ASC
       LIMIT 40
    `);
    if (!linhas.length) return [];

    const marcadores = linhas.map(() => "?").join(",");
    const itens = await todos(
      `SELECT pedido_id, nome, quantidade FROM pedido_itens WHERE pedido_id IN (${marcadores}) ORDER BY id`,
      linhas.map(linha => linha.id)
    );

    const porPedido = new Map();
    for (const item of itens) {
      if (!porPedido.has(item.pedido_id)) porPedido.set(item.pedido_id, []);
      porPedido.get(item.pedido_id).push({ name: item.nome, qty: item.quantidade });
    }

    return linhas.map(linha => ({
      id: linha.id,
      customer: linha.cliente,
      status: linha.status,
      createdAt: linha.criado_em,
      fulfillment: linha.modalidade,
      items: porPedido.get(linha.id) || []
    }));
  },

  async buscar(id) {
    const linha = await um(`${SELECT_BASE} WHERE p.id = ?`, [id]);
    if (!linha) return null;
    return (await anexarItens([linha]))[0];
  },

  async listarDaMesa(mesaN) {
    const linhas = await todos(
      `${SELECT_BASE} WHERE p.mesa_n = ? AND p.status <> 'cancelado' ORDER BY p.criado_em ASC`,
      [mesaN]
    );
    return anexarItens(linhas);
  },

  async listarPorTelefone(telefone, limite = 5) {
    const digits = telefoneDigits(telefone);
    if (digits.length < 8) return [];

    const linhas = await todos(`
      ${SELECT_BASE}
      WHERE p.telefone_digits = ?
        AND p.status <> 'cancelado'
      ORDER BY p.criado_em DESC
      LIMIT ?
    `, [digits, limite]);
    return anexarItens(linhas);
  },

  /* Chamado sempre de dentro de emTransacao(): pedido e itens entram juntos ou
   * nao entram. Os itens vao num INSERT so — um por item seria uma ida a rede
   * por item, dentro da transacao, com a linha do produto ja travada. */
  async inserir(pedido) {
    await alteradas(`
      INSERT INTO pedidos (
        id, criado_em, status, canal, modalidade, cliente, telefone, telefone_digits, local, observacao, motivo_cancelamento,
        pagamento, troco_para, mesa_n, subtotal, desconto, cupom_code, taxa_entrega, entrega_km,
        entrega_faixa, total, motoboy, impresso, estoque_baixado, criado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      pedido.id, pedido.createdAt, pedido.status, pedido.channel, pedido.fulfillment,
      pedido.customer, pedido.phone, telefoneDigits(pedido.phone), pedido.place, pedido.note, pedido.cancelReason || "",
      pedido.payment, pedido.trocoPara ?? null, pedido.tableNumber ?? null, pedido.subtotal, pedido.discount, pedido.coupon,
      pedido.deliveryFee, pedido.deliveryKm ?? null, pedido.deliveryZone ?? null,
      pedido.total, pedido.motoboy || "", paraBanco(pedido.printed), paraBanco(pedido.stockDeducted),
      pedido.createdBy ?? null
    ]);

    if (pedido.items.length) {
      const valores = [];
      const marcadores = pedido.items.map(item => {
        valores.push(pedido.id, item.id, item.name, item.qty, item.price);
        return "(?, ?, ?, ?, ?)";
      }).join(", ");

      await alteradas(`
        INSERT INTO pedido_itens (pedido_id, produto_id, nome, quantidade, preco_unit)
        VALUES ${marcadores}
      `, valores);
    }

    return this.buscar(pedido.id);
  },

  async atualizarStatus(id, status) {
    await alteradas("UPDATE pedidos SET status = ?, atualizado_em = now() WHERE id = ?", [status, id]);
    return this.buscar(id);
  },

  async cancelar(id, motivo) {
    await alteradas(
      "UPDATE pedidos SET status = 'cancelado', motivo_cancelamento = ?, atualizado_em = now() WHERE id = ?",
      [motivo, id]
    );
    return this.buscar(id);
  },

  async resumoCancelados({ desde, ate, canal = null }) {
    return await um(`
      SELECT COUNT(*)::int AS pedidos,
             COALESCE(SUM(total), 0) AS valor
        FROM pedidos
       WHERE criado_em >= ?::timestamptz AND criado_em <= ?::timestamptz
         AND status = 'cancelado'
         AND (?::text IS NULL OR canal = ?::text)
    `, [desde, ate, canal, canal]);
  },

  async definirMotoboy(id, motoboy) {
    await alteradas("UPDATE pedidos SET motoboy = ?, atualizado_em = now() WHERE id = ?", [motoboy, id]);
    return this.buscar(id);
  },

  async marcarImpresso(id) {
    await alteradas("UPDATE pedidos SET impresso = 1, atualizado_em = now() WHERE id = ?", [id]);
  },

  async marcarEstoqueDevolvido(id) {
    await alteradas("UPDATE pedidos SET estoque_baixado = 0, atualizado_em = now() WHERE id = ?", [id]);
  },

  // ------------------------------------------------------------ relatorios ---
  /* Agregacoes rodam no banco. O dashboard antigo baixava todos os pedidos e
   * somava em JavaScript a cada troca de periodo.
   *
   * Os `::int` nos COUNT e SUM de inteiro nao sao decoracao: no Postgres eles
   * devolvem BIGINT, que chegaria como numero grande e, em SUM de quantidade,
   * como valor que o front trata como texto na hora de somar.
   *
   * So pedido entregue entra no caixa: novo/preparo/pronto ainda podem mudar,
   * entao nao podem inflar dashboard, fechamento ou exportacao. */
  async resumoPeriodo({ desde, ate, canal = null }) {
    return await um(`
      SELECT COUNT(*)::int AS pedidos,
             COALESCE(SUM(total), 0) AS faturamento,
             COALESCE(AVG(total), 0) AS ticket_medio,
             COALESCE(SUM(desconto), 0) AS descontos,
             COALESCE(SUM(taxa_entrega), 0) AS taxas_entrega
        FROM pedidos
       WHERE criado_em >= ?::timestamptz AND criado_em <= ?::timestamptz
         AND status = 'entregue'
         AND (?::text IS NULL OR canal = ?::text)
    `, [desde, ate, canal, canal]);
  },

  /* to_char no lugar do strftime, que so existe no SQLite. Roda no fuso da
   * sessao (UTC no Supabase), igual ao que o codigo ja assumia. */
  async porHora({ desde, ate, canal = null }) {
    return await todos(`
      SELECT to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'HH24') AS hora,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(total), 0) AS faturamento
        FROM pedidos
       WHERE criado_em >= ?::timestamptz AND criado_em <= ?::timestamptz AND status = 'entregue'
         AND (?::text IS NULL OR canal = ?::text)
       GROUP BY hora ORDER BY hora
    `, [desde, ate, canal, canal]);
  },

  async porDia({ desde, ate, canal = null }) {
    return await todos(`
      SELECT to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM') AS rotulo,
             MIN((criado_em AT TIME ZONE 'America/Sao_Paulo')::date) AS data_ordem,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(total), 0) AS faturamento
        FROM pedidos
       WHERE criado_em >= ?::timestamptz AND criado_em <= ?::timestamptz AND status = 'entregue'
         AND (?::text IS NULL OR canal = ?::text)
       GROUP BY rotulo
       ORDER BY data_ordem
    `, [desde, ate, canal, canal]);
  },

  async agruparPor(coluna, { desde, ate, canal = null }) {
    /* Lista fechada: `coluna` vem do controller e nunca e concatenada sem passar
     * por aqui. Nome de coluna nao pode ser parametro em SQL, entao a unica
     * defesa possivel e a lista branca. */
    const PERMITIDAS = { canal: "canal", modalidade: "modalidade", pagamento: "pagamento", status: "status" };
    const campo = PERMITIDAS[coluna];
    if (!campo) throw new Error(`agrupamento nao permitido: ${coluna}`);

    return await todos(`
      SELECT ${campo} AS rotulo, COUNT(*)::int AS pedidos, COALESCE(SUM(total), 0) AS faturamento
        FROM pedidos
       WHERE criado_em >= ?::timestamptz AND criado_em <= ?::timestamptz AND status = 'entregue'
         AND (?::text IS NULL OR canal = ?::text)
       GROUP BY ${campo} ORDER BY faturamento DESC
    `, [desde, ate, canal, canal]);
  },

  async maisVendidos({ desde, ate, canal = null, limite = 10 }) {
    return await todos(`
      SELECT i.nome AS rotulo,
             SUM(i.quantidade)::int AS quantidade,
             SUM(i.quantidade * i.preco_unit) AS faturamento
        FROM pedido_itens i
        JOIN pedidos p ON p.id = i.pedido_id
       WHERE p.criado_em >= ?::timestamptz AND p.criado_em <= ?::timestamptz AND p.status = 'entregue'
         AND (?::text IS NULL OR p.canal = ?::text)
       GROUP BY i.nome
       ORDER BY quantidade DESC
       LIMIT ?
    `, [desde, ate, canal, canal, limite]);
  },

  async menosVendidos({ desde, ate, canal = null, limite = 10 }) {
    return await todos(`
      SELECT i.nome AS rotulo,
             SUM(i.quantidade)::int AS quantidade,
             SUM(i.quantidade * i.preco_unit) AS faturamento
        FROM pedido_itens i
        JOIN pedidos p ON p.id = i.pedido_id
       WHERE p.criado_em >= ?::timestamptz AND p.criado_em <= ?::timestamptz AND p.status = 'entregue'
         AND (?::text IS NULL OR p.canal = ?::text)
       GROUP BY i.nome
       ORDER BY quantidade ASC, faturamento ASC, rotulo ASC
       LIMIT ?
    `, [desde, ate, canal, canal, limite]);
  }
};
