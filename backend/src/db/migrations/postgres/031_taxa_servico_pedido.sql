-- Taxa de servico (10% do garcom) tambem pode ser adicionada num pedido
-- avulso (balcao, retirada, entrega), nao so na conta de mesa que ja tinha
-- isso. Fica denormalizada aqui, igual valor_cortesia/taxa_entrega ja sao,
-- pra somar no total sem precisar recalcular nada na hora de imprimir a nota
-- ou de somar faturamento nos relatorios.

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS taxa_servico DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (taxa_servico >= 0);
