import { el, render, $, delegar, mostrar, ligarModal } from "../../../utils/dom.js";
import { reais, dataHora } from "../../../utils/formato.js";
import { apiCaixa } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toastOk, toastFalha } from "../../../components/toast.js";

function podeOperarCaixa() {
  return ["admin", "caixa"].includes(estado.usuario?.papel);
}

/* Agenda do mes: um calendario visual dos dias que tiveram caixa aberto,
 * montado so com o que o navegador ja tem em estado.fechamentos (nenhuma
 * rota nova) — cada fechamento e agrupado pelo dia (fuso de Sao Paulo) do
 * seu ABERTO_EM, nao do fechado_em, pra um caixa que abre de noite e fecha
 * de madrugada continuar contando pro dia em que o movimento comecou. */
const MESES_ROTULO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

const agenda = { ano: new Date().getFullYear(), mes: new Date().getMonth(), diaSelecionado: null };

function chaveDia(dataIso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(dataIso));
}

function horaSP(dataIso) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(dataIso));
}

function agendaPorDia() {
  const mapa = new Map();
  const diaDe = chave => {
    if (!mapa.has(chave)) mapa.set(chave, { faturamento: 0, sessoes: [], emAndamento: false });
    return mapa.get(chave);
  };

  for (const caixa of estado.fechamentos) {
    if (caixa.status !== "fechado") continue;
    const dia = diaDe(chaveDia(caixa.abertoEm));
    dia.faturamento += Number(caixa.faturamento || 0);
    dia.sessoes.push(caixa);
  }
  if (estado.caixaAtual) {
    const dia = diaDe(chaveDia(estado.caixaAtual.abertoEm));
    dia.sessoes.push(estado.caixaAtual);
    dia.emAndamento = true;
  }
  for (const dia of mapa.values()) dia.sessoes.sort((a, b) => new Date(a.abertoEm) - new Date(b.abertoEm));
  return mapa;
}

function horarioSessao(caixa) {
  return caixa.status === "aberto" ? `${horaSP(caixa.abertoEm)}–em andamento` : `${horaSP(caixa.abertoEm)}–${horaSP(caixa.fechadoEm)}`;
}

function detalheDia(chave, dados) {
  const [ano, mes, dia] = chave.split("-").map(Number);
  const rotuloDia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" })
    .format(new Date(Date.UTC(ano, mes - 1, dia, 12)));

  if (!dados) {
    return el("div.agenda-dia-detalhe-inner", {},
      el("strong", {}, rotuloDia.charAt(0).toUpperCase() + rotuloDia.slice(1)),
      el("p.faint.small", {}, "Sem caixa aberto neste dia."));
  }

  return el("div.agenda-dia-detalhe-inner", {},
    el("strong", {}, rotuloDia.charAt(0).toUpperCase() + rotuloDia.slice(1)),
    el("p.small", {}, `Faturamento do dia: `, el("strong", {}, reais(dados.faturamento))),
    ...dados.sessoes.map(caixa => el("div.agenda-sessao", {},
      el("span", {}, horarioSessao(caixa)),
      caixa.status === "fechado"
        ? el("span", {}, `${reais(caixa.faturamento)} · ${caixa.pedidos} pedido(s)`)
        : el("span.small.faint", {}, "caixa aberto agora"),
      caixa.status === "fechado"
        ? el("a.secondary.small", { href: apiCaixa.relatorioUrl(caixa.id), target: "_blank", rel: "noopener" }, "Abrir PDF")
        : null
    ))
  );
}

