-- Insumos operacionais e motoboy responsavel por entrega.

CREATE TABLE IF NOT EXISTS insumos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT    NOT NULL,
  categoria     TEXT    NOT NULL DEFAULT 'Geral',
  unidade       TEXT    NOT NULL DEFAULT 'un',
  quantidade    REAL    NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  minimo        REAL    NOT NULL DEFAULT 0 CHECK (minimo >= 0),
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insumos_categoria ON insumos(categoria, ativo);
CREATE INDEX IF NOT EXISTS idx_insumos_minimo ON insumos(quantidade, minimo);

ALTER TABLE pedidos ADD COLUMN motoboy TEXT NOT NULL DEFAULT '';
