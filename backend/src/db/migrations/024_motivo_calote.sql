-- Referencia SQLite (nao executada) do que 024_motivo_calote.sql faz no
-- Postgres. Ver migrations/postgres/ para o script que realmente roda.
ALTER TABLE pedidos ADD COLUMN motivo_nao_pago TEXT NOT NULL DEFAULT '';
