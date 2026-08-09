-- Guarda o motivo no proprio pedido para dashboard e conferencias futuras.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT NOT NULL DEFAULT '';
