CREATE TABLE IF NOT EXISTS promocoes_brindes (
  id TEXT PRIMARY KEY,
  produto_compra_id TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  produto_brinde_id TEXT NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
  quantidade_compra INTEGER NOT NULL DEFAULT 1 CHECK (quantidade_compra > 0),
  quantidade_brinde INTEGER NOT NULL DEFAULT 1 CHECK (quantidade_brinde > 0),
  ate TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(produto_compra_id, produto_brinde_id)
);

CREATE INDEX IF NOT EXISTS idx_promocoes_brindes_compra
  ON promocoes_brindes(produto_compra_id);
