/* Botao "Imprimir ou salvar PDF" do relatorio de fechamento de caixa.
 *
 * Precisa ser um arquivo separado, nao onclick="" inline: o CSP do servidor
 * (script-src sem 'unsafe-inline', ver backend/src/app.js) bloqueia qualquer
 * script inline de proposito, pra um nome de produto com <script> dentro nunca
 * poder executar nada. */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector(".print-btn")?.addEventListener("click", () => window.print());
});
