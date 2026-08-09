/* Rotas abertas: o cardapio do cliente e a comanda de mesa por QR code.
 *
 * Este arquivo e a fronteira de exposicao do sistema. Tudo que sai daqui e
 * visivel para qualquer pessoa na internet, entao cada resposta devolve o
 * minimo. E o oposto do /api/state antigo, que mandava o banco quase inteiro —
 * cupons, faixas de entrega com taxa, estoque e itens de todas as mesas — para
 * quem simplesmente abrisse o cardapio. */
import { produtosService } from "../services/produtos.service.js";
import { mesasService } from "../services/mesas.service.js";
import { pedidosService } from "../services/pedidos.service.js";
import { cuponsService } from "../services/cupons.service.js";
import { entregaService } from "../services/entrega.service.js";
import { ajustesRepo } from "../repositories/ajustes.repo.js";
import { caixaRepo } from "../repositories/caixa.repo.js";
import { tokenPublico, temToken } from "../lib/mapbox.js";
import { ipDe } from "./contexto.js";

const CACHE_CARDAPIO_MS = 1200;
let cacheCardapio = { ate: 0, payload: null };
let cardapioEmVoo = null;

async function montarPayloadCardapio() {
  const [ajustes, produtos, entrega, caixa] = await Promise.all([
    ajustesRepo.todos(),
    produtosService.cardapioPublico(),
    entregaService.configPublica(),
    caixaRepo.atual()
  ]);
  return {
    produtos,
    entrega,
    loja: {
      nome: ajustes.nome_loja,
      endereco: ajustes.endereco_loja,
      whatsapp: ajustes.whatsapp_entrega,
      caixaAberto: Boolean(caixa)
    }
  };
}

export const publicoController = {
  /* Tudo que o cardapio precisa para desenhar, numa chamada.
   *
   * E a rota mais chamada do sistema — todo cliente que abre o cardapio passa
   * por aqui. As tres consultas nao dependem uma da outra, entao vao juntas: em
   * fila seriam tres idas ao Postgres antes do primeiro byte. */
  async cardapio(_req, res) {
    const agora = Date.now();
    if (cacheCardapio.payload && cacheCardapio.ate > agora) {
      return res.set("Cache-Control", "no-store").json(cacheCardapio.payload);
    }

    cardapioEmVoo ??= montarPayloadCardapio()
      .then(payload => {
        cacheCardapio = { ate: Date.now() + CACHE_CARDAPIO_MS, payload };
        return payload;
      })
      .finally(() => { cardapioEmVoo = null; });

    const payload = await cardapioEmVoo;
    res.set("Cache-Control", "no-store").json(payload);
  },

  async imagemProduto(req, res) {
    const imagem = await produtosService.imagemPublica(req.validado.params.id);
    if (!imagem) return res.status(404).end();
    res
      .set("Content-Type", imagem.contentType)
      .set("Cache-Control", "public, max-age=604800, immutable")
      .send(imagem.buffer);
  },

  /* Situacao da mesa: so o suficiente para o QR saber se pode aceitar pedido. */
  async statusMesa(req, res) {
    const comanda = await mesasService.comandaPublica(req.validado.params.n);
    res.json(comanda);
  },

  async criarPedido(req, res) {
    const pedido = await pedidosService.criarPublico(req.validado.body, { ip: ipDe(req) });

    /* Devolve so o comprovante do proprio pedido. O sistema antigo respondia
     * com o estado inteiro depois de gravar. */
    res.status(201).json({
      pedido: {
        id: pedido.id,
        createdAt: pedido.createdAt,
        status: pedido.status,
        customer: pedido.customer,
        items: pedido.items,
        subtotal: pedido.subtotal,
        discount: pedido.discount,
        deliveryFee: pedido.deliveryFee,
        trocoPara: pedido.trocoPara,
        total: pedido.total
      }
    });
  },

  async historicoPedidos(req, res) {
    res.json({ pedidos: await pedidosService.historicoPublico(req.validado.query) });
  },

  /* Valida o cupom que o cliente digitou.
   *
   * Devolve so o efeito no carrinho dele. Nao existe rota publica que liste
   * cupons: o cliente precisa saber o codigo de antemao. O subtotal enviado
   * serve so para a previa — no fechamento o servidor recalcula tudo. */
  async validarCupom(req, res) {
    const { code, subtotal, phone } = req.validado.body;
    const resultado = await cuponsService.avaliar({ code, subtotal, telefone: phone });
    res.json({
      valido: resultado.valido,
      desconto: resultado.desconto,
      descricao: resultado.descricao || "",
      motivo: resultado.motivo || ""
    });
  },

  async cotarEntrega(req, res) {
    const { q, lng, lat } = req.validado.query;
    /* Com coordenada vinda do widget poupamos uma chamada a Mapbox. Mesmo
     * forjada so engana a propria tela: o pedido e recalculado no fechamento. */
    const resultado = Number.isFinite(lng) && Number.isFinite(lat)
      ? await entregaService.calcularParaCoordenada(q, { lng, lat })
      : await entregaService.cotarPorEndereco(q);
    res.json(resultado);
  },

  async buscarEndereco(req, res) {
    res.json({ resultados: await entregaService.buscarEnderecos(req.validado.query.q) });
  },

  /* Informa se o widget da Mapbox pode ser montado no navegador.
   * Token secreto ("sk.") nunca chega aqui: tokenPublico() devolve vazio e o
   * front cai na busca via servidor. */
  statusMapbox(_req, res) {
    res.json({ configurado: temToken(), token: tokenPublico() });
  }
};
