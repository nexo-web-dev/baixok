/* Plano do sistema.
 *
 * Aba simples e direta: mostra o valor fixo da mensalidade, o vencimento todo
 * dia 15 e quantos dias faltam ate a proxima data. O pagamento do
 * desenvolvimento (fechado, fora da mensalidade) tem vencimento proprio. */
import { el, render, $ } from "../../../utils/dom.js";

const VALOR_MENSALIDADE = 300;
const DIA_VENCIMENTO = 15;
const PRIMEIRO_VENCIMENTO = new Date(2026, 8, 15);

/* Valor fechado do desenvolvimento do sistema — separado da mensalidade
 * acima, que e a manutencao mensal. Ajuste os numeros aqui conforme os
 * pagamentos forem acontecendo. */
const VALOR_PROJETO_TOTAL = 2500;
const VALOR_PROJETO_PAGO = 1000;
const VENCIMENTO_PROJETO = new Date(2026, 8, 5);

/* A partir de quantos dias antes do vencimento do desenvolvimento o alerta
 * aparece sozinho ao logar (ver verificarAlertaVencimento, chamado em
 * admin/index.js). Nao tem alerta pra mensalidade — so pro pagamento do
 * desenvolvimento, que foi o que pediram. */
const DIAS_ANTES_DO_ALERTA = 2;

function calcularProximoVencimento(agora = new Date()) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  if (hoje < PRIMEIRO_VENCIMENTO) {
    const diasIniciais = Math.max(0, Math.ceil((PRIMEIRO_VENCIMENTO - hoje) / (24 * 60 * 60 * 1000)));
    return { vencimento: PRIMEIRO_VENCIMENTO, dias: diasIniciais, isento: true };
  }
  let vencimento = new Date(agora.getFullYear(), agora.getMonth(), DIA_VENCIMENTO);
  if (hoje > vencimento) {
    vencimento = new Date(agora.getFullYear(), agora.getMonth() + 1, DIA_VENCIMENTO);
  }
  const dias = Math.max(0, Math.ceil((vencimento - hoje) / (24 * 60 * 60 * 1000)));
  return { vencimento, dias, isento: false };
}

/* Diferente da mensalidade: o pagamento do desenvolvimento nao se repete todo
 * mes, e uma data unica ate quitar o valor combinado. */
function diasAteVencimentoProjeto(agora = new Date()) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  return Math.ceil((VENCIMENTO_PROJETO - hoje) / (24 * 60 * 60 * 1000));
}

function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

function formatarData(data) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(data);
}

function fecharAlertaVencimento() {
  $("#plano-alerta-modal")?.remove();
}

function mostrarAlertaVencimento(dias, restante) {
  fecharAlertaVencimento();

  const modal = el("div.modal#plano-alerta-modal", { role: "dialog", "aria-modal": "true" },
    el("div.modal-card", { style: { maxWidth: "420px" } },
      el("span.plan-badge.plan-badge-alert", {}, dias <= 0 ? "Vence hoje" : `Vence em ${dias} dia${dias === 1 ? "" : "s"}`),
      el("h2", {}, "Pagamento do desenvolvimento"),
      el("p", {},
        `Falta pagar ${formatarMoeda(restante)} do desenvolvimento do sistema, com vencimento dia ${formatarData(VENCIMENTO_PROJETO)}. `
        + "Combine o pagamento pra manter tudo em dia."),
      el("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: "6px" } },
        el("button.primary", { type: "button", id: "plano-alerta-entendi" }, "Entendi")
      )
    )
  );
  document.body.append(modal);
  modal.querySelector("#plano-alerta-entendi").addEventListener("click", fecharAlertaVencimento);
  modal.addEventListener("click", evento => {
    if (evento.target === modal) fecharAlertaVencimento();
  });
}

