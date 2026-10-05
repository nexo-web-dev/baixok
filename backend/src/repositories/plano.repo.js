/* Cobranca do plano do sistema — uma linha so (ver 034_plano_cobranca.sql).
 * As datas voltam como texto AAAA-MM-DD pra nao passar por fuso do Node. */
import { um } from "../db/postgres.js";

export const planoRepo = {
  async ler() {
    return um(`
      SELECT valor_mensalidade, mensalidade_paga_ate::text, valor_projeto_total, valor_projeto_pago,
             vencimento_projeto::text, prazo_final_projeto::text
        FROM plano_cobranca
       WHERE id = 1
    `);
  }
};
