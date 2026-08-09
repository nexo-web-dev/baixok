-- Relatorios de motoboy no fechamento e ultima localizacao autorizada do entregador.

ALTER TABLE caixa_fechamentos ADD COLUMN IF NOT EXISTS motoboys TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS motoboy_localizacoes (
  usuario_id    BIGINT           PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  usuario_nome  TEXT             NOT NULL DEFAULT '',
  papel         TEXT             NOT NULL DEFAULT 'entregador',
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  precisao      DOUBLE PRECISION,
  atualizado_em TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_motoboy_localizacoes_atualizado ON motoboy_localizacoes(atualizado_em DESC);

ALTER TABLE motoboy_localizacoes ENABLE ROW LEVEL SECURITY;
