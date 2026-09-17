/* Plano do sistema.
 *
 * Aba simples e direta: mostra o valor fixo da mensalidade, o vencimento todo
 * dia 15 e quantos dias faltam ate a proxima data. O pagamento do
 * desenvolvimento (fechado, fora da mensalidade) tem vencimento proprio. */
import { el, render, $ } from "../../../utils/dom.js";

const VALOR_MENSALIDADE = 300;
const DIA_VENCIMENTO = 15;
const DIA_MS = 24 * 60 * 60 * 1000;

/* Ate quando a mensalidade esta confirmada como paga. Antes o vencimento so
 * girava pro mes seguinte pela data do calendario (dia 16 em diante ja
 * mostrava "proximo vencimento mes que vem"), sem checar se o pagamento
 * anterior realmente caiu — uma mensalidade atrasada ficava invisivel,
 * mostrando dias restantes normais pro mes seguinte. Atualize esta data
 * pra o vencimento (dia 15) mais recente ja recebido, a cada pagamento. */
const MENSALIDADE_PAGA_ATE = new Date(2026, 7, 15);

/* Valor fechado do desenvolvimento do sistema — separado da mensalidade
 * acima, que e a manutencao mensal. Ajuste os numeros aqui conforme os
 * pagamentos forem acontecendo. */
const VALOR_PROJETO_TOTAL = 2500;
const VALOR_PROJETO_PAGO = 1500;
const VENCIMENTO_PROJETO = new Date(2026, 8, 5);

/* A partir de quantos dias antes do vencimento cada popup aparece sozinho ao
 * logar (ver verificarAlertaVencimento, chamado em admin/index.js). */
const DIAS_ANTES_DO_ALERTA = 2;
const DIAS_ANTES_DO_ALERTA_MENSALIDADE = 3;

/* Vencimento = um mes depois do ultimo pago (MENSALIDADE_PAGA_ATE), nao "o
 * proximo dia 15 do calendario" — assim uma mensalidade que passou do dia 15
 * sem pagamento continua aparecendo em atraso (dias negativos), em vez de
 * pular pro mes seguinte como se tivesse sido paga. */
function calcularVencimentoMensalidade(agora = new Date()) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const vencimento = new Date(MENSALIDADE_PAGA_ATE.getFullYear(), MENSALIDADE_PAGA_ATE.getMonth() + 1, DIA_VENCIMENTO);
  const diferenca = Math.ceil((vencimento - hoje) / DIA_MS);
  return diferenca < 0
    ? { atrasado: true, dias: Math.abs(diferenca), vencimento }
    : { atrasado: false, dias: diferenca, vencimento };
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

function fecharModalPlano() {
  $("#plano-alerta-modal")?.remove();
}

/* Um modal so pros avisos que valerem no login (mensalidade e/ou
 * desenvolvimento) — cada aviso vira uma coluna lado a lado, em vez de
 * empilhar um popup atras do outro. Um unico botao "Entendi" fecha tudo. */
function mostrarModalPlano(avisos) {
  fecharModalPlano();
  if (!avisos.length) return;

  const modal = el("div.modal#plano-alerta-modal", { role: "dialog", "aria-modal": "true" },
    el("div.modal-card", { style: { width: avisos.length > 1 ? "min(680px, calc(100vw - 24px))" : "min(420px, calc(100vw - 24px))" } },
      el("div.plan-alert-row", {},
        ...avisos.map(({ titulo, badge, texto }) =>
          el("div.plan-alert-item", {},
            el("span.plan-badge.plan-badge-alert", {}, badge),
            el("h2", {}, titulo),
            el("p", {}, texto)
          )
        )
      ),
      el("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: "6px" } },
        el("button.primary", { type: "button", id: "plano-alerta-entendi" }, "Entendi")
      )
    )
  );

  const fechar = () => fecharModalPlano();
  document.body.append(modal);
  modal.querySelector("#plano-alerta-entendi").addEventListener("click", fechar);
  modal.addEventListener("click", evento => {
    if (evento.target === modal) fechar();
  });
}

