/* Conexao com o Postgres do Supabase.
 *
 * Substitui o db/connection.js (node:sqlite). A diferenca que muda tudo: o
 * SQLite embutido responde de forma SINCRONA e o Postgres responde pela rede,
 * entao toda leitura e escrita vira assincrona. E a razao de a migracao tocar
 * os 14 arquivos que falam com o banco, e nao so este.
 *
 * Sobre usar `pg` e nao @supabase/supabase-js: o supabase-js fala com o
 * PostgREST por HTTP, e HTTP nao tem transacao. O sistema depende de transacao
 * de verdade — a baixa de estoque do pedido precisa acontecer inteira ou nao
 * acontecer (services/pedidos.service.js). Com supabase-js, dois pedidos
 * simultaneos voltariam a vender o mesmo ultimo item, que e exatamente o bug
 * que o refactor corrigiu. O supabase-js continua util para o Auth.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

const { Pool } = pg;

/* BIGINT chega como string, nao como numero.
 *
 * O `pg` faz isso de proposito: int8 vai ate 9.2e18 e o Number do JavaScript so
 * garante inteiro exato ate 9e15, entao converter sozinho perderia precisao em
 * valores enormes. Acontece que nossos BIGINT sao id de usuario, de pedido_item
 * e de auditoria — nenhum chega perto disso.
 *
 * Sem esta linha, `usuario.id` volta "1" em vez de 1 e todo `===` contra numero
 * passa a dar falso em silencio: pedido.createdBy === usuario.id, a checagem de
 * dono de sessao, a comparacao de papel. O SQLite devolvia numero, e e esse o
 * contrato que a API ja publica para o front. */
pg.types.setTypeParser(pg.types.builtins.INT8, valor => Number.parseInt(valor, 10));

let pool = null;

/* Onde fica o cliente da transacao em curso.
 *
 * Sem isto, cada repositorio precisaria receber a conexao como parametro e
 * repassa-la para baixo — os ~130 pontos de acesso ganhariam um argumento so
 * para sobreviver a transacao. Com AsyncLocalStorage, `consultar()` descobre
 * sozinho se esta dentro de emTransacao() e usa o mesmo cliente; fora dela,
 * pega qualquer conexao do pool. As assinaturas dos repositorios nao mudam. */
const contextoTransacao = new AsyncLocalStorage();

