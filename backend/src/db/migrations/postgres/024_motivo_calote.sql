-- Marcar um pedido como "Calote" (produto saiu, cliente nao pagou) passa a
-- exigir o motivo, igual ja acontece pra cancelar um pedido — sem isso nao
-- da pra saber depois, so olhando o relatorio, o que aconteceu em cada caso.
ALTER TABLE pedidos ADD COLUMN motivo_nao_pago TEXT NOT NULL DEFAULT '';
