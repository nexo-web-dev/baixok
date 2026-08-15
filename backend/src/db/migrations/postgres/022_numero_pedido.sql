-- Numero sequencial do pedido. Diferente do `id` (texto aleatorio, usado como
-- chave e em URL — nunca deveria virar a "senha" que o cliente grita no
-- balcao), este e um inteiro que so cresce: 1, 2, 3... Nunca repete porque
-- vem de uma sequence propria, e continua avancando mesmo que um pedido seja
-- cancelado ou apagado depois — o numero de um pedido excluido nunca volta a
-- ser usado por outro.
--
-- Sequence + DEFAULT nextval() em vez de GENERATED ... AS IDENTITY de
-- proposito: e o jeito mais antigo e mais testado de fazer a mesma coisa no
-- Postgres, sem depender de comportamento de ALTER TABLE em versao recente.
CREATE SEQUENCE IF NOT EXISTS pedidos_numero_seq;

ALTER TABLE pedidos ADD COLUMN numero BIGINT;
ALTER TABLE pedidos ALTER COLUMN numero SET DEFAULT nextval('pedidos_numero_seq');

-- Pedidos que ja existiam antes desta coluna tambem ganham numero, na ordem
-- de chegada.
UPDATE pedidos SET numero = nextval('pedidos_numero_seq') WHERE numero IS NULL;

ALTER TABLE pedidos ALTER COLUMN numero SET NOT NULL;
-- UNIQUE ja cria um indice btree sozinho; nao precisa de um segundo.
ALTER TABLE pedidos ADD CONSTRAINT pedidos_numero_unique UNIQUE (numero);
ALTER SEQUENCE pedidos_numero_seq OWNED BY pedidos.numero;