function avisoVencimento(dias, restante) {
  /* dias vem de diasAteVencimentoProjeto() e fica NEGATIVO depois da data —
   * "Vence hoje" pra qualquer valor <= 0 escondia um pagamento ja atrasado
   * ha dias atras do dono, mostrando a mesma urgencia de "vence hoje" pra
   * "venceu ha uma semana". A aba Plano do sistema (desenharPlano) ja fazia
   * essa distincao corretamente; so faltava aqui no popup. */
  const atrasado = dias < 0;
  const diasAtraso = Math.abs(dias);
  /* "Atrasado" soava como cobranca agressiva pra quem ja pagou parte do
   * valor e so falta o restante — "Pendente" mantem a informacao real
   * (quantos dias passaram do vencimento) sem soar como cobranca dura. */
  const badge = atrasado
    ? "Pagamento pendente"
    : dias === 0 ? "Vence hoje" : `Vence em ${dias} dia${dias === 1 ? "" : "s"}`;
  const texto = atrasado
    ? `Ainda falta pagar ${formatarMoeda(restante)} do desenvolvimento do sistema — venceu há ${diasAtraso} `
      + `dia${diasAtraso === 1 ? "" : "s"} (dia ${formatarData(VENCIMENTO_PROJETO)}). Combine o pagamento do restante quando puder.`
    : `Falta pagar ${formatarMoeda(restante)} do desenvolvimento do sistema, com vencimento dia ${formatarData(VENCIMENTO_PROJETO)}. `
      + "Combine o pagamento pra manter tudo em dia.";

  return { titulo: "Pagamento do desenvolvimento", badge, texto };
}

function avisoMensalidade({ atrasado, dias, vencimento }) {
  const badge = atrasado
    ? "Pagamento pendente"
    : dias === 0 ? "Vence hoje" : `Vence em ${dias} dia${dias === 1 ? "" : "s"}`;
  const texto = atrasado
    ? `A mensalidade de ${formatarMoeda(VALOR_MENSALIDADE)} venceu há ${dias} dia${dias === 1 ? "" : "s"} `
      + `(dia ${formatarData(vencimento)}) e ainda não foi confirmada como paga. Combine o pagamento assim que possível.`
    : `A mensalidade de ${formatarMoeda(VALOR_MENSALIDADE)} vence dia ${formatarData(vencimento)}. `
      + "Combine o pagamento pra manter tudo em dia.";

  return { titulo: "Mensalidade do sistema", badge, texto };
}

/* Chamado uma vez no login (ver admin/index.js) — nao depende de a pessoa
 * abrir esta aba. So dispara pra quem realmente tem a aba (admin, ver
 * abas.js). A mensalidade nao tem controle de "ja pago" (e um lembrete fixo,
 * recalculado a cada login) — por isso so aparece nos ultimos dias antes do
 * dia 15, todo mes, em vez de sempre. O desenvolvimento so aparece se ainda
 * tiver saldo e estiver perto do proprio vencimento. Quando os dois valem,
 * aparecem lado a lado no mesmo popup em vez de um atras do outro. */
/* Selo fixo no canto, visivel em qualquer aba do admin — diferente do popup
 * de login (verificarAlertaVencimento), que so aparece uma vez e some. Uma
 * mensalidade ou o saldo do sistema vencidos ficavam sem nenhum lembrete
 * persistente enquanto a pessoa trabalhava nas outras abas o dia inteiro. So
 * aparece pra quem ja esta EM ATRASO (nao pro "vence em 3 dias" — esse
 * continua so no popup de login, pra nao virar um aviso fixo o tempo todo
 * mesmo quando ainda esta tudo em dia). */
