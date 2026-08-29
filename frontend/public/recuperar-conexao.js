/* Recupera sozinho de uma falha de rede pontual ao carregar a pagina.
 *
 * ERR_QUIC_PROTOCOL_ERROR e parecidos acontecem quando a conexao do
 * navegador (ou a borda do Cloudflare) falha no meio do download de um
 * arquivo — script, CSS ou modulo carregado sob demanda. O resultado e uma
 * pagina pela metade: o que ja tinha carregado fica na tela, o resto nunca
 * chega, e sem isso a pessoa ficava vendo tela preta sem saber que so
 * precisava recarregar.
 *
 * Fica em arquivo proprio (nao inline no HTML) porque o Content-Security-
 * -Policy do servidor so libera script do proprio dominio (scriptSrc 'self'),
 * sem 'unsafe-inline' — um <script> solto no meio do HTML seria bloqueado e
 * nem chegaria a rodar. Precisa ser o PRIMEIRO <script> de cada pagina, antes
 * do CSS e do modulo principal, pra ja estar escutando quando os outros
 * arquivos comecam a carregar. */
(function () {
  var CHAVE = "_bk_reload_erro_recurso";
  var JANELA_MS = 15000;

  function aoFalhar(evento) {
    var alvo = evento.target;
    if (!alvo || !alvo.tagName) return;
    var ehRecurso = alvo.tagName === "SCRIPT" || alvo.tagName === "LINK";
    if (!ehRecurso) return;

    var agora = Date.now();
    var ultimaTentativa = Number(sessionStorage.getItem(CHAVE) || 0);
    /* So recarrega uma vez por janela: uma falha de verdade (arquivo apagado
     * do servidor, por exemplo) nao pode virar loop infinito de reload. */
    if (agora - ultimaTentativa < JANELA_MS) return;

    sessionStorage.setItem(CHAVE, String(agora));
    location.reload();
  }

  window.addEventListener("error", aoFalhar, true);
})();
