-- Mesma ideia de "cancelados"/"valor_cancelado": o fechamento guarda a foto
-- do que aconteceu naquele caixa, nao recalcula toda vez que o relatorio e
-- aberto. "naopagos_lista" guarda cliente, valor e motivo de cada pedido nao
-- pago do periodo, pro relatorio impresso mostrar o motivo de cada um.
ALTER TABLE caixa_fechamentos ADD COLUMN IF NOT EXISTS calotes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE caixa_fechamentos ADD COLUMN IF NOT EXISTS valor_calote DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE caixa_fechamentos ADD COLUMN IF NOT EXISTS naopagos_lista TEXT NOT NULL DEFAULT '[]';
