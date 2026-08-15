/* Historico de fechamento de conta de mesa.
 *
 * A mesa (tabela `mesas`) e reaproveitada a cada cliente e nao guarda
 * historico. Este repositorio e o ledger: cada linha e uma comanda fechada,
 * com o valor da taxa de servico (a "taxa do garcom") e se ela foi cobrada ou
 * nao. E daqui que o dashboard soma a arrecadacao do periodo. */
import { todos, um } from "../db/postgres.js";

export const mesasFechamentosRepo = {
  async registrar({ mesaN, subtotal, percentual, servico, servicoCobrado, total, usuario, pagamento }) {
    await um(`
      INSERT INTO mesas_fechamentos (mesa_n, subtotal, percentual, servico, servico_cobrado, total, usuario, pagamento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [mesaN, subtotal, percentual, servico, servicoCobrado ? 1 : 0, total, usuario || null, pagamento || ""]);
  },

  async resumoPeriodo({ desde, ate }) {
    const linha = await um(`
      SELECT COUNT(*)::int AS fechamentos,
             COALESCE(SUM(servico) FILTER (WHERE servico_cobrado = 1), 0) AS servico_cobrado_total,
             COUNT(*) FILTER (WHERE servico_cobrado = 0)::int AS nao_cobradas
        FROM mesas_fechamentos
       WHERE criado_em >= ?::timestamptz AND criado_em <= ?::timestamptz
    `, [desde, ate]);
    return {
      total: Number(linha?.servico_cobrado_total || 0),
      contasFechadas: Number(linha?.fechamentos || 0),
      contasSemCobranca: Number(linha?.nao_cobradas || 0)
    };
  }
};
