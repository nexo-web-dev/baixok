/* Regras da area de entrega.
 *
 * A taxa e calculada AQUI, sempre. Nunca aceita do navegador: bastaria trocar
 * `deliveryFee` no corpo do pedido para levar frete de graca. */
import { entregaRepo } from "../repositories/entrega.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { distanciaKm, faixaDaDistancia } from "../lib/geo.js";
import { geocodificar } from "../lib/mapbox.js";
import { ErroApp } from "../lib/errors.js";
import { publicar, CANAL } from "../lib/events.js";

export const entregaService = {
  config: () => entregaRepo.config(),
  configPublica: () => entregaRepo.configPublica(),

  async salvarConfig(dados, { usuario, ip }) {
    await entregaRepo.salvarConfig({ endereco: dados.endereco, lng: dados.lng, lat: dados.lat });
    await entregaRepo.substituirFaixas(dados.zones);
    await auditoriaRepo.registrar({
      usuarioId: usuario.id, usuario: usuario.usuario, acao: "entrega_configurada",
      entidade: "entrega", detalhes: { faixas: dados.zones.length, endereco: dados.endereco }, ip
    });
    publicar("entrega", [CANAL.PUBLICO, CANAL.OPERACAO]);
    return entregaRepo.config();
  },

  /* Calculo puro sobre uma coordenada ja conhecida. */
  async calcularParaCoordenada(endereco, coordenada) {
    const loja = await entregaRepo.config();
    if (loja.lng == null || loja.lat == null || !loja.zones.length) {
      return { configurado: false, dentro: false, taxa: 0, km: null, zona: null, minimo: 0, endereco };
    }
    const km = distanciaKm(loja.lng, loja.lat, coordenada.lng, coordenada.lat);
    const faixa = faixaDaDistancia(km, loja.zones);
    return {
      configurado: true,
      dentro: Boolean(faixa),
      km: Math.round(km * 10) / 10,
      taxa: faixa ? Number(faixa.fee) : 0,
      minimo: faixa ? Number(faixa.min || 0) : 0,
      zona: faixa ? `até ${faixa.km} km` : null,
      endereco
    };
  },

  /* Cotacao a partir do texto do endereco. Chamada de fora da transacao do
   * pedido, porque faz I/O de rede. */
  async cotarPorEndereco(endereco) {
    const loja = await entregaRepo.config();
    const achados = await geocodificar(endereco, loja);
    if (!achados.length) throw new ErroApp("Não encontramos esse endereço.", 404, "endereco_nao_encontrado");
    return this.calcularParaCoordenada(endereco, achados[0]);
  },

  async buscarEnderecos(termo) {
    return geocodificar(termo, await entregaRepo.config());
  }
};
