-- "Calote" pressupunha fraude do cliente, mas o motivo pode ser outra coisa
-- (cartao recusado, por exemplo) — o texto do motivo ja conta a historia
-- certa, o marcador de pagamento so precisa dizer "nao pago". Corrige o que
-- ja tiver sido gravado como "Calote" antes desta migration, tanto no pedido
-- quanto no fechamento de mesa que gerou esses pedidos.
UPDATE pedidos SET pagamento = 'Não pago', atualizado_em = now() WHERE pagamento = 'Calote';
UPDATE mesas_fechamentos SET pagamento = 'Não pago' WHERE pagamento = 'Calote';
