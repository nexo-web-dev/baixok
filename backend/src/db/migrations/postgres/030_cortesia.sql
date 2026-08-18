-- Cortesia: diferente de "Não pago" (calote, prejuízo), é a casa que decide
-- de propósito não cobrar — pedido inteiro ou só alguns itens, com motivo
-- obrigatório. valor_cortesia fica denormalizado em pedidos, igual `total`
-- já é, pra relatório de faturamento so subtrair em vez de recalcular via
-- JOIN em pedido_itens toda hora.

ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS cortesia INTEGER NOT NULL DEFAULT 0 CHECK (cortesia IN (0, 1));
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_cortesia DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (valor_cortesia >= 0);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS motivo_cortesia TEXT NOT NULL DEFAULT '';
