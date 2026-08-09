import { motoboysRepo } from "../repositories/motoboys.repo.js";
import { PAPEIS } from "../config/constants.js";
import { semPermissao } from "../lib/errors.js";

export const motoboysService = {
  async salvarLocalizacao(dados, { usuario }) {
    if (![PAPEIS.ENTREGADOR, PAPEIS.ADMIN, PAPEIS.CAIXA].includes(usuario.papel)) {
      throw semPermissao("Somente equipe de entrega pode enviar localização.");
    }
    return motoboysRepo.salvarLocalizacao(usuario, dados);
  },

  async listarLocalizacoes() {
    return motoboysRepo.listarLocalizacoes();
  }
};
