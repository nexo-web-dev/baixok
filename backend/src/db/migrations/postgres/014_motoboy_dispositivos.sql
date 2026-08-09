-- Permite rastrear mais de um login/aparelho do mesmo motoboy.

ALTER TABLE motoboy_localizacoes ADD COLUMN IF NOT EXISTS dispositivo_id TEXT NOT NULL DEFAULT 'principal';
ALTER TABLE motoboy_localizacoes ADD COLUMN IF NOT EXISTS dispositivo_nome TEXT NOT NULL DEFAULT '';

ALTER TABLE motoboy_localizacoes DROP CONSTRAINT IF EXISTS motoboy_localizacoes_pkey;
ALTER TABLE motoboy_localizacoes
  ADD CONSTRAINT motoboy_localizacoes_pkey PRIMARY KEY (usuario_id, dispositivo_id);

CREATE INDEX IF NOT EXISTS idx_motoboy_localizacoes_usuario ON motoboy_localizacoes(usuario_id);
