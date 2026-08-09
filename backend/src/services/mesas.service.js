/* Regras do salao: abertura, comanda e fechamento de conta.
 *
 * A taxa de servico de 10% era a constante SERVICE_FEE dentro do app.js — logo,
 * editavel por qualquer cliente no devtools antes de a conta ser montada. Agora
 * vem dos ajustes da casa e o total e fechado aqui. */
import { emTransacao } from "../db/postgres.js";
import { mesasRepo } from "../repositories/mesas.repo.js";
import { pedidosRepo } from "../repositories/pedidos.repo.js";
import { ajustesRepo } from "../repositories/ajustes.repo.js";
import { caixaRepo } from "../repositories/caixa.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { naoEncontrado, conflito } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";

/* Recebe o percentual pronto em vez de busca-lo.
 *
 * Com o SQLite a leitura do ajuste era de graca; no Postgres cada uma e uma ida
 * a rede, e `listar()` chamaria uma por mesa. Quem chama le o ajuste uma vez e
 * repassa. */
function montarConta(mesa, percentual) {
  const subtotal = mesa.items.reduce((soma, item) => soma + item.price * item.qty, 0);
  const servico = Math.round(subtotal * percentual * 100) / 100;
  return {
    subtotal,
    percentualServico: percentual,
    servico,
    total: Math.round((subtotal + servico) * 100) / 100
  };
}

const taxaServico = () => ajustesRepo.lerNumero("taxa_servico_mesa");

async function exigirCaixaAberto() {
  const caixa = await caixaRepo.atual();
  if (!caixa) throw conflito("Abra o caixa antes de abrir mesa ou registrar vendas.");
  return caixa;
}

export const mesasService = {
  async listar() {
    const [mesas, percentual] = await Promise.all([mesasRepo.listar(), taxaServico()]);
    return mesas.map(mesa => ({ ...mesa, conta: montarConta(mesa, percentual) }));
  },

  listarPublico: () => mesasRepo.listarPublico(),

  async buscar(n) {
    const [mesa, percentual] = await Promise.all([mesasRepo.buscar(n), taxaServico()]);
    if (!mesa) throw naoEncontrado("Mesa não encontrada.");
    return { ...mesa, conta: montarConta(mesa, percentual) };
  },

  /* Comanda que o cliente ve depois de ler o QR code.
   * So itens e valores da propria mesa: nada de telefone, nome de outro cliente
   * ou qualquer coisa das demais mesas. */
  async comandaPublica(n) {
    const [mesa, percentual] = await Promise.all([mesasRepo.buscar(n), taxaServico()]);
    if (!mesa) throw naoEncontrado("Mesa não encontrada.");
    return {
      n: mesa.n,
      status: mesa.status,
      aberta: mesa.status === "aberta",
      items: mesa.items.map(item => ({ name: item.name, qty: item.qty, price: item.price })),
      conta: montarConta(mesa, percentual)
    };
  },

  async adicionar({ usuario, ip }) {
    const n = await mesasRepo.proximoNumero();
    const mesa = await mesasRepo.criar(n);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "mesa_criada",
      entidade: "mesa", entidadeId: n, ip
    });
    publicar("mesas", [CANAL.OPERACAO, CANAL.PUBLICO]);
    return mesa;
  },

  async remover(n, { usuario, ip }) {
    const mesa = await this.buscar(n);
    if (mesa.status !== "livre") throw conflito("Feche a comanda antes de remover a mesa.");
    await mesasRepo.remover(n);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "mesa_removida",
      entidade: "mesa", entidadeId: n, ip
    });
    publicar("mesas", [CANAL.OPERACAO, CANAL.PUBLICO]);
  },

  /* Abrir a mesa e o que libera o QR code a aceitar pedido. */
  async abrir(n, { usuario, ip }) {
    await exigirCaixaAberto();

    const mesa = await this.buscar(n);
    if (mesa.status === "aberta") return mesa;
    const aberta = await mesasRepo.abrir(n);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "mesa_aberta",
      entidade: "mesa", entidadeId: n, ip
    });
    publicar("mesas", [CANAL.OPERACAO, CANAL.PUBLICO]);
    return { ...aberta, conta: montarConta(aberta, await taxaServico()) };
  },

  /* Fechar a conta trava o QR e devolve o extrato para impressao. O pagamento
   * acontece no balcao; liberar a mesa e um segundo passo, deliberadamente. */
  async fecharConta(n, { usuario, ip }) {
    const mesa = await this.buscar(n);
    if (mesa.status === "livre") throw conflito("Esta mesa não tem comanda aberta.");

    await mesasRepo.marcarFechando(n);
    const conta = mesa.conta;
    const pedidos = await pedidosRepo.listarDaMesa(n);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "mesa_conta_fechada",
      entidade: "mesa", entidadeId: n, detalhes: conta, ip
    });
    publicar("mesas", [CANAL.OPERACAO, CANAL.PUBLICO]);

    return {
      mesa: n,
      abertaEm: mesa.openedAt,
      items: mesa.items,
      pedidos: pedidos.map(pedido => pedido.id),
      ...conta
    };
  },

  /* Libera a mesa para o proximo cliente e zera a comanda. Os itens continuam
   * nos pedidos, que sao o registro contabil. */
  async liberar(n, { usuario, ip }) {
    const mesa = await this.buscar(n);
    const liberada = await emTransacao(() => mesasRepo.liberar(n));
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "mesa_liberada",
      entidade: "mesa", entidadeId: n, detalhes: { itensNaComanda: mesa.items.length }, ip
    });
    publicar("mesas", [CANAL.OPERACAO, CANAL.PUBLICO]);
    return liberada;
  }
};
