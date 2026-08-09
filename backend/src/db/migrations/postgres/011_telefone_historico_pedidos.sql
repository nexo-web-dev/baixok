-- Telefone normalizado para historico publico de pedidos.

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS telefone_digits TEXT NOT NULL DEFAULT '';

UPDATE pedidos
   SET telefone_digits = CASE
                           WHEN length(regexp_replace(COALESCE(telefone, ''), '\D', '', 'g')) > 11
                            AND left(regexp_replace(COALESCE(telefone, ''), '\D', '', 'g'), 2) = '55'
                           THEN substring(regexp_replace(COALESCE(telefone, ''), '\D', '', 'g') from 3)
                           ELSE regexp_replace(COALESCE(telefone, ''), '\D', '', 'g')
                         END
 WHERE telefone_digits = '';

CREATE INDEX IF NOT EXISTS idx_pedidos_telefone_digits_criado ON pedidos(telefone_digits, criado_em DESC);
