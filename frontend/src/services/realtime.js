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

export function conectarEventos({ canal, aoMudar, aoStatus }) {
  let fonte = null;
  let espera = ESPERA_INICIAL_MS;
  let timerReconexao = null;
  let timerOffline = null;
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
      espera = ESPERA_INICIAL_MS;      // reconectou: zera a espera
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
      espera = ESPERA_MAXIMA_MS;
      fonte.close();
      agendarReconexao();
    });

    fonte.onerror = () => {
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
    document.removeEventListener("visibilitychange", aoVoltar);
    fonte?.close();
  };
}
