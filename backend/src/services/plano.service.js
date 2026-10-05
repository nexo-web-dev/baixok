/* Status do plano do sistema (mensalidade + saldo do desenvolvimento).
 *
 * Todo calculo de data e de dias fica aqui, no servidor, em cima do dia de
 * Brasilia — o front so mostra o que vier daqui. Os limites de quando cada
 * aviso aparece no login tambem moram aqui pelo mesmo motivo. */
import { planoRepo } from "../repositories/plano.repo.js";

const DIAS_ANTES_ALERTA_MENSALIDADE = 3;
const DIAS_ANTES_ALERTA_PROJETO = 3;
const DIA_VENCIMENTO_MENSALIDADE = 15;
const DIA_MS = 24 * 60 * 60 * 1000;

const hojeBrasilia = (agora = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
}).format(agora);

const emMs = iso => {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia);
};

const diferencaDias = (de, ate) => Math.round((emMs(ate) - emMs(de)) / DIA_MS);

function diaDoMesSeguinte(isoBase, dia) {
  const [ano, mes] = isoBase.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, dia)).toISOString().slice(0, 10);
}

function situacao(dataAlvo, hoje) {
  const diff = diferencaDias(hoje, dataAlvo);
  return diff < 0 ? { atrasado: true, dias: Math.abs(diff) } : { atrasado: false, dias: diff };
}

export const planoService = {
  async status(agora = new Date()) {
    const plano = await planoRepo.ler();
    if (!plano) return null;

    const hoje = hojeBrasilia(agora);

    const vencimentoMensalidade = diaDoMesSeguinte(plano.mensalidade_paga_ate, DIA_VENCIMENTO_MENSALIDADE);
    const mensalidade = { valor: Number(plano.valor_mensalidade), vencimento: vencimentoMensalidade, ...situacao(vencimentoMensalidade, hoje) };
    mensalidade.alertaLogin = mensalidade.atrasado || mensalidade.dias <= DIAS_ANTES_ALERTA_MENSALIDADE;

    const total = Number(plano.valor_projeto_total);
    const pago = Number(plano.valor_projeto_pago);
    const restante = Math.max(0, total - pago);
    const prazo = situacao(plano.prazo_final_projeto, hoje);
    const original = situacao(plano.vencimento_projeto, hoje);
    const projeto = {
      valorTotal: total,
      pago,
      restante,
      quitado: restante <= 0,
      vencimentoOriginal: plano.vencimento_projeto,
      vencidoOriginal: original.atrasado,
      diasDesdeVencimentoOriginal: original.atrasado ? original.dias : 0,
      prazoFinal: plano.prazo_final_projeto,
      atrasadoPrazo: prazo.atrasado,
      diasPrazo: prazo.dias
    };
    projeto.alertaLogin = restante > 0 && (prazo.atrasado || prazo.dias <= DIAS_ANTES_ALERTA_PROJETO);

    return { mensalidade, projeto };
  }
};
