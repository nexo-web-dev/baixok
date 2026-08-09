/* Regras de pedido. E o ponto mais sensivel do sistema.
 *
 * Principio herdado do server.js original e mantido: o navegador do cliente e
 * tratado como nao confiavel. O que chega dele diz apenas O QUE foi pedido —
 * produto e quantidade. Preco, promocao, desconto de cupom, taxa de entrega e
 * total sao refeitos aqui pelo cadastro da casa.
 *
 * Duas correcoes sobre o comportamento antigo:
 *
 * 1. CORRIDA DE ESTOQUE. Havia um `await geocodificar()` entre conferir o
 *    estoque e baixa-lo. Dois pedidos simultaneos passavam pela mesma
 *    verificacao e a casa vendia o que nao tinha. Agora toda chamada de rede
 *    acontece ANTES, e a conferencia + baixa ficam numa transacao onde o
 *    proprio UPDATE recusa quando o saldo nao cobre.
 *
 * 2. CUPOM CONTAVA USO SEM SER USADO. `cupom.uses += 1` rodava assim que o
 *    cupom era encontrado, mesmo que o pedido fosse recusado logo depois por
 *    endereco fora da area. Agora o uso e registrado no fim, junto do pedido.
 *
 * Sobre o `await` dentro de emTransacao: com o Postgres toda consulta e
 * assincrona, entao a regra de "nada de rede no meio da transacao" deixou de
 * ser imposta pela linguagem e passou a valer por disciplina. Nenhuma chamada a
 * Mapbox ou a qualquer API externa pode entrar nos blocos abaixo. */
import { emTransacao } from "../db/postgres.js";
import { pedidosRepo } from "../repositories/pedidos.repo.js";
import { produtosRepo } from "../repositories/produtos.repo.js";
import { promocoesRepo } from "../repositories/promocoes.repo.js";
import { mesasRepo } from "../repositories/mesas.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { cuponsService } from "./cupons.service.js";
import { entregaService } from "./entrega.service.js";
import { ErroApp, naoEncontrado, conflito } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";
import { idPedido } from "../lib/ids.js";
import { STATUS_ABERTOS } from "../config/constants.js";

/* Precifica os itens pelo cadastro, ignorando qualquer preco que tenha vindo do
 * cliente. Roda dentro da transacao. */
async function precificar(itens) {
  const promocoes = new Map((await promocoesRepo.listar()).map(promo => [promo.productId, promo.price]));

  const precificados = [];
  for (const item of itens) {
    const produto = await produtosRepo.buscar(item.id);
    if (!produto) throw new ErroApp(`Produto fora do cardapio.`, 400, "produto_invalido");
    if (!produto.active) throw new ErroApp(`${produto.name} esta pausado no momento.`, 409, "produto_pausado");

    const promocional = promocoes.get(produto.id);
    precificados.push({
      id: produto.id,
      name: produto.name,
      qty: item.qty,
      price: promocional != null ? Number(promocional) : Number(produto.price)
    });
  }
  return precificados;
}

/* Cotacao de entrega, compartilhada entre o pedido do cardapio e o lancamento
 * manual: mesma regra para os dois, sempre recalculada pelo servidor a partir
 * do endereco em texto — nunca aceita taxa vinda do navegador. */
async function cotarEntregaSeNecessario(dados) {
  if (dados.fulfillment !== "entrega") return { taxa: 0, km: null, zona: null, minimo: 0 };
  if (!dados.phone) throw new ErroApp("Informe o telefone do cliente para entrega.", 400, "telefone_ausente");
  if (!dados.place) throw new ErroApp("Informe o endereco de entrega.", 400, "endereco_ausente");

  const config = await entregaService.config();
  if (!config.zones.length) return { taxa: 0, km: null, zona: null, minimo: 0 };

  const cotacao = await entregaService.cotarPorEndereco(dados.place);
  if (!cotacao.dentro) {
    throw new ErroApp(`Endereco fora da area de entrega (${cotacao.km} km da loja).`, 400, "fora_da_area");
  }
  return { taxa: cotacao.taxa, km: cotacao.km, zona: cotacao.zona, minimo: cotacao.minimo };
}

/* Baixa o estoque item a item. O UPDATE traz `WHERE estoque >= ?` embutido:
 * se outro pedido levou a ultima unidade um instante antes, o rowCount volta 0,
 * lancamos, e a transacao inteira e desfeita — inclusive as baixas anteriores. */
async function baixarEstoque(itens) {
  for (const item of itens) {
    if (!(await produtosRepo.baixarEstoque(item.id, item.qty))) {
      const atual = await produtosRepo.buscar(item.id);
      throw new ErroApp(
        `${item.name}: restam ${atual?.stock ?? 0} unidades.`,
        409,
        "estoque_insuficiente"
      );
    }
  }
}

