-- Referencia SQLite (nao executada) do que 025_renomear_calote_nao_pago.sql
-- faz no Postgres. Ver migrations/postgres/ para o script que realmente roda.
UPDATE pedidos SET pagamento = 'Não pago', atualizado_em = CURRENT_TIMESTAMP WHERE pagamento = 'Calote';
UPDATE mesas_fechamentos SET pagamento = 'Não pago' WHERE pagamento = 'Calote';
