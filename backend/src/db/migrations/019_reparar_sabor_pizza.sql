-- Referencia SQLite: a pasta raiz de migrations nao e mais executada.
-- Reparo: marca sabor_pizza para qualquer categoria que contenha "pizza",
-- nao so a string exata "pizzas".
UPDATE produtos
   SET sabor_pizza = 1
 WHERE sabor_pizza = 0
   AND lower(categoria) LIKE '%pizza%';
