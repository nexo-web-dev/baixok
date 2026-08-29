-- Libera o papel de garcom para usuarios (mesma ideia de 005_papel_entregador.sql).
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check;
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_papel_check
  CHECK (papel IN ('admin', 'caixa', 'cozinha', 'entregador', 'garcom'));
