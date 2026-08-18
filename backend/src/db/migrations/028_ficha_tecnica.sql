-- Referencia SQLite (nao executada) do que 028_ficha_tecnica.sql faz no
-- Postgres. Ver migrations/postgres/ para o script que realmente roda.
ALTER TABLE insumos ADD COLUMN custo_pacote REAL NOT NULL DEFAULT 0;
ALTER TABLE insumos ADD COLUMN qtd_pacote REAL NOT NULL DEFAULT 0;

CREATE TABLE produto_insumos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  insumo_id  INTEGER NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  quantidade REAL NOT NULL,
  UNIQUE (produto_id, insumo_id)
);
CREATE INDEX idx_produto_insumos_produto ON produto_insumos(produto_id);
