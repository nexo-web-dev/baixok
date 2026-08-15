-- Referencia SQLite: a pasta raiz de migrations nao e mais executada.
-- Forma de pagamento real, escolhida ao fechar a conta da mesa.
ALTER TABLE mesas_fechamentos ADD COLUMN pagamento TEXT NOT NULL DEFAULT '';
