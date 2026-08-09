/* Rotulos de exibicao.
 *
 * Sao so nomes para a tela. A lista que vale — a que decide o que o sistema
 * aceita — esta em backend/src/config/constants.js e e aplicada pelos schemas.
 * Uma categoria escrita errada aqui vira rotulo feio; escrita errada la, vira
 * dado recusado. */

export const CATEGORIAS_ROTULO = Object.freeze({
  pizzas: "Pizzas",
  burgues: "Burguers",
  massas: "Massas",
  drinks: "Drinks",
  porcoes: "Porções",
  combos: "Combos"
});

export function rotuloCategoria(categoria) {
  const valor = String(categoria || "").trim();
  if (!valor) return "Sem categoria";
  return CATEGORIAS_ROTULO[valor] || valor;
}

export const CANAIS_ROTULO = Object.freeze({
  cardapio: "Cardápio",
  loja: "Loja",
  ifood: "iFood",
  "99food": "99Food",
  rappi: "Rappi",
  whatsapp: "WhatsApp"
});

export const MODALIDADES_ROTULO = Object.freeze({
  retirada: "Retirada",
  entrega: "Entrega",
  mesa: "Mesa"
});

export const STATUS_ROTULO = Object.freeze({
  novo: "Novo",
  preparo: "Em preparo",
  pronto: "Pronto para retirada",
  entregue: "Entregue",
  cancelado: "Cancelado"
});

export const PAPEIS_ROTULO = Object.freeze({
  admin: "Administrador",
  caixa: "Caixa",
  cozinha: "Cozinha",
  entregador: "Entregador"
});
