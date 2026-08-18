-- Referencia SQLite (nao executada) do que 029_cmv_direto_produto.sql faz no
-- Postgres. Ver migrations/postgres/ para o script que realmente roda.
DROP TABLE IF EXISTS produto_insumos;

ALTER TABLE produtos ADD COLUMN cmv_porcao_g REAL NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN cmv_saco_peso_g REAL NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN cmv_saco_custo REAL NOT NULL DEFAULT 0;
