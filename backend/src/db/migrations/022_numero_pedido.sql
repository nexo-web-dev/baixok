-- Referencia SQLite: a pasta raiz de migrations nao e mais executada.
-- Numero sequencial do pedido, nunca repete mesmo apos cancelamento/exclusao.
ALTER TABLE pedidos ADD COLUMN numero INTEGER;
