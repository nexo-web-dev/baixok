-- Referencia SQLite: a pasta raiz de migrations nao e mais executada.
-- Escolhas dentro de um combo (ex: "Escolha o refrigerante").
CREATE TABLE combo_escolhas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id TEXT    NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  nome     TEXT    NOT NULL,
  ordem    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_combo_escolhas_combo ON combo_escolhas(combo_id);

CREATE TABLE combo_escolha_opcoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  escolha_id  INTEGER NOT NULL REFERENCES combo_escolhas(id) ON DELETE CASCADE,
  produto_id  TEXT    NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
  preco_extra REAL    NOT NULL DEFAULT 0
);
CREATE INDEX idx_combo_escolha_opcoes_escolha ON combo_escolha_opcoes(escolha_id);

ALTER TABLE pedido_itens ADD COLUMN escolhas TEXT NOT NULL DEFAULT '[]';
