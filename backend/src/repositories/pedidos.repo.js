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

const paraApi = (linha, itens = [], pagamentos = []) => linha && ({
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
  naoPagoReason: linha.motivo_nao_pago || "",
  /* Cortesia e diferente de "Não pago": e a casa que decide de proposito nao
   * cobrar (presente), nao um calote. Pode ser so alguns itens — por isso o
   * valor fica somado aqui, e nao vira o `payment` inteiro como "Não pago"
   * vira (ver pedidosRepo.definirCortesia). */
  cortesiaValue: Number(linha.valor_cortesia || 0),
  cortesiaReason: linha.motivo_cortesia || "",
  payment: linha.pagamento,
  /* So preenchido quando pagamento = "Dividido" — cada parte com sua forma
   * e valor (ver pedidosService.definirPagamentoDividido). */
  paymentSplit: pagamentos,
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

function imagemCombo(linha) {
  const imagem = String(linha.combo_imagem || "").trim();
  return imagem;
}

const itemParaApi = linha => ({
  /* `id` sempre foi o produto (compatibilidade com o resto do app). `itemId` e
   * a linha em si (pedido_itens.id) — o unico jeito de mirar UMA linha pra
   * remover, ja que duas linhas podem apontar pro mesmo produto (um brinde e
   * uma compra normal do mesmo item, por exemplo). */
  id: linha.produto_id,
  itemId: linha.id,
  id2: linha.produto_id_2 || null,
  comboId: linha.combo_id || null,
  name: linha.nome,
  qty: linha.quantidade,
  price: linha.preco_unit,
  gift: doBanco(linha.brinde),
  cortesia: doBanco(linha.cortesia),
  image: linha.combo_id ? imagemCombo(linha) : imagemProduto(linha)
});

/* Uma consulta para os pedidos, uma para todos os itens e uma para os
 * pagamentos divididos desses pedidos. Buscar dentro de um `.map()` faria
 * N+1 consultas — com o movimento de um sabado, o painel abriria centenas
 * delas a cada atualizacao. */
async function anexarItens(linhas) {
  if (!linhas.length) return [];
  const marcadores = linhas.map(() => "?").join(",");
  const ids = linhas.map(linha => linha.id);

  const [itens, pagamentos] = await Promise.all([
    todos(
      `SELECT i.*, p.imagem AS produto_imagem, p.atualizado_em AS produto_atualizado_em, c.imagem AS combo_imagem
         FROM pedido_itens i
         LEFT JOIN produtos p ON p.id = i.produto_id
         LEFT JOIN combos c ON c.id = i.combo_id
        WHERE i.pedido_id IN (${marcadores})
        ORDER BY i.id`,
      ids
    ),
    todos(
      `SELECT pedido_id, forma, valor FROM pedido_pagamentos WHERE pedido_id IN (${marcadores}) ORDER BY id`,
      ids
    )
  ]);

  const itensPorPedido = new Map();
  for (const item of itens) {
    if (!itensPorPedido.has(item.pedido_id)) itensPorPedido.set(item.pedido_id, []);
    itensPorPedido.get(item.pedido_id).push(itemParaApi(item));
  }

  const pagamentosPorPedido = new Map();
  for (const pagamento of pagamentos) {
    if (!pagamentosPorPedido.has(pagamento.pedido_id)) pagamentosPorPedido.set(pagamento.pedido_id, []);
    pagamentosPorPedido.get(pagamento.pedido_id).push({ forma: pagamento.forma, valor: pagamento.valor });
  }

  return linhas.map(linha => paraApi(linha, itensPorPedido.get(linha.id) || [], pagamentosPorPedido.get(linha.id) || []));
}

const SELECT_BASE = `
  SELECT p.*, u.nome AS criado_por_nome
    FROM pedidos p
    LEFT JOIN usuarios u ON u.id = p.criado_por
`;

/* Fragmento de filtro compartilhado pelos relatorios: periodo (sempre
 * presente) + canal/pagamento (coluna do proprio pedido) + categoria (dos
 * itens — um pedido mistura categorias na mesma linha, entao so da pra
 * filtrar por EXISTS, nao por igualdade direta). `alias` e o prefixo da
 * tabela pedidos na consulta que usa o fragmento. Builder unico para nao
 * arriscar um WHERE diferente do outro em cada uma das 7 consultas que
 * compartilham esse recorte.
 *
 * O default e "pedidos", nunca "": sem qualificador, o `id` dentro do EXISTS
 * resolveria para pedido_itens.id (a subquery tem coluna `id` propria) em vez
 * do id do pedido de fora — comparacao de tipo errada (texto contra bigint) e
 * o filtro de categoria quebraria a consulta inteira. */
function filtroRelatorio({ desde, ate, canal = null, pagamento = null, categoria = null }, alias = "pedidos") {
  const p = `${alias}.`;
  return {
    sql: `
      ${p}criado_em >= ?::timestamptz AND ${p}criado_em <= ?::timestamptz
      AND (?::text IS NULL OR ${p}canal = ?::text)
      AND (?::text IS NULL OR ${p}pagamento = ?::text)
      AND (?::text IS NULL OR EXISTS (
        SELECT 1 FROM pedido_itens fi LEFT JOIN produtos fp ON fp.id = fi.produto_id
         WHERE fi.pedido_id = ${p}id
           AND COALESCE(fp.categoria, CASE WHEN fi.combo_id IS NOT NULL THEN 'combos' ELSE 'outros' END) = ?::text
      ))
    `,
    params: [desde, ate, canal, canal, pagamento, pagamento, categoria, categoria]
  };
}

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

  /* Enquanto a comanda esta aberta, todo pedido de mesa nasce com pagamento
   * "Pagar no balcao" — nunca foi forma de pagamento de verdade, so um
   * marcador de "ainda nao pago". No fechamento da conta, troca pelo que o
   * cliente realmente pagou.
   *
   * Por id explicito, nao por `mesa_n = ?`: a mesa e reaproveitada por
   * clientes diferentes ao longo do tempo, e `mesa_n` sozinho pegaria pedidos
   * de comandas antigas ja fechadas — reescrevendo pagamento de contas que
   * nao tem nada a ver com o fechamento de agora. */
  async definirPagamentoEmLote(ids, pagamento) {
    if (!ids.length) return;
    const marcadores = ids.map(() => "?").join(",");
    await alteradas(
      `UPDATE pedidos SET pagamento = ?, atualizado_em = now() WHERE id IN (${marcadores})`,
      [pagamento, ...ids]
    );
  },

  async definirMotivoNaoPago(id, motivo) {
    await alteradas(
      "UPDATE pedidos SET motivo_nao_pago = ?, atualizado_em = now() WHERE id = ?",
      [motivo, id]
    );
  },

  /* Grava as parcelas do pagamento dividido (substitui qualquer divisao
   * anterior do mesmo pedido) e marca pedidos.pagamento como "Dividido" —
   * mesmo marcador especial que "Não pago" ja usa, pra todo relatorio que
   * olha essa coluna direto saber que precisa ir atras da quebra por forma
   * em pedido_pagamentos em vez de somar aqui. */
  async definirPagamentoDividido(pedidoId, componentes) {
    await alteradas("DELETE FROM pedido_pagamentos WHERE pedido_id = ?", [pedidoId]);
    if (componentes.length) {
      const valores = [];
      const marcadores = componentes.map(componente => {
        valores.push(pedidoId, componente.forma, componente.valor);
        return "(?, ?, ?)";
      }).join(", ");
      await alteradas(
        `INSERT INTO pedido_pagamentos (pedido_id, forma, valor) VALUES ${marcadores}`,
        valores
      );
    }
    await alteradas(
      "UPDATE pedidos SET pagamento = 'Dividido', atualizado_em = now() WHERE id = ?",
      [pedidoId]
    );
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
        valores.push(
          pedido.id, item.id ?? null, item.id2 ?? null, item.comboId ?? null, item.name, item.qty, item.price,
          paraBanco(Boolean(item.gift))
        );
        return "(?, ?, ?, ?, ?, ?, ?, ?)";
      }).join(", ");

      await alteradas(`
        INSERT INTO pedido_itens (pedido_id, produto_id, produto_id_2, combo_id, nome, quantidade, preco_unit, brinde)
        VALUES ${marcadores}
      `, valores);
    }

    return this.buscar(pedido.id);
  },

  async atualizarStatus(id, status) {
    await alteradas("UPDATE pedidos SET status = ?, atualizado_em = now() WHERE id = ?", [status, id]);
    return this.buscar(id);
  },

  /* Mesmo INSERT de `inserir()`, mas pra um pedido que ja existe — cliente
   * pediu mais uma coisa por telefone, ou o balcao esqueceu de lancar algo. */
  async adicionarItens(pedidoId, itens) {
    if (!itens.length) return;
    const valores = [];
    const marcadores = itens.map(item => {
      valores.push(
        pedidoId, item.id ?? null, item.id2 ?? null, item.comboId ?? null, item.name, item.qty, item.price,
        paraBanco(Boolean(item.gift))
      );
      return "(?, ?, ?, ?, ?, ?, ?, ?)";
    }).join(", ");

    await alteradas(`
      INSERT INTO pedido_itens (pedido_id, produto_id, produto_id_2, combo_id, nome, quantidade, preco_unit, brinde)
      VALUES ${marcadores}
    `, valores);
  },

  /* Por id da linha, nao por produto: remover so pode mirar UMA linha, mesmo
   * que o pedido tenha duas entradas do mesmo produto (uma comprada, uma de
   * brinde, por exemplo). O `pedido_id` no WHERE e cinto de seguranca — sem
   * ele, um id de linha de outro pedido tambem bateria. */
  async removerItem(pedidoId, itemId) {
    return (await alteradas(
      "DELETE FROM pedido_itens WHERE id = ? AND pedido_id = ?",
      [itemId, pedidoId]
    )) > 0;
  },

  async atualizarTotais(id, { subtotal, total }) {
    await alteradas(
      "UPDATE pedidos SET subtotal = ?, total = ?, atualizado_em = now() WHERE id = ?",
      [subtotal, total, id]
    );
    return this.buscar(id);
  },

  async cancelar(id, motivo) {
    await alteradas(
      "UPDATE pedidos SET status = 'cancelado', motivo_cancelamento = ?, atualizado_em = now() WHERE id = ?",
      [motivo, id]
    );
    return this.buscar(id);
  },

  /* Apaga o pedido de vez. `pedido_itens` e `mesa_itens` caem junto por
   * ON DELETE CASCADE — nao precisa de segunda consulta aqui. */
  async remover(id) {
    return (await alteradas("DELETE FROM pedidos WHERE id = ?", [id])) > 0;
  },

  async resumoCancelados(filtro) {
    const f = filtroRelatorio(filtro);
    return await um(`
      SELECT COUNT(*)::int AS pedidos,
             COALESCE(SUM(total), 0) AS valor
        FROM pedidos
       WHERE ${f.sql} AND status = 'cancelado'
    `, f.params);
  },

  /* Marca os itens escolhidos (ou o pedido inteiro, se o service resolver
   * todos os itemIds) como cortesia e recalcula o valor de uma vez —
   * `valor_cortesia` fica denormalizado em `pedidos` de proposito, igual
   * `total` ja e: as consultas de faturamento so fazem `total - valor_cortesia`
   * em vez de recalcular via JOIN em pedido_itens a cada relatorio. */
  async definirCortesia(pedidoId, itemIds, motivo) {
    const marcadores = itemIds.map(() => "?").join(",");
    await alteradas(
      `UPDATE pedido_itens SET cortesia = 1 WHERE pedido_id = ? AND id IN (${marcadores})`,
      [pedidoId, ...itemIds]
    );
    await alteradas(`
      UPDATE pedidos
         SET valor_cortesia = (SELECT COALESCE(SUM(quantidade * preco_unit), 0) FROM pedido_itens WHERE pedido_id = ? AND cortesia = 1),
             motivo_cortesia = ?, atualizado_em = now()
       WHERE id = ?
    `, [pedidoId, motivo, pedidoId]);
    return this.buscar(pedidoId);
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
  async resumoPeriodo(filtro) {
    const f = filtroRelatorio(filtro);
    return await um(`
      SELECT COUNT(*)::int AS pedidos,
             COALESCE(SUM(total - valor_cortesia), 0) AS faturamento,
             COALESCE(AVG(total - valor_cortesia), 0) AS ticket_medio,
             COALESCE(SUM(desconto), 0) AS descontos,
             COALESCE(SUM(taxa_entrega), 0) AS taxas_entrega
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue' AND pagamento IS DISTINCT FROM 'Não pago'
    `, f.params);
  },

  /* Mesma ideia de resumoCancelados: pedido que saiu da loja (status entregue)
   * mas o cliente nao pagou. Fica de fora de toda conta de faturamento — nao e
   * dinheiro que entrou — e aparece separado aqui, como prejuizo. */
  async resumoNaoPago(filtro) {
    const f = filtroRelatorio(filtro);
    return await um(`
      SELECT COUNT(*)::int AS pedidos,
             COALESCE(SUM(total), 0) AS valor
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue' AND pagamento = 'Não pago'
    `, f.params);
  },

  /* So as 3 colunas que o relatorio de fechamento mostra na tabela de nao
   * pagos — direto na tabela pedidos, sem o JOIN de itens/produtos que
   * listar() sempre faz. O fechamento normalmente tem 1 ou 2 pedidos nao
   * pagos no meio de centenas; buscar tudo com foto e item so pra descartar
   * quase todos em JS era o gargalo real aqui. */
  async listarNaoPagos(filtro) {
    const f = filtroRelatorio(filtro);
    return await todos(`
      SELECT cliente, total, motivo_nao_pago AS motivo
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue' AND pagamento = 'Não pago'
       ORDER BY criado_em DESC
    `, f.params);
  },

  /* Cortesia nao e prejuizo (a casa deu de proposito), entao fica separada
   * de resumoNaoPago — mesma ideia, numero diferente. */
  async resumoCortesia(filtro) {
    const f = filtroRelatorio(filtro);
    return await um(`
      SELECT COUNT(*) FILTER (WHERE valor_cortesia > 0)::int AS pedidos,
             COALESCE(SUM(valor_cortesia), 0) AS valor
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue'
    `, f.params);
  },

  async listarCortesias(filtro) {
    const f = filtroRelatorio(filtro);
    return await todos(`
      SELECT cliente, valor_cortesia AS valor, motivo_cortesia AS motivo
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue' AND valor_cortesia > 0
       ORDER BY criado_em DESC
    `, f.params);
  },

  /* to_char no lugar do strftime, que so existe no SQLite. Roda no fuso da
   * sessao (UTC no Supabase), igual ao que o codigo ja assumia. */
  async porHora(filtro) {
    const f = filtroRelatorio(filtro);
    return await todos(`
      SELECT to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'HH24') AS hora,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(total - valor_cortesia), 0) AS faturamento
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue' AND pagamento IS DISTINCT FROM 'Não pago'
       GROUP BY hora ORDER BY hora
    `, f.params);
  },

  async porDia(filtro) {
    const f = filtroRelatorio(filtro);
    return await todos(`
      SELECT to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM') AS rotulo,
             MIN((criado_em AT TIME ZONE 'America/Sao_Paulo')::date) AS data_ordem,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(total - valor_cortesia), 0) AS faturamento
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue' AND pagamento IS DISTINCT FROM 'Não pago'
       GROUP BY rotulo
       ORDER BY data_ordem
    `, f.params);
  },

  /* Mesma ideia de porDia, agrupado por mes — e o que o filtro "Tudo" usa: com
   * o historico inteiro da loja, um grafico por dia vira uma lista ilegivel de
   * centenas de barras. */
  async porMes(filtro) {
    const f = filtroRelatorio(filtro);
    return await todos(`
      SELECT to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'MM/YYYY') AS rotulo,
             MIN(date_trunc('month', criado_em AT TIME ZONE 'America/Sao_Paulo')) AS mes_ordem,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(total - valor_cortesia), 0) AS faturamento
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue' AND pagamento IS DISTINCT FROM 'Não pago'
       GROUP BY rotulo
       ORDER BY mes_ordem
    `, f.params);
  },

  async agruparPor(coluna, filtro) {
    /* Lista fechada: `coluna` vem do controller e nunca e concatenada sem passar
     * por aqui. Nome de coluna nao pode ser parametro em SQL, entao a unica
     * defesa possivel e a lista branca. */
    const PERMITIDAS = { canal: "canal", modalidade: "modalidade", pagamento: "pagamento", status: "status" };
    const campo = PERMITIDAS[coluna];
    if (!campo) throw new Error(`agrupamento nao permitido: ${coluna}`);

    const f = filtroRelatorio(filtro);

    /* "pagamento" e especial: pedido "Dividido" nao tem UM total pra somar
     * nessa coluna — a quebra de verdade (quanto foi cartao, quanto foi Pix)
     * mora em pedido_pagamentos, uma linha por forma. Junta as duas fontes
     * antes de agrupar, senao "Dividido" aparecia como se fosse uma forma de
     * pagamento de verdade, e o valor de cada forma real ficava errado. So
     * pedido ja marcado "Dividido" tem linha em pedido_pagamentos, entao o
     * JOIN sozinho ja restringe ao que interessa aqui. */
    if (coluna === "pagamento") {
      return await todos(`
        SELECT forma AS rotulo, COUNT(*)::int AS pedidos, COALESCE(SUM(valor), 0) AS faturamento
          FROM (
            SELECT pagamento AS forma, (total - valor_cortesia) AS valor
              FROM pedidos
             WHERE ${f.sql} AND status = 'entregue' AND pagamento IS DISTINCT FROM 'Não pago' AND pagamento <> 'Dividido'
            UNION ALL
            SELECT pp.forma, pp.valor
              FROM pedido_pagamentos pp
              JOIN pedidos ON pedidos.id = pp.pedido_id
             WHERE ${f.sql} AND pedidos.status = 'entregue'
          ) combinado
         GROUP BY forma ORDER BY faturamento DESC
      `, [...f.params, ...f.params]);
    }

    return await todos(`
      SELECT ${campo} AS rotulo, COUNT(*)::int AS pedidos, COALESCE(SUM(total - valor_cortesia), 0) AS faturamento
        FROM pedidos
       WHERE ${f.sql} AND status = 'entregue' AND pagamento IS DISTINCT FROM 'Não pago'
       GROUP BY ${campo} ORDER BY faturamento DESC
    `, f.params);
  },

  /* Diferente de agruparPor: canal, pagamento etc. sao coluna do PEDIDO, mas
   * categoria e do ITEM — um pedido mistura pizza e drink na mesma linha, entao
   * o agrupamento precisa somar por item (pedido_itens), nao por pedido. Combo
   * nao tem produto_id (e um pacote, nao um produto do catalogo), entao cai
   * no rotulo "combos" em vez de ficar de fora da soma. Ja e item-level, entao
   * canal/pagamento entram pelo join com pedidos e categoria compara direto —
   * nao precisa do EXISTS que filtroRelatorio() usa pras consultas por pedido. */
  async porCategoria({ desde, ate, canal = null, pagamento = null, categoria = null }) {
    return await todos(`
      SELECT
        COALESCE(p.categoria, CASE WHEN i.combo_id IS NOT NULL THEN 'combos' ELSE 'outros' END) AS rotulo,
        COALESCE(SUM(CASE WHEN i.cortesia = 1 THEN 0 ELSE i.quantidade * i.preco_unit END), 0) AS faturamento,
        COALESCE(SUM(i.quantidade), 0)::int AS unidades
        FROM pedido_itens i
        JOIN pedidos ped ON ped.id = i.pedido_id
        LEFT JOIN produtos p ON p.id = i.produto_id
       WHERE ped.criado_em >= ?::timestamptz AND ped.criado_em <= ?::timestamptz AND ped.status = 'entregue'
         AND ped.pagamento IS DISTINCT FROM 'Não pago'
         AND (?::text IS NULL OR ped.canal = ?::text)
         AND (?::text IS NULL OR ped.pagamento = ?::text)
         AND (?::text IS NULL OR COALESCE(p.categoria, CASE WHEN i.combo_id IS NOT NULL THEN 'combos' ELSE 'outros' END) = ?::text)
       GROUP BY rotulo
       ORDER BY faturamento DESC
    `, [desde, ate, canal, canal, pagamento, pagamento, categoria, categoria]);
  },

  async porMotoboy(filtro) {
    const f = filtroRelatorio(filtro);
    return await todos(`
      SELECT btrim(motoboy) AS rotulo,
             COUNT(*)::int AS pedidos,
             COALESCE(SUM(total - valor_cortesia), 0) AS faturamento,
             COALESCE(SUM(taxa_entrega), 0) AS taxas_entrega
        FROM pedidos
       WHERE ${f.sql}
         AND status = 'entregue'
         AND pagamento IS DISTINCT FROM 'Não pago'
         AND modalidade = 'entrega'
         AND btrim(COALESCE(motoboy, '')) <> ''
       GROUP BY btrim(motoboy)
       ORDER BY pedidos DESC, faturamento DESC, rotulo ASC
    `, f.params);
  },

  async maisVendidos({ desde, ate, canal = null, pagamento = null, categoria = null, limite = 10 }) {
    return await todos(`
      SELECT i.nome AS rotulo,
             SUM(i.quantidade)::int AS quantidade,
             SUM(CASE WHEN i.cortesia = 1 THEN 0 ELSE i.quantidade * i.preco_unit END) AS faturamento
        FROM pedido_itens i
        JOIN pedidos p ON p.id = i.pedido_id
        LEFT JOIN produtos pr ON pr.id = i.produto_id
       WHERE p.criado_em >= ?::timestamptz AND p.criado_em <= ?::timestamptz AND p.status = 'entregue'
         AND p.pagamento IS DISTINCT FROM 'Não pago'
         AND (?::text IS NULL OR p.canal = ?::text)
         AND (?::text IS NULL OR p.pagamento = ?::text)
         AND (?::text IS NULL OR COALESCE(pr.categoria, CASE WHEN i.combo_id IS NOT NULL THEN 'combos' ELSE 'outros' END) = ?::text)
       GROUP BY i.nome
       ORDER BY quantidade DESC
       LIMIT ?
    `, [desde, ate, canal, canal, pagamento, pagamento, categoria, categoria, limite]);
  },

  async menosVendidos({ desde, ate, canal = null, pagamento = null, categoria = null, limite = 10 }) {
    return await todos(`
      SELECT i.nome AS rotulo,
             SUM(i.quantidade)::int AS quantidade,
             SUM(CASE WHEN i.cortesia = 1 THEN 0 ELSE i.quantidade * i.preco_unit END) AS faturamento
        FROM pedido_itens i
        JOIN pedidos p ON p.id = i.pedido_id
        LEFT JOIN produtos pr ON pr.id = i.produto_id
       WHERE p.criado_em >= ?::timestamptz AND p.criado_em <= ?::timestamptz AND p.status = 'entregue'
         AND p.pagamento IS DISTINCT FROM 'Não pago'
         AND (?::text IS NULL OR p.canal = ?::text)
         AND (?::text IS NULL OR p.pagamento = ?::text)
         AND (?::text IS NULL OR COALESCE(pr.categoria, CASE WHEN i.combo_id IS NOT NULL THEN 'combos' ELSE 'outros' END) = ?::text)
       GROUP BY i.nome
       ORDER BY quantidade ASC, faturamento ASC, rotulo ASC
       LIMIT ?
    `, [desde, ate, canal, canal, pagamento, pagamento, categoria, categoria, limite]);
  }
};
