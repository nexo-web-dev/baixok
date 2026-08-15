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
import { combosRepo } from "../repositories/combos.repo.js";
import { combinacoesSaboresRepo } from "../repositories/combinacoes-sabores.repo.js";
import { mesasRepo } from "../repositories/mesas.repo.js";
import { caixaRepo } from "../repositories/caixa.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { cuponsService } from "./cupons.service.js";
import { entregaService } from "./entrega.service.js";
import { ErroApp, naoEncontrado, conflito } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";
import { idPedido } from "../lib/ids.js";
import { STATUS_ABERTOS } from "../config/constants.js";
import { controlaEstoqueCategoria } from "../lib/estoque.js";

/* Precifica os itens pelo cadastro, ignorando qualquer preco que tenha vindo do
 * cliente. Roda dentro da transacao.
 *
 * Tres formatos de item: produto normal, combo (`comboId`) ou pizza de 2
 * sabores (`id` + `id2`). Os dois ultimos viram UMA linha no pedido — o nome
 * composto e o preco fechado, exatamente como o cliente escolheu — mas
 * carregam `componentes` para a baixa de estoque saber o que decontar de onde
 * (o combo de produtos e a pizza continuam sem controle de estoque proprio;
 * quem controla e cada produto componente). */
async function precificar(itens) {
  const promocoes = new Map((await promocoesRepo.listar()).map(promo => [promo.productId, promo.price]));

  const precificados = [];
  for (const item of itens) {
    if (item.comboId) {
      const combo = await combosRepo.buscar(item.comboId);
      if (!combo) throw new ErroApp("Combo fora do cardápio.", 400, "combo_invalido");
      if (!combo.active) throw new ErroApp(`${combo.name} está pausado no momento.`, 409, "combo_pausado");

      const componentes = [];
      for (const compItem of combo.items) {
        const produtoComp = await produtosRepo.buscar(compItem.productId);
        if (!produtoComp) throw new ErroApp("Combo com produto fora do cardápio.", 400, "combo_invalido");
        componentes.push({
          id: produtoComp.id,
          name: produtoComp.name,
          qty: compItem.quantity * item.qty,
          stockControl: controlaEstoqueCategoria(produtoComp.category)
        });
      }

      precificados.push({
        id: null, id2: null, comboId: combo.id,
        name: combo.name, qty: item.qty, price: Number(combo.price),
        gift: false, componentes
      });
      continue;
    }

    const produto = await produtosRepo.buscar(item.id);
    if (!produto) throw new ErroApp(`Produto fora do cardápio.`, 400, "produto_invalido");
    if (!produto.active) throw new ErroApp(`${produto.name} está pausado no momento.`, 409, "produto_pausado");

    if (item.id2) {
      const produto2 = await produtosRepo.buscar(item.id2);
      if (!produto2) throw new ErroApp(`Produto fora do cardápio.`, 400, "produto_invalido");
      if (!produto2.active) throw new ErroApp(`${produto2.name} está pausado no momento.`, 409, "produto_pausado");
      if (!produto.saborPizza || !produto2.saborPizza) {
        throw new ErroApp("Esses itens não aceitam pizza de 2 sabores.", 400, "sabor_invalido");
      }

      const combinacao = await combinacoesSaboresRepo.buscar(produto.id, produto2.id);
      if (!combinacao) {
        throw new ErroApp("Essa combinação de sabores ainda não foi configurada pela loja.", 400, "combinacao_nao_configurada");
      }

      precificados.push({
        id: produto.id, id2: produto2.id, comboId: null,
        name: `Pizza 1/2 ${produto.name} + 1/2 ${produto2.name}`,
        qty: item.qty, price: Number(combinacao.preco), gift: false,
        componentes: [
          { id: produto.id, name: produto.name, qty: item.qty, stockControl: controlaEstoqueCategoria(produto.category) },
          { id: produto2.id, name: produto2.name, qty: item.qty, stockControl: controlaEstoqueCategoria(produto2.category) }
        ]
      });
      continue;
    }

    const promocional = promocoes.get(produto.id);
    const preco = promocional != null ? Number(promocional) : Number(produto.price);
    precificados.push({
      id: produto.id, id2: null, comboId: null,
      name: produto.name, qty: item.qty, price: preco, gift: false,
      componentes: [{ id: produto.id, name: produto.name, qty: item.qty, stockControl: controlaEstoqueCategoria(produto.category) }]
    });
  }

  await aplicarBrindes(precificados);
  return precificados;
}

