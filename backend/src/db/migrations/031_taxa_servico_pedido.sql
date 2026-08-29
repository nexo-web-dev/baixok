-- Referencia SQLite (nao executada) do que 031_taxa_servico_pedido.sql faz no Postgres.
-- Ver migrations/postgres/ para o script que realmente roda.
ALTER TABLE pedidos ADD COLUMN taxa_servico REAL NOT NULL DEFAULT 0;
