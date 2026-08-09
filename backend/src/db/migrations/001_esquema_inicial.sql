-- Esquema inicial do Baixo K.
--
-- Substitui o data/baixo-k.json, que era um documento unico reescrito inteiro a
-- cada alteracao: duas pessoas editando o cardapio ao mesmo tempo faziam a
-- ultima gravacao apagar a primeira. Com tabelas e transacao isso deixa de
-- acontecer, e a baixa de estoque passa a ser atomica.

-- ---------------------------------------------------------------- pessoas ---
CREATE TABLE usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nome          TEXT    NOT NULL,
  senha_hash    TEXT    NOT NULL,
  papel         TEXT    NOT NULL CHECK (papel IN ('admin', 'caixa', 'cozinha', 'entregador')),
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT    NOT NULL DEFAULT (datetime('now')),
  ultimo_login  TEXT
);

-- Guardamos o hash do token, nunca o token. Um vazamento do arquivo do banco
-- (backup em pendrive, copia por e-mail) deixava de entregar sessao viva.
CREATE TABLE sessoes (
  token_hash  TEXT    PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  csrf_hash   TEXT    NOT NULL,
  criada_em   TEXT    NOT NULL DEFAULT (datetime('now')),
  expira_em   TEXT    NOT NULL,
  ip          TEXT,
  agente      TEXT
);
CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX idx_sessoes_expira  ON sessoes(expira_em);

