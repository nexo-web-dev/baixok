/* Bloqueio manual do painel por falta de pagamento.
 *
 * Interruptor manual, nao automatico: so entra em vigor quando
 * SISTEMA_BLOQUEADO for true. Troque aqui quando decidir suspender ou
 * liberar o acesso — nao depende de nenhuma data calculada, fica sob seu
 * controle direto.
 *
 * So trava o PAINEL (login, cozinha, caixa, entregador, garcom — ver
 * verificarBloqueio em admin/index.js, chamado antes de qualquer outra
 * coisa no boot). O cardapio publico do cliente final e os pedidos dele
 * continuam funcionando normalmente — quem nao tem nada a ver com o
 * pagamento em atraso nao e afetado. */
import { el, render } from "../../utils/dom.js";
import { diasAtrasoDesenvolvimento } from "./tabs/plano.js";

export const SISTEMA_BLOQUEADO = false;

export function renderizarBloqueioAcesso() {
  const dias = diasAtrasoDesenvolvimento();

  render(document.body,
    el("div.bloqueio-pagamento", {},
      el("div.bloqueio-card", {},
        el("span.plan-badge.plan-badge-alert.plan-badge-atencao", {}, "Acesso suspenso"),
        el("h1", {}, "⚠ Painel bloqueado por falta de pagamento"),
        el("div.bloqueio-dias-grupo", {},
          el("div.bloqueio-dias", {},
            el("strong", {}, String(dias)),
            el("span", {}, "dias de atraso no desenvolvimento (implantação) do sistema")
          )
        ),
        el("p", {},
          "O acesso ao painel foi suspenso porque ",
          el("strong", {}, "tanto a mensalidade quanto o desenvolvimento (implantação) do sistema estão atrasados"),
          ", sem nenhum pagamento recebido."
        ),
        el("p.plan-alert-destaque", {},
          "O cardápio e os pedidos dos seus clientes continuam funcionando normalmente — só a gestão pelo painel foi pausada até a regularização."
        ),
        el("p", {},
          el("strong", {}, "É necessário regularizar o pagamento para reativar o acesso ao painel."),
          " Entre em contato com a Nexo Developer assim que possível."
        ),
        el("div.bloqueio-acoes", {},
          el("a.primary.plan-alert-botao-grave", { href: "https://wa.me/5521970946410", target: "_blank", rel: "noopener" }, "Falar no WhatsApp"),
          el("a.secondary", { href: "mailto:solucaonexo.co@gmail.com" }, "Enviar e-mail")
        )
      )
    )
  );
}
