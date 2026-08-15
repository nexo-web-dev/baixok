-- Marca uma linha de pedido como brinde de uma regra "leve e ganhe": produto
-- entregue junto do pedido, com preco_unit = 0, para aparecer separado no
-- ticket da cozinha, na nota do balcao e no painel — em vez de sumir dentro
-- de um item comum com preco zerado sem explicacao nenhuma.
ALTER TABLE pedido_itens ADD COLUMN brinde INTEGER NOT NULL DEFAULT 0 CHECK (brinde IN (0, 1));
ALTER TABLE mesa_itens ADD COLUMN brinde INTEGER NOT NULL DEFAULT 0 CHECK (brinde IN (0, 1));