function desenharAgenda() {
  const titulo = $("#agenda-mes-titulo");
  if (titulo) titulo.textContent = `${MESES_ROTULO[agenda.mes]} de ${agenda.ano}`;

  const porDia = agendaPorDia();
  const primeiroDia = new Date(agenda.ano, agenda.mes, 1);
  const diasNoMes = new Date(agenda.ano, agenda.mes + 1, 0).getDate();
  const offset = primeiroDia.getDay();
  const hoje = chaveDia(new Date().toISOString());

  const celulas = [];
  for (let i = 0; i < offset; i++) celulas.push(el("div.agenda-dia.agenda-dia-vazio", {}));
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const chave = `${agenda.ano}-${String(agenda.mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const dados = porDia.get(chave);
    const trabalhado = Boolean(dados?.sessoes.length);
    celulas.push(el("button.agenda-dia", {
      type: "button",
      class: `${trabalhado ? "trabalhado" : ""} ${dados?.emAndamento ? "em-andamento" : ""} ${chave === hoje ? "hoje" : ""} ${chave === agenda.diaSelecionado ? "selecionado" : ""}`,
      dataset: { dia: chave }
    },
      el("span.agenda-dia-numero", {}, String(dia)),
      trabalhado ? el("span.agenda-dia-valor", {}, reais(dados.faturamento)) : null
    ));
  }

  render($("#agenda-grid"),
    ...DIAS_SEMANA.map(rotulo => el("div.agenda-dia-semana", {}, rotulo)),
    ...celulas
  );

  const alvoDetalhe = $("#agenda-dia-detalhe");
  if (alvoDetalhe) {
    if (agenda.diaSelecionado) {
      render(alvoDetalhe, detalheDia(agenda.diaSelecionado, porDia.get(agenda.diaSelecionado)));
      mostrar(alvoDetalhe, true);
    } else {
      mostrar(alvoDetalhe, false);
    }
  }
}

function ligarAgenda() {
  $("#agenda-mes-anterior")?.addEventListener("click", () => {
    agenda.mes -= 1;
    if (agenda.mes < 0) { agenda.mes = 11; agenda.ano -= 1; }
    agenda.diaSelecionado = null;
    desenharAgenda();
  });
  $("#agenda-mes-seguinte")?.addEventListener("click", () => {
    agenda.mes += 1;
    if (agenda.mes > 11) { agenda.mes = 0; agenda.ano += 1; }
    agenda.diaSelecionado = null;
    desenharAgenda();
  });
  delegar($("#agenda-grid"), "click", "[data-dia]", (_e, botao) => {
    agenda.diaSelecionado = agenda.diaSelecionado === botao.dataset.dia ? null : botao.dataset.dia;
    desenharAgenda();
  });
}

function atualizarStatusCaixa() {
  const alvo = $("#cash-status");
  const abrir = $("#open-cash");
  const fechar = $("#close-cash");
  const manual = $("#open-manual-sale");
  const aviso = $("#cash-lock-note");
  if (!alvo) return;

  const permitido = podeOperarCaixa();
  if (abrir) abrir.classList.toggle("hidden", !permitido);
  if (fechar) fechar.classList.toggle("hidden", !permitido);

  if (!estado.caixaAtual) {
    alvo.textContent = "Caixa fechado";
    alvo.classList.remove("open");
    mostrar(aviso, true);
    if (abrir) abrir.disabled = !permitido;
    if (fechar) fechar.disabled = true;
    if (manual) {
      manual.disabled = true;
      manual.title = "Abra o caixa para registrar vendas.";
    }
    return;
  }

  alvo.textContent = `Caixa aberto desde ${dataHora(estado.caixaAtual.abertoEm)}`;
  alvo.classList.add("open");
  mostrar(aviso, false);
  if (abrir) abrir.disabled = true;
  if (fechar) fechar.disabled = !permitido;
  if (manual) {
    manual.disabled = false;
    manual.title = "";
  }
}

export async function desenharCaixaStatus() {
  try {
    const carga = carregar("caixa").then(() => {
      atualizarStatusCaixa();
      return true;
    });
    const carregou = await Promise.race([
      carga,
      new Promise(resolve => setTimeout(() => resolve(false), 3500))
    ]);
    if (!carregou) estado.caixaAtual = null;
    atualizarStatusCaixa();
  } catch (erro) {
    atualizarStatusCaixa();
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
        ? el("div.closing-actions", {},
            el("a.secondary.small", { href: apiCaixa.relatorioUrl(caixa.id), target: "_blank", rel: "noopener" }, "Abrir PDF"),
            el("button.danger.small", { type: "button", dataset: { acao: "apagar-fechamento", id: caixa.id } }, "Apagar")
          )
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
    desenharAgenda();
  } catch (erro) {
    toastFalha(erro, "Fechamentos");
  }
}

async function abrirCaixa() {
  const botao = $("#open-cash");
  const senha = await pedirSenhaCaixa();
  if (senha === null) return;
  if (!senha.trim()) return toastFalha(new Error("Informe sua senha para abrir o caixa."), "Caixa");
  if (!confirm("Abrir o caixa de hoje? As vendas até o fechamento entram neste movimento.")) return;
  if (botao) botao.disabled = true;
  try {
    await apiCaixa.abrir(senha);
    toastOk("Caixa aberto.");
    await desenharCaixaStatus();
  } catch (erro) {
    toastFalha(erro, "Caixa");
  } finally {
    if (botao) botao.disabled = false;
    atualizarStatusCaixa();
  }
}

function abrirModalFecharCaixa() {
  if (!estado.caixaAtual) return toastFalha(new Error("Não há caixa aberto."), "Caixa");
  const modal = $("#close-cash-modal");
  const campo = $("#close-cash-observacao");
  if (!modal) return fecharCaixaConfirmado("");
  if (campo) campo.value = "";
  mostrar(modal, true);
  setTimeout(() => campo?.focus(), 30);
}

function fecharModalFecharCaixa() {
  mostrar($("#close-cash-modal"), false);
}

async function fecharCaixaConfirmado(observacao) {
  const botao = $("#close-cash-submit") || $("#close-cash");
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

let resolverSenhaCaixa = null;

function fecharModalSenhaCaixa(valor) {
  const modal = $("#cash-password-modal");
  const campo = $("#cash-password");
  mostrar(modal, false);
  if (campo) campo.value = "";
  resolverSenhaCaixa?.(valor);
  resolverSenhaCaixa = null;
}

/* Mesmo modal serve pra confirmar a abertura do caixa e pra qualquer outra
 * acao que exija a senha de novo (ex: apagar um fechamento) — so troca o
 * texto na hora de abrir. */
function pedirSenhaCaixa({
  titulo = "Abrir caixa",
  hint = "Digite sua senha para confirmar a abertura do movimento.",
  rotulo = "Confirmar abertura"
} = {}) {
  return new Promise(resolve => {
    const modal = $("#cash-password-modal");
    const campo = $("#cash-password");
    if (!modal || !campo) {
      resolve(prompt(hint));
      return;
    }
    const tituloEl = $("#cash-password-title");
    const hintEl = $("#cash-password-hint");
    const botaoEl = $("#cash-password-submit");
    if (tituloEl) tituloEl.textContent = titulo;
    if (hintEl) hintEl.textContent = hint;
    if (botaoEl) botaoEl.textContent = rotulo;
    resolverSenhaCaixa = resolve;
    campo.value = "";
    mostrar(modal, true);
    setTimeout(() => campo.focus(), 30);
  });
}

async function apagarFechamento(id) {
  const caixa = estado.fechamentos.find(item => item.id === id);
  if (!confirm(`Apagar o fechamento de ${caixa ? dataHora(caixa.fechadoEm) : "caixa"}? Essa ação não pode ser desfeita.`)) return;

  const senha = await pedirSenhaCaixa({
    titulo: "Apagar fechamento",
    hint: "Confirme sua senha de administrador para apagar este fechamento.",
    rotulo: "Apagar fechamento"
  });
  if (senha === null) return;
  if (!senha.trim()) return toastFalha(new Error("Informe sua senha para apagar o fechamento."), "Fechamentos");

  try {
    await apiCaixa.remover(id, senha);
    toastOk("Fechamento apagado.");
    await desenharFechamentos();
  } catch (erro) {
    toastFalha(erro, "Fechamentos");
  }
}

export function ligarFechamentos() {
  ligarAgenda();
  $("#open-cash")?.addEventListener("click", abrirCaixa);
  $("#close-cash")?.addEventListener("click", abrirModalFecharCaixa);
  $("#refresh-closings")?.addEventListener("click", desenharFechamentos);
  $("#close-cash-form")?.addEventListener("submit", evento => {
    evento.preventDefault();
    const observacao = $("#close-cash-observacao")?.value.trim() || "";
    fecharModalFecharCaixa();
    fecharCaixaConfirmado(observacao);
  });
  $("#close-cash-cancel")?.addEventListener("click", fecharModalFecharCaixa);
  ligarModal($("#close-cash-modal"), fecharModalFecharCaixa);
  delegar($("#closing-list"), "click", "[data-acao='apagar-fechamento']", (_e, botao) =>
    apagarFechamento(botao.dataset.id));
  $("#cash-password-form")?.addEventListener("submit", evento => {
    evento.preventDefault();
    fecharModalSenhaCaixa($("#cash-password")?.value || "");
  });
  $("#cash-password-cancel")?.addEventListener("click", () => fecharModalSenhaCaixa(null));
  $("#cash-password-modal")?.addEventListener("click", evento => {
    if (evento.target?.id === "cash-password-modal") fecharModalSenhaCaixa(null);
  });
}
