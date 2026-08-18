-- CMV automatico: custo de compra no insumo + ficha tecnica (quanto cada
-- produto consome de cada insumo) — o app calcula o custo por porcao sozinho.

ALTER TABLE insumos ADD COLUMN IF NOT EXISTS custo_pacote DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (custo_pacote >= 0);
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS qtd_pacote DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (qtd_pacote >= 0);

CREATE TABLE IF NOT EXISTS produto_insumos (
  id         BIGSERIAL PRIMARY KEY,
  produto_id TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  insumo_id  BIGINT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  quantidade DOUBLE PRECISION NOT NULL CHECK (quantidade > 0),
  UNIQUE (produto_id, insumo_id)
);

CREATE INDEX IF NOT EXISTS idx_produto_insumos_produto ON produto_insumos(produto_id);
