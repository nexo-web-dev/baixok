-- Referencia SQLite (nao executada) do que 030_cortesia.sql faz no Postgres.
-- Ver migrations/postgres/ para o script que realmente roda.
ALTER TABLE pedido_itens ADD COLUMN cortesia INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN valor_cortesia REAL NOT NULL DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN motivo_cortesia TEXT NOT NULL DEFAULT '';
