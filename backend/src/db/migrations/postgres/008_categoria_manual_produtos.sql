-- Categorias passam a ser digitadas no painel, sem lista fixa.
ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_categoria_check;
