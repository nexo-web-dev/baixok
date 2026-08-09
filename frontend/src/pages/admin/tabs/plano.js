/* Plano do sistema.
 *
 * Aba simples e direta: mostra o valor fixo da mensalidade, o vencimento todo
 * dia 15 e quantos dias faltam ate a proxima data. */
import { el, render, $ } from "../../../utils/dom.js";

const VALOR_MENSALIDADE = 300;
const DIA_VENCIMENTO = 15;
const PRIMEIRO_VENCIMENTO = new Date(2026, 8, 15);

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

function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

function formatarData(data) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(data);
}

export function desenharPlano() {
  const { vencimento, dias, isento } = calcularProximoVencimento();
  const alvo = $("#plano-sistema");
  if (!alvo) return;

  render(alvo,
    el("div.plan-card", {},
      el("div.plan-badge", {}, "Plano ativo"),
      el("h2", {}, "Plano do sistema"),
      el("p", {}, isento
        ? "Agosto esta isento. A primeira mensalidade vence em 15/09/2026."
        : "A mensalidade vence todo dia 15 de cada mes."),
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
        el("span.small.faint", {}, `Proximo vencimento: ${formatarData(vencimento)}`),
        el("span.small.faint", {}, isento ? "A contagem mensal normal comeca depois desta data." : "Se o dia 15 cair hoje, o plano vence hoje.")
      )
    )
  );
}

export function ligarPlano() {
  desenharPlano();
}
