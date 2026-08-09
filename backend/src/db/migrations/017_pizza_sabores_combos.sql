-- Referencia SQLite: a pasta raiz de migrations nao e mais executada.
-- Pizza de 2 sabores e combos.
ALTER TABLE produtos ADD COLUMN sabor_pizza INTEGER NOT NULL DEFAULT 0 CHECK (sabor_pizza IN (0, 1));

CREATE TABLE combinacoes_sabores (
  produto_a_id  TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  produto_b_id  TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  preco         REAL NOT NULL,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (produto_a_id, produto_b_id),
  CHECK (produto_a_id < produto_b_id)
);

CREATE TABLE combos (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  descricao     TEXT NOT NULL DEFAULT '',
  preco         REAL NOT NULL,
  imagem        TEXT NOT NULL DEFAULT '',
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  ordem         INTEGER NOT NULL DEFAULT 9999,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE combo_itens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id    TEXT    NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  produto_id  TEXT    NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
  quantidade  INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0)
);
CREATE INDEX idx_combo_itens_combo ON combo_itens(combo_id);

ALTER TABLE pedido_itens ADD COLUMN combo_id TEXT REFERENCES combos(id) ON DELETE SET NULL;
ALTER TABLE pedido_itens ADD COLUMN produto_id_2 TEXT REFERENCES produtos(id) ON DELETE SET NULL;
