-- Referencia SQLite: a pasta raiz de migrations nao e mais executada.
-- No Postgres, esta coluna escolhe os tres produtos destacados do cardapio.
ALTER TABLE produtos ADD COLUMN destaque_ordem INTEGER NOT NULL DEFAULT 0;