export const pedidosService = {
  listar: filtros => pedidosRepo.listar(filtros),
  listarAbertos: () => pedidosRepo.listarAbertos(),
  listarParaTelao: () => pedidosRepo.listarParaTelao(),

  async buscar(id) {
    const pedido = await pedidosRepo.buscar(id);
    if (!pedido) throw naoEncontrado("Pedido nao encontrado.");
    return pedido;
  },

  /* Pedido vindo do cardapio do cliente (rota publica). */
  async criarPublico(dados, { ip }) {
    /* Passo 1 — rede fora da transacao.
     * A cotacao de entrega precisa da Mapbox; deixa-la aqui e o que mantem o
     * passo 2 falando so com o banco. */
    const entrega = await cotarEntregaSeNecessario(dados);

    /* Passo 2 — tudo o mais numa transacao, sem nenhuma chamada externa. */
    const pedido = await emTransacao(async () => {
      if (dados.tableNumber != null) {
        const mesa = await mesasRepo.buscar(dados.tableNumber);
        if (!mesa || mesa.status !== "aberta") {
          throw new ErroApp("A comanda desta mesa nao esta aberta.", 409, "mesa_fechada");
        }
      }

      const itens = await precificar(dados.items);
      const subtotal = itens.reduce((soma, item) => soma + item.price * item.qty, 0);

      const cupom = dados.coupon
        ? await cuponsService.avaliar({ code: dados.coupon, subtotal, telefone: dados.phone })
        : { valido: false, desconto: 0 };

      /* Cupom invalido nao derruba o pedido: entra sem desconto, como o sistema
       * antigo fazia. Recusar o pedido inteiro por um codigo digitado errado
       * seria pior para a casa do que vender sem o desconto. */
      const desconto = cupom.valido ? cupom.desconto : 0;

      if (entrega.minimo && subtotal - desconto < entrega.minimo) {
        throw new ErroApp(
          `Pedido minimo de R$ ${entrega.minimo.toFixed(2)} para entrega nessa faixa.`,
          400,
          "abaixo_do_minimo"
        );
      }

      await baixarEstoque(itens);

      const novo = await pedidosRepo.inserir({
        id: idPedido(),
        createdAt: new Date().toISOString(),
        status: "novo",
        channel: "cardapio",
        fulfillment: dados.fulfillment,
        customer: dados.customer || "Cliente",
        phone: dados.phone,
        place: dados.place,
        note: dados.note,
        payment: dados.payment,
        trocoPara: dados.trocoPara ?? null,
        tableNumber: dados.tableNumber,
        items: itens,
        subtotal,
        discount: desconto,
        coupon: cupom.valido ? cupom.code : "",
        deliveryFee: entrega.taxa,
        deliveryKm: entrega.km,
        deliveryZone: entrega.zona,
        total: Math.round((subtotal - desconto + entrega.taxa) * 100) / 100,
        printed: false,
        stockDeducted: true,
        createdBy: null
      });

      if (cupom.valido) {
        await cuponsService.registrarUso({ code: cupom.code, pedidoId: novo.id, telefone: dados.phone });
      }
      if (dados.tableNumber != null) {
        await mesasRepo.adicionarItens(dados.tableNumber, novo.id, itens);
      }
      return novo;
    });

    await auditoriaRepo.registrar({
      acao: "pedido_criado", entidade: "pedido", entidadeId: pedido.id,
      detalhes: { canal: "cardapio", total: pedido.total, itens: pedido.items.length }, ip
    });
    publicar("pedidos", [CANAL.OPERACAO, CANAL.TELAO, CANAL.PUBLICO]);
    return pedido;
  },

  /* Lancamento manual pelo balcao: iFood, WhatsApp, venda de salao. */
  async criarManual(dados, { usuario, ip }) {
    /* Mesma regra do pedido publico, fora da transacao pelo mesmo motivo:
     * a cotacao faz I/O de rede (Mapbox). */
    const entrega = await cotarEntregaSeNecessario(dados);

    const pedido = await emTransacao(async () => {
      if (dados.tableNumber != null) {
        const mesa = await mesasRepo.buscar(dados.tableNumber);
        if (!mesa) throw naoEncontrado("Mesa nao encontrada.");
        if (mesa.status !== "aberta") throw conflito("Abra a comanda da mesa antes de lancar o pedido.");
      }

      const itens = await precificar(dados.items);
      const subtotal = itens.reduce((soma, item) => soma + item.price * item.qty, 0);

      if (entrega.minimo && subtotal < entrega.minimo) {
        throw new ErroApp(
          `Pedido minimo de R$ ${entrega.minimo.toFixed(2)} para entrega nessa faixa.`,
          400,
          "abaixo_do_minimo"
        );
      }

      await baixarEstoque(itens);

      const novo = await pedidosRepo.inserir({
        id: idPedido(),
        createdAt: new Date().toISOString(),
        status: "novo",
        channel: dados.channel,
        fulfillment: dados.fulfillment,
        customer: dados.customer || (dados.tableNumber ? `Mesa ${dados.tableNumber}` : "Balcao"),
        phone: dados.phone,
        place: dados.place,
        note: dados.note,
        payment: dados.payment,
        trocoPara: dados.trocoPara ?? null,
        tableNumber: dados.tableNumber,
        items: itens,
        subtotal,
        discount: 0,
        coupon: "",
        deliveryFee: entrega.taxa,
        deliveryKm: entrega.km,
        deliveryZone: entrega.zona,
        total: subtotal + entrega.taxa,
        printed: false,
        stockDeducted: true,
        createdBy: usuario.id
      });

      if (dados.tableNumber != null) await mesasRepo.adicionarItens(dados.tableNumber, novo.id, itens);
      return novo;
    });

    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "pedido_lancado",
      entidade: "pedido", entidadeId: pedido.id,
      detalhes: { canal: dados.channel, total: pedido.total, mesa: dados.tableNumber }, ip
    });
    publicar("pedidos", [CANAL.OPERACAO, CANAL.TELAO]);
    return pedido;
  },

  async mudarStatus(id, status, { usuario, ip }) {
    const atual = await this.buscar(id);
    if (atual.status === status) return atual;

    /* Cancelar tem regra propria (devolve estoque), entao nao entra por aqui. */
    if (status === "cancelado") {
      throw new ErroApp("Informe o motivo do cancelamento.", 400, "motivo_obrigatorio");
    }

    const pedido = await pedidosRepo.atualizarStatus(id, status);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "pedido_status",
      entidade: "pedido", entidadeId: id, detalhes: { de: atual.status, para: status }, ip
    });
    publicar("pedidos", [CANAL.OPERACAO, CANAL.TELAO]);
    return pedido;
  },

  /* Cancelar devolve o estoque, uma vez so.
   * `estoque_baixado` e o que impede o clique repetido de devolver duas vezes e
   * inflar o estoque — no sistema antigo essa marca existia mas nao era checada
   * de forma atomica. */
  async cancelar(id, motivo, { usuario, ip }) {
    const motivoLimpo = String(motivo || "").trim();
    if (!motivoLimpo) {
      throw new ErroApp("Informe o motivo do cancelamento.", 400, "motivo_obrigatorio");
    }

    const pedido = await emTransacao(async () => {
      const atual = await pedidosRepo.buscar(id);
      if (!atual) throw naoEncontrado("Pedido nao encontrado.");
      if (atual.status === "cancelado") throw conflito("Este pedido ja esta cancelado.");

      if (atual.stockDeducted) {
        for (const item of atual.items) {
          if (item.id) await produtosRepo.devolverEstoque(item.id, item.qty);
        }
        await pedidosRepo.marcarEstoqueDevolvido(id);
      }
      return pedidosRepo.cancelar(id, textoMotivo);
    });

    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "pedido_cancelado",
      entidade: "pedido", entidadeId: id,
      detalhes: {
        motivo: motivoLimpo,
        cliente: pedido.customer,
        total: pedido.total,
        itens: pedido.items.map(item => `${item.qty}x ${item.name}`)
      },
      ip
    });
    publicar("pedidos", [CANAL.OPERACAO, CANAL.TELAO, CANAL.PUBLICO]);
    return pedido;
  },

  async definirMotoboy(id, motoboy, { usuario, ip }) {
    const nome = String(motoboy || "").trim();
    if (!nome) throw new ErroApp("Informe o nome do motoboy.", 400, "motoboy_obrigatorio");

    const atual = await this.buscar(id);
    if (atual.fulfillment !== "entrega") throw conflito("Motoboy so pode ser informado em pedido de entrega.");
    if (!["pronto", "entregue"].includes(atual.status)) {
      throw conflito("Informe o motoboy quando a entrega estiver pronta ou entregue.");
    }

    const pedido = await pedidosRepo.definirMotoboy(id, nome);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "pedido_motoboy",
      entidade: "pedido", entidadeId: id, detalhes: { motoboy: nome, cliente: pedido.customer }, ip
    });
    publicar("pedidos", [CANAL.OPERACAO]);
    return pedido;
  },

  async marcarImpresso(id) {
    await pedidosRepo.marcarImpresso(id);
  },

  /* Metricas da barra do topo do painel. */
  async resumoDoDia() {
    const abertos = await pedidosRepo.listarAbertos();
    return {
      abertos: abertos.length,
      porStatus: Object.fromEntries(
        STATUS_ABERTOS.map(status => [status, abertos.filter(pedido => pedido.status === status).length])
      )
    };
  }
};
