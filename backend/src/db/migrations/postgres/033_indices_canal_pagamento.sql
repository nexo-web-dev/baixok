-- Filtro de canal (iFood, loja, etc.) e forma de pagamento no dashboard e na
-- listagem de pedidos ja existiam antes, mas so em JS, depois de buscar do
-- banco sem filtrar (por isso o bug de truncamento corrigido antes). Agora
-- que o SQL filtra de verdade (pedidosRepo.listar/agruparPor), esses dois
-- indices evitam varredura sequencial na tabela toda conforme o volume de
-- pedidos cresce (pensando na integracao com iFood/99Food).
CREATE INDEX IF NOT EXISTS idx_pedidos_canal ON pedidos(canal, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_pagamento ON pedidos(pagamento, criado_em DESC);
