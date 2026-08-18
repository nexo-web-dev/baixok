-- Referencia SQLite (nao executada) do que 027_pagamento_dividido.sql faz no
-- Postgres. Ver migrations/postgres/ para o script que realmente roda.
CREATE TABLE pedido_pagamentos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id  TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  forma      TEXT NOT NULL,
  valor      REAL NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pedido_pagamentos_pedido ON pedido_pagamentos(pedido_id);
