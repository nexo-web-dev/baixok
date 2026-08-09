-- Tres destaques manuais do cardapio publico.
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS destaque_ordem INTEGER NOT NULL DEFAULT 0;

ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_destaque_ordem_check;
ALTER TABLE produtos
  ADD CONSTRAINT produtos_destaque_ordem_check CHECK (destaque_ordem BETWEEN 0 AND 3);

CREATE INDEX IF NOT EXISTS idx_produtos_destaque_ordem ON produtos(destaque_ordem) WHERE destaque_ordem > 0;

