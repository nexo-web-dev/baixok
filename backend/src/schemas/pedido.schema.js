import { z } from "zod";
import { CANAIS, MODALIDADES, STATUS_PEDIDO, LIMITES } from "../config/constants.js";
import { texto, idTexto, quantidade, dataIso } from "./comum.schema.js";

/* O item que o cliente manda diz O QUE foi pedido, nunca QUANTO custa.
 *
 * Nao ha campo de preco aqui de proposito: se existisse, alguem mandaria
 * `price: 0.01` e o schema aceitaria de bom grado. O preco vem do cadastro,
 * buscado pelo servico na hora de montar o pedido. */
const itemPedidoSchema = z.object({
  id: idTexto,
  qty: quantidade
});

export const criarPedidoPublicoSchema = z.object({
  items: z.array(itemPedidoSchema).min(1, "Adicione ao menos um item.").max(LIMITES.ITENS_POR_PEDIDO),
  customer: texto(LIMITES.NOME_CLIENTE, { obrigatorio: true }),
  phone: texto(LIMITES.TELEFONE),
  place: texto(LIMITES.ENDERECO),
  note: texto(LIMITES.OBSERVACAO),
  payment: texto(LIMITES.PAGAMENTO),
  trocoPara: z.coerce.number().positive().nullable().optional(),
  coupon: texto(40),
  fulfillment: z.enum(MODALIDADES).default("retirada"),
  tableNumber: z.coerce.number().int().min(1).max(999).nullable().default(null)
}).strict();

/* Lancamento manual pelo balcao. Continua sem preco vindo do formulario:
 * o atendente escolhe produto e quantidade, o servidor precifica.
 * O canal e livre porque a venda pode ter entrado pelo iFood ou WhatsApp. */
export const criarPedidoManualSchema = z.object({
  items: z.array(itemPedidoSchema).min(1, "Adicione ao menos um item.").max(LIMITES.ITENS_POR_PEDIDO),
  customer: texto(LIMITES.NOME_CLIENTE),
  phone: texto(LIMITES.TELEFONE),
  place: texto(LIMITES.ENDERECO),
  note: texto(LIMITES.OBSERVACAO),
  payment: texto(LIMITES.PAGAMENTO),
  trocoPara: z.coerce.number().positive().nullable().optional(),
  channel: z.enum(CANAIS).default("loja"),
  fulfillment: z.enum(MODALIDADES).default("retirada"),
  tableNumber: z.coerce.number().int().min(1).max(999).nullable().default(null)
}).strict();

export const mudarStatusSchema = z.object({
  status: z.enum(STATUS_PEDIDO, { message: "Status invalido." })
});

export const cancelarPedidoSchema = z.object({
  motivo: texto(200, { obrigatorio: true })
});

export const motoboyPedidoSchema = z.object({
  motoboy: texto(80, { obrigatorio: true })
});

export const listarPedidosSchema = z.object({
  status: z.enum(STATUS_PEDIDO).optional(),
  desde: dataIso.optional(),
  ate: dataIso.optional(),
  limite: z.coerce.number().int().min(1).max(1000).default(500)
});

export const historicoPedidoSchema = z.object({
  phone: texto(LIMITES.TELEFONE, { obrigatorio: true }),
  limite: z.coerce.number().int().min(1).max(10).default(5)
});

export const relatorioSchema = z.object({
  periodo: z.enum(["hoje", "7dias", "30dias", "mes", "personalizado"]).default("hoje"),
  desde: dataIso.optional(),
  ate: dataIso.optional(),
  canal: z.enum(CANAIS).optional()
});