/* "Leve e ganhe": se o pedido comprou o suficiente de um produto com regra
 * ativa, o produto de brinde entra sozinho, como linha propria a R$ 0 — o
 * cliente nao pede o brinde, o servidor concede. Roda depois de precificar
 * tudo o mais, porque precisa somar a quantidade JA comprada de cada produto
 * simples (produto com sabor ou dentro de combo nao participa da regra).
 *
 * Multiplo de buyQty multiplica o brinde: levar 4 de um "leve 2 ganhe 1" da
 * 2 brindes, nao 1. Estoque do brinde e respeitado — sem unidade sobrando,
 * a promocao nao derruba o pedido, so concede o que da pra entregar. */
async function aplicarBrindes(precificados) {
  const brindes = await promocoesRepo.listarBrindesPublico();
  if (!brindes.length) return;

  const qtyPorProduto = new Map();
  for (const item of precificados) {
    if (item.comboId || item.id2 || !item.id) continue;
    qtyPorProduto.set(item.id, (qtyPorProduto.get(item.id) || 0) + item.qty);
  }
  if (!qtyPorProduto.size) return;

  for (const brinde of brindes) {
    const qtyComprada = qtyPorProduto.get(brinde.buyProductId);
    if (!qtyComprada) continue;

    const vezes = Math.floor(qtyComprada / brinde.buyQty);
    if (vezes < 1) continue;

    const produtoBrinde = await produtosRepo.buscar(brinde.giftProductId);
    if (!produtoBrinde || !produtoBrinde.active) continue;

    const controlaEstoque = controlaEstoqueCategoria(produtoBrinde.category);
    let qtyBrinde = vezes * brinde.giftQty;
    if (controlaEstoque) qtyBrinde = Math.min(qtyBrinde, produtoBrinde.stock);
    if (qtyBrinde < 1) continue;

    precificados.push({
      id: produtoBrinde.id, id2: null, comboId: null,
      name: produtoBrinde.name, qty: qtyBrinde, price: 0, gift: true,
      componentes: [{ id: produtoBrinde.id, name: produtoBrinde.name, qty: qtyBrinde, stockControl: controlaEstoque }]
    });
  }
}

/* Cotacao de entrega, compartilhada entre o pedido do cardapio e o lancamento
 * manual: mesma regra para os dois, sempre recalculada pelo servidor a partir
 * do endereco em texto — nunca aceita taxa vinda do navegador. */
async function cotarEntregaSeNecessario(dados) {
  if (dados.fulfillment !== "entrega") return { taxa: 0, km: null, zona: null, minimo: 0 };
  if (!dados.phone) throw new ErroApp("Informe o telefone do cliente para entrega.", 400, "telefone_ausente");
  if (!dados.place) throw new ErroApp("Informe o endereço de entrega.", 400, "endereco_ausente");

  const config = await entregaService.config();
  if (!config.zones.length) return { taxa: 0, km: null, zona: null, minimo: 0 };

  const cotacao = await entregaService.cotarPorEndereco(dados.place);
  if (!cotacao.dentro) {
    throw new ErroApp(`Endereço fora da área de entrega (${cotacao.km} km da loja).`, 400, "fora_da_area");
  }
  return { taxa: cotacao.taxa, km: cotacao.km, zona: cotacao.zona, minimo: cotacao.minimo };
}

/* Baixa o estoque componente a componente. O UPDATE traz `WHERE estoque >= ?`
 * embutido: se outro pedido levou a ultima unidade um instante antes, o
 * rowCount volta 0, lancamos, e a transacao inteira e desfeita — inclusive as
 * baixas anteriores (as do proprio item e as de itens anteriores do pedido). */
