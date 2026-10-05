/* Cobranca do plano do sistema (mensalidade + saldo do desenvolvimento).
 *
 * Fica no banco e nao no front: antes os valores estavam cravados no
 * plano.js, e quem abrisse o devtools podia mudar o numero que a tela mostra.
 * Uma linha so (id = 1). Atualize aqui quando um pagamento cair:
 *
 *   UPDATE plano_cobranca SET mensalidade_paga_ate = '2026-10-15' WHERE id = 1;
 *   UPDATE plano_cobranca SET valor_projeto_pago = valor_projeto_pago + 500 WHERE id = 1;
 */
CREATE TABLE IF NOT EXISTS plano_cobranca (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  valor_mensalidade    NUMERIC(10, 2) NOT NULL,
  mensalidade_paga_ate DATE NOT NULL,
  valor_projeto_total  NUMERIC(10, 2) NOT NULL,
  valor_projeto_pago   NUMERIC(10, 2) NOT NULL,
  vencimento_projeto   DATE NOT NULL,
  prazo_final_projeto  DATE NOT NULL
);

INSERT INTO plano_cobranca (
  id, valor_mensalidade, mensalidade_paga_ate, valor_projeto_total, valor_projeto_pago, vencimento_projeto, prazo_final_projeto
) VALUES (
  1, 300.00, '2026-09-15', 2500.00, 1200.00, '2026-09-05', '2026-10-05'
) ON CONFLICT (id) DO NOTHING;
