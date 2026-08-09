import { el, render, $ } from "../../../utils/dom.js";
import { reais, dataHora } from "../../../utils/formato.js";
import { apiCaixa } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toastOk, toastFalha } from "../../../components/toast.js";

function podeOperarCaixa() {
  return ["admin", "caixa"].includes(estado.usuario?.papel);
}

function atualizarStatusCaixa() {
  const alvo = $("#cash-status");
  const abrir = $("#open-cash");
  const fechar = $("#close-cash");
  if (!alvo) return;

  const permitido = podeOperarCaixa();
  if (abrir) abrir.classList.toggle("hidden", !permitido);
  if (fechar) fechar.classList.toggle("hidden", !permitido);

  if (!estado.caixaAtual) {
    alvo.textContent = "Caixa fechado";
    alvo.classList.remove("open");
    if (abrir) abrir.disabled = !permitido;
    if (fechar) fechar.disabled = true;
    return;
  }

  alvo.textContent = `Caixa aberto desde ${dataHora(estado.caixaAtual.abertoEm)}`;
  alvo.classList.add("open");
  if (abrir) abrir.disabled = true;
  if (fechar) fechar.disabled = !permitido;
}

export async function desenharCaixaStatus() {
  try {
    await carregar("caixa");
    atualizarStatusCaixa();
  } catch (erro) {
    toastFalha(erro, "Caixa");
  }
}

function fechamentoLinha(caixa) {
  const aberto = dataHora(caixa.abertoEm);
  const fechado = caixa.fechadoEm ? dataHora(caixa.fechadoEm) : "Em aberto";

  return el("article.closing-row", {},
    el("div.closing-main", {},
      el("strong", {}, fechado),
      el("span", {}, `Aberto: ${aberto} | Por: ${caixa.abertoPorNome || "-"}`),
      el("em", {}, `Fechado por ${caixa.fechadoPorNome || "-"} | ${caixa.pedidos} pedidos | ${caixa.cancelados} cancelados`)
    ),
    el("div.closing-side", {},
      el("strong", {}, reais(caixa.faturamento)),
      el("span", {}, `Entrega ${caixa.entregas} | Retirada ${caixa.retiradas} | Mesa ${caixa.mesas}`),
      caixa.status === "fechado"
        ? el("a.secondary.small", { href: apiCaixa.relatorioUrl(caixa.id), target: "_blank", rel: "noopener" }, "Abrir PDF")
        : null
    )
  );
}

export async function desenharFechamentos() {
  try {
    await carregar("fechamentos");
    render($("#closing-list"), estado.fechamentos.length
      ? estado.fechamentos.map(fechamentoLinha)
      : el("p.faint.pad", {}, "Nenhum fechamento salvo ainda."));
  } catch (erro) {
    toastFalha(erro, "Fechamentos");
  }
}

async function abrirCaixa() {
  const botao = $("#open-cash");
  if (!confirm("Abrir o caixa de hoje? As vendas ate o fechamento entram neste movimento.")) return;
  if (botao) botao.disabled = true;
  try {
    await apiCaixa.abrir();
    toastOk("Caixa aberto.");
    await desenharCaixaStatus();
  } catch (erro) {
    toastFalha(erro, "Caixa");
  } finally {
    if (botao) botao.disabled = false;
    atualizarStatusCaixa();
  }
}

async function fecharCaixa() {
  if (!estado.caixaAtual) return toastFalha(new Error("Nao ha caixa aberto."), "Caixa");
  const observacao = prompt("Observacao do fechamento (opcional):", "") ?? "";
  if (!confirm("Fechar o caixa agora e gerar o relatorio do periodo?")) return;

  const botao = $("#close-cash");
  if (botao) botao.disabled = true;
  try {
    const { caixa } = await apiCaixa.fechar(observacao);
    toastOk("Caixa fechado.");
    await carregar("caixa", "fechamentos");
    atualizarStatusCaixa();
    await desenharFechamentos();
    window.open(apiCaixa.relatorioUrl(caixa.id), "_blank", "noopener");
  } catch (erro) {
    toastFalha(erro, "Caixa");
  } finally {
    if (botao) botao.disabled = false;
    atualizarStatusCaixa();
  }
}

export function ligarFechamentos() {
  $("#open-cash")?.addEventListener("click", abrirCaixa);
  $("#close-cash")?.addEventListener("click", fecharCaixa);
  $("#refresh-closings")?.addEventListener("click", desenharFechamentos);
}
