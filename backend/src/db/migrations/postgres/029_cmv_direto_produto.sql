-- Simplifica o CMV: em vez de escolher insumo de um catalogo (028), o calculo
-- fica direto no produto — peso do saco comprado, custo do saco e porcao
-- vendida. produto_insumos nunca chegou a ter uso real, entao remove sem
-- migrar dado nenhum.

DROP TABLE IF EXISTS produto_insumos;

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cmv_porcao_g DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (cmv_porcao_g >= 0);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cmv_saco_peso_g DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (cmv_saco_peso_g >= 0);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cmv_saco_custo DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (cmv_saco_custo >= 0);