export function abrirPool() {
  if (pool) return pool;

  if (!env.SUPABASE_DATABASE_URL) {
    throw new Error("SUPABASE_DATABASE_URL nao configurada: sem ela nao ha banco para abrir.");
  }

  /* `sslmode=disable` na URL desliga o TLS por completo.
   *
   * Existe para o Postgres local dos testes, que nao fala TLS: com `ssl` ligado
   * o driver pede SSLRequest, o servidor responde que nao tem, e a conexao morre
   * antes da primeira consulta. O Supabase nunca aparece com esse parametro —
   * la o TLS continua obrigatorio pelo caminho de baixo. */
  const semTls = /[?&]sslmode=disable(&|$)/.test(env.SUPABASE_DATABASE_URL);
  const certificadoCliente = env.DATABASE_CLIENT_CERT_BASE64
    ? Buffer.from(env.DATABASE_CLIENT_CERT_BASE64, "base64").toString("utf8")
    : undefined;

  if (certificadoCliente && !certificadoCliente.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("DATABASE_CLIENT_CERT_BASE64 invalido: o valor nao contem um certificado PEM.");
  }

  if (certificadoCliente && !certificadoCliente.includes("PRIVATE KEY-----")) {
    throw new Error("DATABASE_CLIENT_CERT_BASE64 invalido: o valor nao contem a chave privada PEM.");
  }

  /* O pg-connection-string da prioridade aos parametros SSL da URL sobre o
   * objeto `ssl` passado abaixo. A URL fornecida pela Square traz sslmode e,
   * sem remover esse parametro, cert/key somem silenciosamente e o servidor
   * responde "connection requires a valid client certificate". Credenciais,
   * host, porta, banco e quaisquer parametros nao relacionados a TLS ficam. */
  const urlConexao = new URL(env.SUPABASE_DATABASE_URL);
  for (const parametro of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    urlConexao.searchParams.delete(parametro);
  }

  pool = new Pool({
    connectionString: urlConexao.toString(),
    /* O Supabase exige TLS. SUPABASE_INSECURE_TLS existe porque a rede da loja
     * intercepta certificado — o mesmo motivo que ja obrigou a flag no resto do
     * projeto. Em producao ela fica desligada e o certificado e conferido. */
    ssl: semTls ? false : {
      rejectUnauthorized: !env.SUPABASE_INSECURE_TLS,
      /* O certificate.pem da Square e um bundle. O TLS do Node aceita o mesmo
       * PEM nos dois campos e extrai de cada um o bloco correspondente. */
      ...(certificadoCliente ? { cert: certificadoCliente, key: certificadoCliente } : {})
    },
    /* 10 era justo pra varias pessoas usando o painel ao mesmo tempo (garcom,
     * caixa, cozinha, dono, cada um com o proprio aparelho) — sob pico, dava
     * fila de requisicao esperando conexao livre. 20 da folga sem exagerar
     * (Supabase aceita bem mais que isso por padrao). */
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on("error", erro => logger.error("Erro em conexao ociosa do pool", { erro: erro.message }));

  logger.info("Pool do Postgres aberto", { mtls: Boolean(certificadoCliente) });
  return pool;
}

export const getPool = () => pool || abrirPool();

/* Os repositorios foram escritos com os `?` do SQLite. Renumerar aqui evita
 * reescrever cada consulta so por causa do marcador.
 *
 * Limite conhecido: um `?` dentro de literal de texto (LIKE '%?%') tambem seria
 * trocado. Nao ha nenhum hoje; se aparecer, escreva $1 direto na consulta. */
const numerarParametros = sql => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

/* Ponto unico de acesso. Dentro de emTransacao() usa o cliente da transacao;
 * fora dela, pega e devolve uma conexao do pool. */
async function executar(sql, params = []) {
  const clienteDaTransacao = contextoTransacao.getStore();
  const texto = numerarParametros(sql);

  if (clienteDaTransacao) return clienteDaTransacao.query(texto, params);
  return getPool().query(texto, params);
}

export const todos = async (sql, params) => (await executar(sql, params)).rows;
export const um = async (sql, params) => (await executar(sql, params)).rows[0] ?? null;

/* Substitui o `.changes` do node:sqlite. E o que sustenta a baixa de estoque:
 * `UPDATE ... WHERE estoque >= ?` devolvendo 0 significa que outro pedido levou
 * a ultima unidade, e quem chamou desfaz a transacao. */
export const alteradas = async (sql, params) => (await executar(sql, params)).rowCount;

/* Transacao de verdade, agora assincrona.
 *
 * O connection.js do SQLite impunha callback sincrono para garantir que nenhuma
 * chamada de rede entrasse no meio da conferencia de estoque. Aqui isso deixa de
 * ser imposto pela linguagem: o callback e async porque precisa ser. A regra
 * passa a valer por disciplina — NAO chame geocodificacao, Mapbox nem nenhuma
 * API externa aqui dentro. Cada await de rede no meio segura uma transacao
 * aberta e uma conexao do pool, e reabre a corrida que o refactor fechou.
 *
 * A protecao real continua sendo o proprio UPDATE condicional do estoque, que
 * o Postgres resolve de forma atomica dentro da transacao. */
export async function emTransacao(callback) {
  /* Transacao aninhada reaproveita a de fora: abrir outra aqui daria erro de
   * "transacao ja em andamento" e, pior, um COMMIT interno confirmaria pela
   * metade o trabalho da externa. */
  const jaEmTransacao = contextoTransacao.getStore();
  if (jaEmTransacao) return callback(jaEmTransacao);

  const cliente = await getPool().connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await contextoTransacao.run(cliente, () => callback(cliente));
    await cliente.query("COMMIT");
    return resultado;
  } catch (erro) {
    try { await cliente.query("ROLLBACK"); } catch { /* transacao ja desfeita */ }
    throw erro;
  } finally {
    cliente.release();
  }
}

export async function fecharPool() {
  if (!pool) return;
  try { await pool.end(); } catch { /* ja encerrado */ }
  pool = null;
}

/* Booleano de verdade no Postgres: o `ativo IN (0,1)` do SQLite continua
 * INTEGER nas migrations portadas para nao quebrar o contrato da API, entao a
 * conversao segue existindo. Trocar as colunas para BOOLEAN e uma migration
 * separada, depois que a camada de dados estiver de pe. */
export const paraBanco = valor => (valor ? 1 : 0);
export const doBanco = valor => valor === 1;
