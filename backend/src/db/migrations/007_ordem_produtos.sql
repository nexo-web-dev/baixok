-- Ordem manual do cardapio.

ALTER TABLE produtos ADD COLUMN ordem INTEGER NOT NULL DEFAULT 9999;

UPDATE produtos
   SET ordem = (
     SELECT COUNT(*)
       FROM produtos p2
      WHERE p2.categoria < produtos.categoria
         OR (p2.categoria = produtos.categoria AND p2.nome <= produtos.nome)
   );

CREATE INDEX idx_produtos_ordem ON produtos(ordem, categoria, nome);
