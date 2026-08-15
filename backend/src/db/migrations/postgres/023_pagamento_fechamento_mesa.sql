-- "Pagar no balcao" e so um marcador de que o pedido de mesa ainda nao foi
-- pago — nunca foi uma forma de pagamento de verdade, e por isso nao faz
-- sentido aparecer ao lado de Dinheiro/Pix/Cartao nos relatorios. Agora o
-- fechamento da conta pergunta a forma real, e ela e gravada tanto no
-- fechamento quanto nos pedidos daquela mesa (repositories/pedidos.repo.js
-- atualiza pedidos.pagamento na hora de fechar).
ALTER TABLE mesas_fechamentos ADD COLUMN pagamento TEXT NOT NULL DEFAULT '';
