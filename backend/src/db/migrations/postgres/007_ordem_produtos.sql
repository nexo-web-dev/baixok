-- Ordem manual do cardapio.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 9999;

WITH ordenados AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY ordem ASC, categoria, nome) AS nova_ordem
    FROM produtos
)
UPDATE produtos p
   SET ordem = o.nova_ordem
  FROM ordenados o
 WHERE p.id = o.id;

CREATE INDEX IF NOT EXISTS idx_produtos_ordem ON produtos(ordem, categoria, nome);
