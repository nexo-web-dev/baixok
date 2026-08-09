-- Antes desta migration, "sabor de pizza" so era marcado quando a categoria
-- batia exatamente com a string "pizzas". Categoria e texto livre, e quem
-- cadastrou como "Pizzas Salgadas", "Pizzas Doces" etc ficou de fora. Aqui e
-- so o reparo dos dados que ja existiam; o codigo que grava dai pra frente ja
-- usa a checagem por "contem pizza".
UPDATE produtos
   SET sabor_pizza = 1
 WHERE sabor_pizza = 0
   AND categoria ILIKE '%pizza%';