async function baixarEstoque(itens) {
  for (const item of itens) {
    for (const componente of item.componentes) {
      if (!componente.stockControl) continue;
      if (!(await produtosRepo.baixarEstoque(componente.id, componente.qty))) {
        const atual = await produtosRepo.buscar(componente.id);
        throw new ErroApp(
          `${componente.name}: restam ${atual?.stock ?? 0} unidades.`,
          409,
          "estoque_insuficiente"
        );
      }
    }
  }
}

async function exigirCaixaAberto() {
  const caixa = await caixaRepo.atual();
  if (!caixa) throw conflito("Abra o caixa antes de registrar vendas.");
  return caixa;
}

export const pedidosService = {
  listar: filtros => pedidosRepo.listar(filtros),
  listarAbertos: () => pedidosRepo.listarAbertos(),
  listarParaTelao: () => pedidosRepo.listarParaTelao(),

  async historicoPublico({ phone, limite = 5 }) {
    const pedidos = await pedidosRepo.listarPorTelefone(phone, limite);
    return pedidos.map(pedido => ({
      id: pedido.id,
      createdAt: pedido.createdAt,
      status: pedido.status,
      fulfillment: pedido.fulfillment,
      customer: pedido.customer,
      payment: pedido.payment,
      total: pedido.total,
      items: pedido.items.map(item => ({
        name: item.name,
        qty: item.qty,
        price: item.price,
        gift: Boolean(item.gift)
      }))
    }));
  },

  async buscar(id) {
    const pedido = await pedidosRepo.buscar(id);
    if (!pedido) throw naoEncontrado("Pedido não encontrado.");
    return pedido;
  },

  /* Pedido vindo do cardapio do cliente (rota publica). */
  async criarPublico(dados, { ip }) {
    await exigirCaixaAberto();
    let mesaAbertaAutomaticamente = false;

    /* Passo 1 — rede fora da transacao.
     * A cotacao de entrega precisa da Mapbox; deixa-la aqui e o que mantem o
     * passo 2 falando so com o banco. */
    const entrega = await cotarEntregaSeNecessario(dados);

    /* Passo 2 — tudo o mais numa transacao, sem nenhuma chamada externa. */
    const pedido = await emTransacao(async () => {
      if (dados.tableNumber != null) {
        const mesa = await mesasRepo.buscar(dados.tableNumber);
        if (!mesa) throw naoEncontrado("Mesa nao encontrada.");
        if (mesa.status === "fechando") {
          throw new ErroApp("A conta desta mesa ja foi fechada. Chame o garcom para pedir de novo.", 409, "mesa_fechando");
        }
        if (mesa.status === "livre") {
          await mesasRepo.abrir(dados.tableNumber);
          mesaAbertaAutomaticamente = true;
        } else if (mesa.status !== "aberta") {
          throw new ErroApp("A comanda desta mesa não está aberta.", 409, "mesa_fechada");
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
          `Pedido mínimo de R$ ${entrega.minimo.toFixed(2)} para entrega nessa faixa.`,
          400,
          "abaixo_do_minimo"
        );
      }

      await baixarEstoque(itens);
      const estoqueBaixado = itens.some(item => item.componentes.some(componente => componente.stockControl));

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
        stockDeducted: estoqueBaixado,
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

    if (mesaAbertaAutomaticamente) {
      await auditoriaRepo.registrar({
        acao: "mesa_aberta_auto", entidade: "mesa", entidadeId: dados.tableNumber,
        detalhes: { pedido: pedido.id }, ip
      });
    }

    await auditoriaRepo.registrar({
      acao: "pedido_criado", entidade: "pedido", entidadeId: pedido.id,
      detalhes: { canal: "cardapio", total: pedido.total, itens: pedido.items.length }, ip
    });
    publicar("pedidos", [CANAL.OPERACAO, CANAL.TELAO, CANAL.PUBLICO]);
    if (pedido.tableNumber != null) publicar("mesas", [CANAL.OPERACAO, CANAL.PUBLICO]);
    return pedido;
  },

  /* Lancamento manual pelo balcao: iFood, WhatsApp, venda de salao. */
  async criarManual(dados, { usuario, ip }) {
    await exigirCaixaAberto();

    /* Mesma regra do pedido publico, fora da transacao pelo mesmo motivo:
     * a cotacao faz I/O de rede (Mapbox). */
    const entrega = await cotarEntregaSeNecessario(dados);

    const pedido = await emTransacao(async () => {
      if (dados.tableNumber != null) {
        const mesa = await mesasRepo.buscar(dados.tableNumber);
        if (!mesa) throw naoEncontrado("Mesa não encontrada.");
        if (mesa.status !== "aberta") throw conflito("Abra a comanda da mesa antes de lançar o pedido.");
      }

      const itens = await precificar(dados.items);
      const subtotal = itens.reduce((soma, item) => soma + item.price * item.qty, 0);

      if (entrega.minimo && subtotal < entrega.minimo) {
        throw new ErroApp(
          `Pedido mínimo de R$ ${entrega.minimo.toFixed(2)} para entrega nessa faixa.`,
          400,
          "abaixo_do_minimo"
        );
      }

      await baixarEstoque(itens);
      const estoqueBaixado = itens.some(item => item.componentes.some(componente => componente.stockControl));

      const novo = await pedidosRepo.inserir({
        id: idPedido(),
        createdAt: new Date().toISOString(),
        status: "novo",
        channel: dados.channel,
        fulfillment: dados.fulfillment,
        customer: dados.customer || (dados.tableNumber ? `Mesa ${dados.tableNumber}` : "Balcão"),
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
        stockDeducted: estoqueBaixado,
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

  async mudarStatus(id, dados, { usuario, ip }) {
    const status = typeof dados === "string" ? dados : dados.status;
    let atual = await this.buscar(id);

    /* Cancelar tem regra propria (devolve estoque), entao nao entra por aqui. */
    if (status === "cancelado") {
      throw new ErroApp("Informe o motivo do cancelamento.", 400, "motivo_obrigatorio");
    }

    if (status === "entregue" && atual.fulfillment === "entrega") {
      const nomeMotoboy = String(
        typeof dados === "string" ? atual.motoboy || "" : dados.motoboy || atual.motoboy || ""
      ).trim();

      if (!nomeMotoboy) {
        throw new ErroApp("Informe o motoboy antes de marcar a entrega como entregue.", 400, "motoboy_obrigatorio");
      }

      if (atual.motoboy && nomeMotoboy !== atual.motoboy && usuario?.papel !== "admin") {
        throw conflito("Motoboy ja foi salvo neste pedido. Apenas administrador pode alterar.");
      }

      if (nomeMotoboy !== atual.motoboy) {
        atual = await pedidosRepo.definirMotoboy(id, nomeMotoboy);
      }
    }

    if (atual.status === status) return atual;

    const pedido = await pedidosRepo.atualizarStatus(id, status);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "pedido_status",
      entidade: "pedido", entidadeId: id,
      detalhes: {
        de: atual.status,
        para: status,
        motoboy: pedido.motoboy || atual.motoboy || ""
      },
      ip
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
      if (!atual) throw naoEncontrado("Pedido não encontrado.");
      if (atual.status === "cancelado") throw conflito("Este pedido já está cancelado.");

      if (atual.stockDeducted) {
        for (const item of atual.items) {
          if (item.comboId) {
            const combo = await combosRepo.buscar(item.comboId);
            for (const compItem of (combo?.items || [])) {
              const produtoComp = await produtosRepo.buscar(compItem.productId);
              if (controlaEstoqueCategoria(produtoComp?.category)) {
                await produtosRepo.devolverEstoque(compItem.productId, compItem.quantity * item.qty);
              }
            }
            continue;
          }
          if (item.id) {
            const produto = await produtosRepo.buscar(item.id);
            if (controlaEstoqueCategoria(produto?.category)) await produtosRepo.devolverEstoque(item.id, item.qty);
          }
          if (item.id2) {
            const produto2 = await produtosRepo.buscar(item.id2);
            if (controlaEstoqueCategoria(produto2?.category)) await produtosRepo.devolverEstoque(item.id2, item.qty);
          }
        }
        await pedidosRepo.marcarEstoqueDevolvido(id);
      }
      return pedidosRepo.cancelar(id, motivoLimpo);
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
    if (atual.motoboy && atual.motoboy !== nome && usuario?.papel !== "admin") {
      throw conflito("Motoboy ja foi salvo neste pedido. Apenas administrador pode alterar.");
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
