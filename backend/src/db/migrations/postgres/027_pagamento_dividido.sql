-- Pedido pago em mais de uma forma (parte no cartao, parte no Pix etc.).
-- pedidos.pagamento continua sendo UM valor so — pra pedido dividido ele vira
-- o marcador "Dividido" (mesma ideia do "Não pago" ja existente), e as
-- parcelas de verdade ficam aqui, uma linha por forma. Assim todo relatorio
-- que ja soma por pedidos.pagamento continua funcionando sem mudanca pro
-- pedido comum (99% dos casos); so quem agrupa por forma de pagamento
-- precisa somar esta tabela tambem pros pedidos "Dividido".
CREATE TABLE IF NOT EXISTS pedido_pagamentos (
  id         BIGSERIAL PRIMARY KEY,
  pedido_id  TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  forma      TEXT NOT NULL,
  valor      NUMERIC(10,2) NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pedido_pagamentos_pedido ON pedido_pagamentos(pedido_id);