function seloPendencia(texto) {
  return el("button.plano-selo", {
    type: "button",
    title: "Ir para Plano do sistema",
    onclick: () => document.querySelector("[data-tab='plano']")?.click()
  }, texto);
}

export function atualizarSeloVencimento() {
  document.getElementById("plano-selos")?.remove();

  const pendencias = [];

  const statusMensalidade = calcularVencimentoMensalidade();
  if (statusMensalidade.atrasado) {
    pendencias.push(`Mensalidade atrasada há ${statusMensalidade.dias} dia${statusMensalidade.dias === 1 ? "" : "s"}`);
  }

  const restanteProjeto = Math.max(0, VALOR_PROJETO_TOTAL - VALOR_PROJETO_PAGO);
  if (restanteProjeto > 0) {
    const diasProjeto = diasAteVencimentoProjeto();
    if (diasProjeto < 0) {
      const diasAtraso = Math.abs(diasProjeto);
      pendencias.push(`Sistema: falta ${formatarMoeda(restanteProjeto)}, venceu há ${diasAtraso} dia${diasAtraso === 1 ? "" : "s"}`);
    }
  }

  if (!pendencias.length) return;
  document.body.append(el("div#plano-selos.plano-selos", {}, ...pendencias.map(seloPendencia)));
}

export function verificarAlertaVencimento() {
  const avisos = [];

  const restanteProjeto = Math.max(0, VALOR_PROJETO_TOTAL - VALOR_PROJETO_PAGO);
  const statusMensalidade = calcularVencimentoMensalidade();

  if (statusMensalidade.atrasado || statusMensalidade.dias <= DIAS_ANTES_DO_ALERTA_MENSALIDADE) {
    avisos.push(avisoMensalidade(statusMensalidade));
  }

  if (restanteProjeto > 0) {
    const diasProjeto = diasAteVencimentoProjeto();
    if (diasProjeto <= DIAS_ANTES_DO_ALERTA) {
      avisos.push(avisoVencimento(diasProjeto, restanteProjeto));
    }
  }

  mostrarModalPlano(avisos);
}

export function desenharPlano() {
  const { atrasado, dias, vencimento } = calcularVencimentoMensalidade();
  const alvo = $("#plano-sistema");
  if (!alvo) return;

  const restante = Math.max(0, VALOR_PROJETO_TOTAL - VALOR_PROJETO_PAGO);
  const quitado = restante <= 0;

  render(alvo,
    el("div.plan-card", {},
      el("div.plan-badge", { class: atrasado ? "plan-badge-alert plan-badge-atencao" : "" }, atrasado ? "Pagamento pendente" : "Plano ativo"),
      el("h2", {}, "Plano do sistema"),
      el("p", {}, "A mensalidade vence todo dia 15 de cada mês."),
      el("div.plan-grid", {},
        el("div.plan-metric", {},
          el("span", {}, "Valor"),
          el("strong", {}, formatarMoeda(VALOR_MENSALIDADE))
        ),
        el("div.plan-metric", {},
          el("span", {}, "Vencimento"),
          el("strong", {}, "Dia 15")
        ),
        el("div.plan-metric", {},
          el("span", {}, atrasado ? "Dias em atraso" : "Dias restantes"),
          el("strong", { class: atrasado ? "danger-text" : "" }, `${dias} dia${dias === 1 ? "" : "s"}`)
        )
      ),
      el("div.plan-foot", {},
        el("span.small.faint", {}, atrasado ? `Venceu em: ${formatarData(vencimento)}` : `Próximo vencimento: ${formatarData(vencimento)}`),
        el("span.small.faint", {}, "Se o dia 15 cair hoje, o plano vence hoje.")
      )
    ),
    el("div.plan-card", {},
      el("div.plan-badge", { class: quitado ? "" : "plan-badge-alert plan-badge-atencao" }, quitado ? "Projeto quitado" : "Pagamento pendente"),
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
      )
    )
  );
}

export function ligarPlano() {
  desenharPlano();
}