/* Chamado uma vez no login (ver admin/index.js) — nao depende de a pessoa
 * abrir esta aba. So dispara pra quem realmente tem a aba (admin, ver
 * abas.js), so se ainda falta pagar, e so nos ultimos dias antes do
 * vencimento do desenvolvimento — a mensalidade nao tem esse alerta. */
export function verificarAlertaVencimento() {
  const restante = Math.max(0, VALOR_PROJETO_TOTAL - VALOR_PROJETO_PAGO);
  if (restante <= 0) return;

  const dias = diasAteVencimentoProjeto();
  if (dias > DIAS_ANTES_DO_ALERTA) return;
  mostrarAlertaVencimento(dias, restante);
}

export function desenharPlano() {
  const { vencimento, dias, isento } = calcularProximoVencimento();
  const alvo = $("#plano-sistema");
  if (!alvo) return;

  const restante = Math.max(0, VALOR_PROJETO_TOTAL - VALOR_PROJETO_PAGO);
  const quitado = restante <= 0;
  const diasProjeto = diasAteVencimentoProjeto();

  render(alvo,
    el("div.plan-card", {},
      el("div.plan-badge", {}, "Plano ativo"),
      el("h2", {}, "Plano do sistema"),
      el("p", {}, isento
        ? "Agosto está isento. A primeira mensalidade vence em 15/09/2026."
        : "A mensalidade vence todo dia 15 de cada mês."),
      el("div.plan-grid", {},
        el("div.plan-metric", {},
          el("span", {}, "Valor"),
          el("strong", {}, formatarMoeda(VALOR_MENSALIDADE))
        ),
        el("div.plan-metric", {},
          el("span", {}, "Vencimento"),
          el("strong", {}, isento ? "15/09" : "Dia 15")
        ),
        el("div.plan-metric", {},
          el("span", {}, "Dias restantes"),
          el("strong", {}, `${dias} dia${dias === 1 ? "" : "s"}`)
        )
      ),
      el("div.plan-foot", {},
        el("span.small.faint", {}, `Próximo vencimento: ${formatarData(vencimento)}`),
        el("span.small.faint", {}, isento ? "A contagem mensal normal começa depois desta data." : "Se o dia 15 cair hoje, o plano vence hoje.")
      )
    ),
    el("div.plan-card", {},
      el("div.plan-badge", { class: quitado ? "" : "plan-badge-alert" }, quitado ? "Projeto quitado" : "Pagamento pendente"),
      el("h2", {}, "Desenvolvimento do sistema"),
      el("p", {}, quitado
        ? "O valor fechado do projeto já foi pago integralmente."
        : `Falta pagar ${formatarMoeda(restante)} do valor combinado pelo desenvolvimento do sistema.`),
      el("div.plan-grid", {},
        el("div.plan-metric", {},
          el("span", {}, "Valor total"),
          el("strong", {}, formatarMoeda(VALOR_PROJETO_TOTAL))
        ),
        el("div.plan-metric", {},
          el("span", {}, "Já pago"),
          el("strong", {}, formatarMoeda(VALOR_PROJETO_PAGO))
        ),
        el("div.plan-metric", {},
          el("span", {}, "Falta pagar"),
          el("strong", { class: quitado ? "" : "danger-text" }, formatarMoeda(restante))
        )
      ),
      quitado ? null : el("div.plan-foot", {},
        el("span.small.faint", {}, `Vencimento: ${formatarData(VENCIMENTO_PROJETO)}`),
        el("span.small.faint", { class: diasProjeto <= DIAS_ANTES_DO_ALERTA ? "danger-text" : "" },
          diasProjeto < 0
            ? `Venceu há ${Math.abs(diasProjeto)} dia${Math.abs(diasProjeto) === 1 ? "" : "s"}`
            : diasProjeto === 0
              ? "Vence hoje"
              : `Vence em ${diasProjeto} dia${diasProjeto === 1 ? "" : "s"}`)
      )
    )
  );
}

export function ligarPlano() {
  desenharPlano();
}
