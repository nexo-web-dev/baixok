/* Avisos do servidor por Server-Sent Events.
 *
 * O canal e escolhido pela pagina, mas quem decide o que ela pode ouvir e o
 * servidor: pedir o canal de operacao sem sessao devolve 401. Aqui e so o
 * transporte.
 *
 * O sistema antigo abria o EventSource e nunca mais olhava para ele. Quando o
 * wifi da loja caia, o tablet da cozinha parava de receber pedido e ninguem
 * percebia — a tela continuava mostrando a fila antiga, sem erro nenhum. */

const ESPERA_INICIAL_MS = 1000;
const ESPERA_MAXIMA_MS = 30000;
const ATRASO_OFFLINE_MS = 12000;
/* Quanto tempo a conexao precisa ficar de pe, sem cair de novo, para a gente
 * confiar que "voltou de verdade" e zerar a espera pro minimo. */
const TEMPO_MINIMO_ESTAVEL_MS = 5000;

export function conectarEventos({ canal, aoMudar, aoStatus }) {
  let fonte = null;
  let espera = ESPERA_INICIAL_MS;
  let timerReconexao = null;
  let timerOffline = null;
  let timerEstabilidade = null;
  let encerrado = false;

  const avisarStatus = estado => aoStatus?.(estado);

  function avisarConectado() {
    clearTimeout(timerOffline);
    timerOffline = null;
    avisarStatus("conectado");
  }

  function avisarOfflineSePersistir() {
    clearTimeout(timerOffline);
    timerOffline = setTimeout(() => avisarStatus("desconectado"), ATRASO_OFFLINE_MS);
  }

  function abrir() {
    if (encerrado) return;
    fonte = new EventSource(`/api/eventos/${canal}`);

    fonte.addEventListener("pronto", () => {
      /* NAO zera a espera aqui na hora — uma rede que fica caindo e voltando
       * em flashes (o suporte da hospedagem chamou isso de "spam de conexao")
       * receberia "pronto" a cada reconexao e voltaria a martelar a cada 1s
       * pra sempre, ja que o erro seguinte reabriria o ciclo do zero. So
       * confia que a conexao "voltou de verdade" (e so entao zera a espera)
       * depois de ficar de pe por TEMPO_MINIMO_ESTAVEL_MS sem cair de novo. */
      clearTimeout(timerEstabilidade);
      timerEstabilidade = setTimeout(() => { espera = ESPERA_INICIAL_MS; }, TEMPO_MINIMO_ESTAVEL_MS);
      avisarConectado();
    });

    fonte.addEventListener("mudanca", evento => {
      try {
        const { assunto } = JSON.parse(evento.data);
        aoMudar?.(assunto);
      } catch {
        aoMudar?.("desconhecido");     // payload estranho: recarrega tudo
      }
    });

    /* Teto de conexoes atingido no servidor: nao adianta insistir rapido. */
    fonte.addEventListener("cheio", () => {
      clearTimeout(timerEstabilidade);
      espera = ESPERA_MAXIMA_MS;
      fonte.close();
      agendarReconexao();
    });

    fonte.onerror = () => {
      clearTimeout(timerEstabilidade);
      avisarOfflineSePersistir();
      fonte.close();
      agendarReconexao();
    };
  }

  /* Espera crescente: uma loja com 5 tablets religando ao mesmo tempo nao pode
   * martelar o servidor a cada segundo enquanto ele sobe. */
  function agendarReconexao() {
    if (encerrado || timerReconexao) return;
    timerReconexao = setTimeout(() => {
      timerReconexao = null;
      espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
      abrir();
    }, espera);
  }

  abrir();

  /* Voltar para a aba forca uma releitura: o navegador suspende conexao em aba
   * de fundo, e o aparelho pode ter perdido avisos enquanto estava dormindo. */
  const aoVoltar = () => {
    if (document.visibilityState === "visible") aoMudar?.("retomada");
  };
  document.addEventListener("visibilitychange", aoVoltar);

  return () => {
    encerrado = true;
    clearTimeout(timerReconexao);
    clearTimeout(timerOffline);
    clearTimeout(timerEstabilidade);
    document.removeEventListener("visibilitychange", aoVoltar);
    fonte?.close();
  };
}
