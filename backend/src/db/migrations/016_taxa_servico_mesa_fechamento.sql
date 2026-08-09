-- Referencia SQLite: a pasta raiz de migrations nao e mais executada.
-- Historico de fechamento de conta de mesa (taxa de servico cobrada ou nao).
CREATE TABLE mesas_fechamentos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mesa_n          INTEGER NOT NULL,
  subtotal        REAL    NOT NULL DEFAULT 0,
  percentual      REAL    NOT NULL DEFAULT 0,
  servico         REAL    NOT NULL DEFAULT 0,
  servico_cobrado INTEGER NOT NULL DEFAULT 1 CHECK (servico_cobrado IN (0, 1)),
  total           REAL    NOT NULL DEFAULT 0,
  usuario         TEXT,
  criado_em       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mesas_fechamentos_criado ON mesas_fechamentos(criado_em DESC);
