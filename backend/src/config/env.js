/* Configuracao vem toda daqui, validada na subida.
 *
 * O projeto antigo lia process.env espalhado por qualquer lugar do server.js e
 * caia no default silenciosamente quando a variavel vinha escrita errado. Aqui
 * o schema falha alto: subir com CONFIAR_PROXY=sim em vez de 1 para o processo
 * na hora, em vez de deixar o rate limit sem efeito ate alguem reparar. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { z } from "zod";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_BACKEND = path.resolve(aqui, "..", "..");

function carregarArquivoEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  const conteudo = fs.readFileSync(arquivo, "utf8");
  for (const linha of conteudo.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const indice = limpa.indexOf("=");
    if (indice <= 0) continue;
    const chave = limpa.slice(0, indice).trim();
    const valorBruto = limpa.slice(indice + 1).trim();
    if (process.env[chave] !== undefined) continue;
    const valor = valorBruto.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    process.env[chave] = valor;
  }
}

const RAIZ_PROJETO = path.resolve(RAIZ_BACKEND, "..");

carregarArquivoEnv(path.resolve(RAIZ_PROJETO, ".env"));
carregarArquivoEnv(path.resolve(RAIZ_PROJETO, ".env.local"));
carregarArquivoEnv(path.resolve(RAIZ_BACKEND, ".env"));
carregarArquivoEnv(path.resolve(RAIZ_BACKEND, ".env.local"));

const booleano = z
  .union([z.boolean(), z.string()])
  .transform(valor => valor === true || ["1", "true", "sim", "yes"].includes(String(valor).toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),

  /* Fora da arvore do codigo de proposito: nada em DATA_DIR pode ser alcancavel
   * por uma rota estatica, nem por engano. Depois da migracao para o Postgres
   * sobrou so como destino de upload — o banco nao mora mais aqui. */
  DATA_DIR: z.string().default(path.join(RAIZ_BACKEND, "..", "data")),

  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SESSION_COOKIE_NAME: z.string().default("bk_sessao"),
  CSRF_COOKIE_NAME: z.string().default("bk_csrf"),

  /* Ligue SO com um proxy TLS na frente. Sem proxy, quem chama direto escreve o
   * que quiser em X-Forwarded-For e escapa de todo limite por IP. */
  TRUST_PROXY: booleano.default(false),
  COOKIE_SECURE: booleano.default(false),

  /* Em producao o front e servido pelo proprio backend (mesma origem) e isto
   * fica vazio. Em dev o Vite roda em outra porta e precisa ser liberado. */
  CORS_ORIGIN: z.string().optional(),

  MAPBOX_TOKEN: z.string().optional(),
  MAPBOX_API: z.string().url().default("https://api.mapbox.com"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  SUPABASE_INSECURE_TLS: booleano.optional(),

  /* Cadeia de conexao do Postgres do Supabase (db/postgres.js). E o unico banco
   * do sistema desde que o node:sqlite saiu, entao sem ela o processo nao tem o
   * que servir — o abrirPool() derruba a subida com a mensagem explicando.
   * Continua `optional()` aqui para o erro vir de la, apontando o arquivo certo,
   * em vez de virar um "Configuracao invalida" generico.
   *
   * Use o pooler, nao a conexao direta: cada instancia do backend abre um pool
   * proprio e o limite de conexoes do projeto estoura rapido sem ele. */
  SUPABASE_DATABASE_URL: z.string().url().optional(),

  /* Bancos com mTLS (como o PostgreSQL gerenciado da Square Cloud) exigem que
   * o cliente apresente certificado e chave privada. A Square entrega ambos no
   * mesmo certificate.pem; em producao ele entra como Base64 para nao precisar
   * versionar um arquivo secreto junto da aplicacao. */
  DATABASE_CLIENT_CERT_BASE64: z.string().min(1).optional(),

  /* Tetos por IP. Configuraveis porque a loja com wifi unico faz dezenas de
   * clientes chegarem com o mesmo IP — o padrao serve para a maioria, mas quem
   * usa NAT pesado precisa afrouxar sem editar codigo. */
  LIMITE_LOGIN: z.coerce.number().int().min(1).default(10),
  LIMITE_PEDIDO: z.coerce.number().int().min(1).default(20),
  LIMITE_GEOCODIFICACAO: z.coerce.number().int().min(1).default(120),
  LIMITE_GERAL: z.coerce.number().int().min(1).default(3000),

  /* Usado so pelo `npm run seed` para criar o primeiro administrador. */
  ADMIN_BOOTSTRAP_USER: z.string().min(3).default("admin"),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(10).optional(),
  BALCAO_BOOTSTRAP_PASSWORD: z.string().min(10).optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info")
});

const resultado = schema.safeParse(process.env);
if (!resultado.success) {
  const problemas = resultado.error.issues
    .map(issue => `  - ${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
    .join("\n");
  console.error(`Configuracao invalida. Corrija o .env:\n${problemas}`);
  process.exit(1);
}

export const env = Object.freeze({
  ...resultado.data,
  RAIZ_BACKEND,
  ehProducao: resultado.data.NODE_ENV === "production",
  ehTeste: resultado.data.NODE_ENV === "test",
  SUPABASE_INSECURE_TLS: resultado.data.SUPABASE_INSECURE_TLS ?? resultado.data.NODE_ENV !== "production",
  UPLOADS_DIR: path.join(resultado.data.DATA_DIR, "uploads"),
  SESSION_TTL_MS: resultado.data.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
});

/* Aviso, nao erro: da para rodar na rede da loja sem proxy nenhum. */
if (env.ehProducao && env.TRUST_PROXY && !env.COOKIE_SECURE) {
  console.warn("AVISO: TRUST_PROXY ligado sem COOKIE_SECURE. Se ha TLS na frente, ligue COOKIE_SECURE=1.");
}
