/* Vocabulario do dominio. Vive no backend porque e ele quem valida: o front
 * espelha estas listas so para desenhar rotulo, nunca para decidir nada. */

export const PAPEIS = Object.freeze({
  ADMIN: "admin",
  CAIXA: "caixa",
  COZINHA: "cozinha",
  ENTREGADOR: "entregador",
  GARCOM: "garcom"
});
export const TODOS_PAPEIS = Object.freeze(Object.values(PAPEIS));

/* Hierarquia achatada de proposito: cozinha nao e "meio caixa". Cada rota
 * declara quais papeis aceita, e a lista fica visivel na propria rota. */
export const STATUS_PEDIDO = Object.freeze(["novo", "preparo", "pronto", "entregue", "cancelado"]);
export const STATUS_ABERTOS = Object.freeze(["novo", "preparo", "pronto"]);

export const CANAIS = Object.freeze(["cardapio", "loja", "ifood", "99food", "rappi", "whatsapp"]);
export const MODALIDADES = Object.freeze(["retirada", "entrega", "mesa"]);
export const CATEGORIAS = Object.freeze(["pizzas", "burgues", "massas", "drinks", "porcoes"]);
export const STATUS_MESA = Object.freeze(["livre", "aberta", "fechando"]);
export const TIPOS_CUPOM = Object.freeze(["pct", "val"]);

/* Taxa de servico do salao. Era uma constante solta no app.js, portanto
 * editavel pelo cliente no devtools; agora e o servidor que aplica. */
export const TAXA_SERVICO_MESA = 0.1;

/* Depois deste tempo sem sair do "novo" o pedido aparece atrasado no painel. */
export const MINUTOS_ATRASO = 15;

/* O dia operacional vira as 5h: pedido feito 1h da manha pertence ao movimento
 * da noite anterior, e nao ao dia seguinte. */
export const HORA_VIRADA = 5;

export const LIMITES = Object.freeze({
  QTD_ITEM_MAX: 99,
  ITENS_POR_PEDIDO: 60,
  NOME_CLIENTE: 80,
  TELEFONE: 40,
  ENDERECO: 160,
  OBSERVACAO: 400,
  PAGAMENTO: 60,
  BUSCA_ENDERECO: 256,
  OUVINTES_SSE: 200
});
