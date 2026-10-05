/* Plano do sistema.
 *
 * Nenhum valor ou data mora aqui: tudo vem de GET /painel/plano, que le a
 * tabela plano_cobranca e calcula os status no servidor. Assim quem abre o
 * devtools nao consegue mudar o que a tela mostra. */
import { el, render, $ } from "../../../utils/dom.js";
import { apiPlano } from "../../../services/api.js";

function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

/* Datas vem do servidor como AAAA-MM-DD; formata sem passar por Date pra nao
 * deslocar um dia por causa do fuso do navegador. */
function formatarData(iso) {
  return String(iso || "").split("-").reverse().join("/");
}

const plural = (n, singular, plural_) => `${n} ${n === 1 ? singular : plural_}`;

function fecharModalPlano() {
  $("#plano-alerta-modal")?.remove();
}

/* Um modal so pros avisos que valerem no login — cada aviso vira uma coluna
 * lado a lado, em vez de empilhar um popup atras do outro. */
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

function avisoMensalidade(mensalidade) {
  const { valor, atrasado, dias, vencimento } = mensalidade;
  const badge = atrasado
    ? "Pagamento pendente"
    : dias === 0 ? "Vence hoje" : `Vence em ${plural(dias, "dia", "dias")}`;
  const texto = atrasado
    ? `A mensalidade de ${formatarMoeda(valor)} venceu há ${plural(dias, "dia", "dias")} `
      + `(dia ${formatarData(vencimento)}) e ainda não foi confirmada como paga. Combine o pagamento assim que possível.`
    : `A mensalidade de ${formatarMoeda(valor)} vence dia ${formatarData(vencimento)}. `
      + "Combine o pagamento pra manter tudo em dia.";

  return { titulo: "Mensalidade do sistema", badge, texto };
}

function avisoProjeto(projeto) {
  const texto = projeto.atrasadoPrazo
    ? `O pagamento do desenvolvimento do sistema está pendente — ainda falta pagar ${formatarMoeda(projeto.restante)}. `
      + `O prazo final combinado (${formatarData(projeto.prazoFinal)}) já passou. Acerte o pagamento o quanto antes.`
    : `O pagamento do desenvolvimento do sistema está pendente — ainda falta pagar ${formatarMoeda(projeto.restante)}. `
      + `Acerte o pagamento até o prazo final combinado, dia ${formatarData(projeto.prazoFinal)}.`;

  return { titulo: "Pagamento do desenvolvimento", badge: "Pagamento pendente", texto };
}

/* Selo fixo no canto, visivel em qualquer aba do admin enquanto houver
 * pendencia em atraso. */
function seloPendencia(texto) {
  return el("button.plano-selo", {
    type: "button",
    title: "Ir para Plano do sistema",
    onclick: () => document.querySelector("[data-tab='plano']")?.click()
  }, texto);
}

export async function atualizarSeloVencimento() {
  document.getElementById("plano-selos")?.remove();
  let status;
  try {
    status = await apiPlano.status();
  } catch {
    return;
  }

  const pendencias = [];
  if (status.mensalidade.atrasado) {
    pendencias.push(`Mensalidade atrasada há ${plural(status.mensalidade.dias, "dia", "dias")}`);
  }
  if (!status.projeto.quitado && status.projeto.vencidoOriginal) {
    pendencias.push(`Sistema: falta ${formatarMoeda(status.projeto.restante)}, venceu há ${plural(status.projeto.diasDesdeVencimentoOriginal, "dia", "dias")}`);
  }

  if (!pendencias.length) return;
  document.body.append(el("div#plano-selos.plano-selos", {}, ...pendencias.map(seloPendencia)));
}

export async function verificarAlertaVencimento() {
  let status;
  try {
    status = await apiPlano.status();
  } catch {
    return;
  }

  const avisos = [];
  if (status.mensalidade.alertaLogin) avisos.push(avisoMensalidade(status.mensalidade));
  if (status.projeto.alertaLogin) avisos.push(avisoProjeto(status.projeto));
  mostrarModalPlano(avisos);
}

export async function desenharPlano() {
  const alvo = $("#plano-sistema");
  if (!alvo) return;

  let status;
  try {
    status = await apiPlano.status();
  } catch {
    render(alvo, el("p.faint.pad", {}, "Não foi possível carregar o plano agora. Tente de novo em instantes."));
    return;
  }

  const { mensalidade, projeto } = status;
  const quitado = projeto.quitado;

  render(alvo,
    el("div.plan-card", {},
      el("div.plan-badge", { class: mensalidade.atrasado ? "plan-badge-alert plan-badge-atencao" : "" }, mensalidade.atrasado ? "Pagamento pendente" : "Plano ativo"),
      el("h2", {}, "Plano do sistema"),
      el("p", {}, "A mensalidade vence todo dia 15 de cada mês."),
      el("div.plan-grid", {},
        el("div.plan-metric", {},
          el("span", {}, "Valor"),
          el("strong", {}, formatarMoeda(mensalidade.valor))
        ),
        el("div.plan-metric", {},
          el("span", {}, "Vencimento"),
          el("strong", {}, "Dia 15")
        ),
        el("div.plan-metric", {},
          el("span", {}, mensalidade.atrasado ? "Dias em atraso" : "Dias restantes"),
          el("strong", { class: mensalidade.atrasado ? "danger-text" : "" }, plural(mensalidade.dias, "dia", "dias"))
        )
      ),
      el("div.plan-foot", {},
        el("span.small.faint", {}, mensalidade.atrasado
          ? `Venceu em: ${formatarData(mensalidade.vencimento)}`
          : `Próximo vencimento: ${formatarData(mensalidade.vencimento)}`),
        el("span.small.faint", {}, "Se o dia 15 cair hoje, o plano vence hoje.")
      )
    ),
    el("div.plan-card", {},
      el("div.plan-badge", { class: quitado ? "" : "plan-badge-alert plan-badge-atencao" }, quitado ? "Projeto quitado" : "Pagamento pendente"),
      el("h2", {}, "Desenvolvimento do sistema"),
      el("p", {}, quitado
        ? "O valor fechado do projeto já foi pago integralmente."
        : `Falta pagar ${formatarMoeda(projeto.restante)} do valor combinado pelo desenvolvimento do sistema.`),
      el("div.plan-grid", {},
        el("div.plan-metric", {},
          el("span", {}, "Valor total"),
          el("strong", {}, formatarMoeda(projeto.valorTotal))
        ),
        el("div.plan-metric", {},
          el("span", {}, "Já pago"),
          el("strong", {}, formatarMoeda(projeto.pago))
        ),
        el("div.plan-metric", {},
          el("span", {}, "Falta pagar"),
          el("strong", { class: quitado ? "" : "danger-text" }, formatarMoeda(projeto.restante))
        )
      )
    )
  );
}

export function ligarPlano() {
  desenharPlano();
}
