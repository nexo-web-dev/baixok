-- Referencia SQLite (nao executada) do que 026_naopagos_fechamento.sql faz
-- no Postgres. Ver migrations/postgres/ para o script que realmente roda.
ALTER TABLE caixa_fechamentos ADD COLUMN calotes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE caixa_fechamentos ADD COLUMN valor_calote REAL NOT NULL DEFAULT 0;
ALTER TABLE caixa_fechamentos ADD COLUMN naopagos_lista TEXT NOT NULL DEFAULT '[]';