-- Responde "quem cancelou aquele pedido de ontem?", que com a senha unica
-- compartilhada nao tinha resposta possivel.
CREATE TABLE auditoria (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario    TEXT,
  acao       TEXT NOT NULL,
  entidade   TEXT,
  entidade_id TEXT,
  detalhes   TEXT,
  ip         TEXT,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auditoria_criado ON auditoria(criado_em);
CREATE INDEX idx_auditoria_entidade ON auditoria(entidade, entidade_id);

-- --------------------------------------------------------------- cardapio ---
CREATE TABLE produtos (
  id            TEXT    PRIMARY KEY,
  nome          TEXT    NOT NULL,
  categoria     TEXT    NOT NULL,
  preco         REAL    NOT NULL CHECK (preco >= 0),
  estoque       INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  estoque_min   INTEGER NOT NULL DEFAULT 4 CHECK (estoque_min >= 0),
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  imagem        TEXT    NOT NULL DEFAULT '',
  selo          TEXT    NOT NULL DEFAULT '',
  descricao     TEXT    NOT NULL DEFAULT '',
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_produtos_categoria ON produtos(categoria, ativo);

-- UNIQUE em produto_id: a regra "uma promocao por produto" era mantida na mao
-- pelo front (filter + unshift) e nada impedia duas promocoes no mesmo item se
-- duas abas salvassem juntas. Agora e o banco que recusa.
CREATE TABLE promocoes (
  id         TEXT PRIMARY KEY,
  produto_id TEXT NOT NULL UNIQUE REFERENCES produtos(id) ON DELETE CASCADE,
  preco      REAL NOT NULL CHECK (preco >= 0),
  ate        TEXT NOT NULL DEFAULT '',
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cupons (
  code      TEXT    PRIMARY KEY COLLATE NOCASE,
  tipo      TEXT    NOT NULL CHECK (tipo IN ('pct', 'val')),
  valor     REAL    NOT NULL CHECK (valor > 0),
  minimo    REAL    NOT NULL DEFAULT 0 CHECK (minimo >= 0),
  uso_unico INTEGER NOT NULL DEFAULT 0 CHECK (uso_unico IN (0, 1)),
  ate       TEXT    NOT NULL DEFAULT '',
  usos      INTEGER NOT NULL DEFAULT 0 CHECK (usos >= 0),
  ativo     INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Tabela que faltava. O README listava "cupom de uso unico nao e aplicado" como
-- limitacao conhecida: o sistema guardava a marca e nunca a checava. Com o
-- telefone do pedido da para fechar a regra.
CREATE TABLE cupons_resgatados (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cupom_code TEXT NOT NULL REFERENCES cupons(code) ON DELETE CASCADE,
  pedido_id  TEXT NOT NULL,
  telefone   TEXT NOT NULL DEFAULT '',
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resgate_cupom_tel ON cupons_resgatados(cupom_code, telefone);

-- ------------------------------------------------------------------ salao ---
-- Criada antes de `pedidos` porque pedidos referencia mesas(n).
CREATE TABLE mesas (
  n             INTEGER PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'livre' CHECK (status IN ('livre', 'aberta', 'fechando')),
  aberta_em     TEXT,
  fechada_em    TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- pedidos ---
CREATE TABLE pedidos (
  id             TEXT    PRIMARY KEY,
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now')),
  status         TEXT    NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'preparo', 'pronto', 'entregue', 'cancelado')),
  canal          TEXT    NOT NULL DEFAULT 'cardapio',
  modalidade     TEXT    NOT NULL DEFAULT 'retirada' CHECK (modalidade IN ('retirada', 'entrega', 'mesa')),
  cliente        TEXT    NOT NULL DEFAULT 'Cliente',
  telefone       TEXT    NOT NULL DEFAULT '',
  local          TEXT    NOT NULL DEFAULT '',
  observacao     TEXT    NOT NULL DEFAULT '',
  motivo_cancelamento TEXT NOT NULL DEFAULT '',
  pagamento      TEXT    NOT NULL DEFAULT '',
  mesa_n         INTEGER REFERENCES mesas(n) ON DELETE SET NULL,
  subtotal       REAL    NOT NULL DEFAULT 0,
  desconto       REAL    NOT NULL DEFAULT 0,
  cupom_code     TEXT    NOT NULL DEFAULT '',
  taxa_entrega   REAL    NOT NULL DEFAULT 0,
  entrega_km     REAL,
  entrega_faixa  TEXT,
  total          REAL    NOT NULL DEFAULT 0,
  impresso       INTEGER NOT NULL DEFAULT 0 CHECK (impresso IN (0, 1)),
  estoque_baixado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_baixado IN (0, 1)),
  criado_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pedidos_criado ON pedidos(criado_em DESC);
CREATE INDEX idx_pedidos_status ON pedidos(status, criado_em DESC);
CREATE INDEX idx_pedidos_mesa   ON pedidos(mesa_n);

-- Item vira linha. Antes era um array JSON dentro do pedido, o que impedia
-- somar "mais vendidos" sem carregar e percorrer todos os pedidos do periodo.
CREATE TABLE pedido_itens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id   TEXT    NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id  TEXT    REFERENCES produtos(id) ON DELETE SET NULL,
  nome        TEXT    NOT NULL,
  quantidade  INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unit  REAL    NOT NULL CHECK (preco_unit >= 0)
);
CREATE INDEX idx_itens_pedido  ON pedido_itens(pedido_id);
CREATE INDEX idx_itens_produto ON pedido_itens(produto_id);

CREATE TABLE mesa_itens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mesa_n     INTEGER NOT NULL REFERENCES mesas(n) ON DELETE CASCADE,
  pedido_id  TEXT    REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id TEXT    REFERENCES produtos(id) ON DELETE SET NULL,
  nome       TEXT    NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unit REAL    NOT NULL CHECK (preco_unit >= 0),
  criado_em  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mesa_itens ON mesa_itens(mesa_n);

-- ---------------------------------------------------------------- entrega ---
-- Linha unica travada em id = 1.
CREATE TABLE entrega_config (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  endereco      TEXT NOT NULL DEFAULT '',
  lng           REAL,
  lat           REAL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO entrega_config (id, endereco) VALUES (1, '');

CREATE TABLE entrega_faixas (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  km     REAL NOT NULL CHECK (km > 0),
  taxa   REAL NOT NULL DEFAULT 0 CHECK (taxa >= 0),
  minimo REAL NOT NULL DEFAULT 0 CHECK (minimo >= 0)
);

-- ------------------------------------------------------- ajustes da casa ---
-- Coisas que estavam cravadas no app.js e por isso so mudavam com deploy:
-- MENU_URL, DELIVERY_WHATSAPP e a taxa de servico de 10%.
CREATE TABLE ajustes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
