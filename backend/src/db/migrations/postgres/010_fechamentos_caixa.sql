-- Fechamentos de caixa.

CREATE TABLE IF NOT EXISTS caixa_fechamentos (
  id              TEXT             PRIMARY KEY,
  status          TEXT             NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado')),
  aberto_em       TIMESTAMPTZ      NOT NULL DEFAULT now(),
  fechado_em      TIMESTAMPTZ,
  aberto_por      BIGINT           REFERENCES usuarios(id) ON DELETE SET NULL,
  aberto_por_nome TEXT             NOT NULL DEFAULT '',
  fechado_por     BIGINT           REFERENCES usuarios(id) ON DELETE SET NULL,
  fechado_por_nome TEXT            NOT NULL DEFAULT '',
  pedidos         INTEGER          NOT NULL DEFAULT 0,
  faturamento     DOUBLE PRECISION NOT NULL DEFAULT 0,
  descontos       DOUBLE PRECISION NOT NULL DEFAULT 0,
  taxas_entrega   DOUBLE PRECISION NOT NULL DEFAULT 0,
  ticket_medio    DOUBLE PRECISION NOT NULL DEFAULT 0,
  cancelados      INTEGER          NOT NULL DEFAULT 0,
  valor_cancelado DOUBLE PRECISION NOT NULL DEFAULT 0,
  entregas        INTEGER          NOT NULL DEFAULT 0,
  retiradas       INTEGER          NOT NULL DEFAULT 0,
  mesas           INTEGER          NOT NULL DEFAULT 0,
  pagamentos      TEXT             NOT NULL DEFAULT '[]',
  canais          TEXT             NOT NULL DEFAULT '[]',
  modalidades     TEXT             NOT NULL DEFAULT '[]',
  observacao      TEXT             NOT NULL DEFAULT '',
  criado_em       TIMESTAMPTZ      NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_um_aberto ON caixa_fechamentos(status) WHERE status = 'aberto';
CREATE INDEX IF NOT EXISTS idx_caixa_fechado_em ON caixa_fechamentos(fechado_em DESC);

ALTER TABLE caixa_fechamentos ENABLE ROW LEVEL SECURITY;
