/* Ponto de entrada: abre o pool, aplica migrations, sobe o servidor.
 *
 * A ordem importa e mudou com o Postgres. Antes o SQLite abria de imediato e o
 * `listen` podia vir junto; agora migrar() e uma ida a rede, e subir o servidor
 * antes dela deixaria uma janela em que a API responde com tabela inexistente.
 * Por isso o await vem primeiro e o listen so acontece depois. */
import { env } from "./config/env.js";
import { abrirPool, fecharPool } from "./db/postgres.js";
import { migrar } from "./db/migrate.js";
import { criarApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { iniciarPing } from "./lib/events.js";
import { sessoesRepo } from "./repositories/sessoes.repo.js";
import { usuariosRepo } from "./repositories/usuarios.repo.js";
import { entregaRepo } from "./repositories/entrega.repo.js";
import { limparFalhasVencidas } from "./services/auth.service.js";

/* Falhar aqui e melhor do que subir e responder 500 em toda rota: sem banco o
 * sistema nao serve para nada, e o host reinicia o processo. */
try {
  abrirPool();
  await migrar();
} catch (erro) {
  logger.error("Nao foi possivel preparar o banco", { erro: erro.message });
  await fecharPool();
  process.exit(1);
}

const app = criarApp();
const servidor = app.listen(env.PORT, () => {
  logger.info(`Baixo K no ar em http://localhost:${env.PORT}`, {
    ambiente: env.NODE_ENV,
    banco: "postgres"
  });
});

/* Causa classica de 502 aleatorio atras de um proxy/CDN (Cloudflare, no nosso
 * caso): o Node fecha conexao "keep-alive" ociosa depois de 5s por padrao,
 * mas o Cloudflare guarda a conexao pra reusar por mais tempo que isso. Se o
 * Cloudflare manda uma requisicao nova bem no instante em que o Node ja
 * decidiu fechar aquela conexao, o proxy recebe a conexao caindo no meio e
 * devolve 502 pro navegador — sem nenhum erro no nosso log, porque do lado
 * do Node aquilo e so uma conexao ociosa fechada normalmente. Isso bate com
 * o que aconteceu hoje: intermitente, sem relacao com RAM/CPU, "as vezes
 * funciona as vezes nao". O ajuste padrao pra quem fica atras de proxy e
 * manter o keep-alive do Node MAIOR que o do proxy na frente. */
servidor.keepAliveTimeout = 65000;
servidor.headersTimeout = 66000;

/* Instalacao nova sem ninguem cadastrado nao pode ficar em silencio: sem esse
 * aviso, o primeiro login e impossivel e nao ha pista do porque.
 *
 * Fora do callback do listen porque agora e assincrono — e a consulta nao pode
 * atrasar a abertura da porta. */
if ((await usuariosRepo.contarAdminsAtivos()) === 0) {
  logger.warn("Nenhum administrador cadastrado. Rode `npm run seed` para criar o primeiro acesso.");
}

/* Zona configurada sem token e uma loja aceitando pedido de mesa mas recusando
 * todo pedido de entrega — silenciosamente, so descoberto quando um cliente
 * reclama. Este aviso sai em todo restart enquanto o descompasso existir, para
 * aparecer no log do host (Square Cloud, Render, etc.) sem depender de alguem
 * lembrar de checar. */
const configEntregaInicial = await entregaRepo.config();
if (configEntregaInicial.zones.length && !env.MAPBOX_TOKEN) {
  logger.error(
    "Ha faixas de entrega configuradas mas MAPBOX_TOKEN nao esta definido. " +
    "Todo pedido de entrega (cardapio e lancamento manual) vai falhar ate a variavel ser configurada neste ambiente."
  );
}

iniciarPing();

/* Faxina de hora em hora: sessao vencida e trava de login expirada.
 *
 * O backup diario saiu junto com o SQLite. O banco agora e o Postgres do
 * Supabase, que faz backup no proprio painel (Database -> Backups); um
 * `VACUUM INTO` local nao existe la, e copiar a base inteira de hora em hora
 * pela rede seria pior do que o que o Supabase ja garante. */
const faxina = setInterval(() => {
  void (async () => {
    try {
      const removidas = await sessoesRepo.limparVencidas();
      limparFalhasVencidas();
      if (removidas) logger.debug("Sessoes vencidas removidas", { removidas });
    } catch (erro) {
      /* Faxina que falha nao pode derrubar a loja: registra e tenta na proxima. */
      logger.error("Falha na faxina periodica", { erro: erro.message });
    }
  })();
}, 60 * 60 * 1000);
faxina.unref();

let encerrando = false;
async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  logger.info(`Encerrando (${sinal})`);

  /* Se alguma conexao SSE nao fechar sozinha, nao ficamos presos para sempre. */
  const prazo = setTimeout(() => process.exit(0), 5000);
  prazo.unref();

  await new Promise(resolve => servidor.close(resolve));
  await fecharPool();
  process.exit(0);
}

process.on("SIGINT", () => encerrar("SIGINT"));
process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("unhandledRejection", motivo => {
  logger.error("Promise rejeitada sem tratamento", { erro: String(motivo) });
});

/* Sem isto, um erro sincrono que escape de todo try/catch (ex: um bug num
 * callback de setInterval, fora da cadeia de promises de uma requisicao)
 * derruba o processo inteiro em silencio — o host reinicia sozinho, mas nao
 * fica nenhum rastro do que aconteceu, so o hiato de "caiu e voltou" que
 * aparece pro cliente como erro 520 do Cloudflare. Registrar antes de sair
 * nao evita a queda (o processo pode estar num estado invalido pra continuar),
 * mas da o log que falta pra saber a causa na proxima vez. */
process.on("uncaughtException", erro => {
  logger.error("Erro fatal nao tratado — processo vai reiniciar", { erro: erro.message, stack: erro.stack });
  process.exit(1);
});
