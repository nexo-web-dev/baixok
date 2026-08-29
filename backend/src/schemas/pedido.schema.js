import { z } from "zod";
import { CANAIS, MODALIDADES, STATUS_PEDIDO, LIMITES } from "../config/constants.js";
import { texto, idTexto, quantidade, dataIso, latitude, longitude, dinheiro } from "./comum.schema.js";

/* O item que o cliente manda diz O QUE foi pedido, nunca QUANTO custa.
 *
 * Nao ha campo de preco aqui de proposito: se existisse, alguem mandaria
 * `price: 0.01` e o schema aceitaria de bom grado. O preco vem do cadastro,
 * buscado pelo servico na hora de montar o pedido.
 *
 * Tres formatos possiveis: produto normal (`id`), combo (`comboId`) ou pizza
 * de 2 sabores (`id` + `id2`, os dois produtos escolhidos). Exatamente um de
 * `id`/`comboId` precisa vir preenchido — `id2` so faz sentido junto de `id`. */
const itemPedidoSchema = z.object({
  id: idTexto.optional(),
  id2: idTexto.optional(),
  comboId: idTexto.optional(),
  qty: quantidade
}).strict().refine(
  item => Boolean(item.id) !== Boolean(item.comboId),
  { message: "Informe um produto ou um combo, nunca os dois.", path: ["id"] }
).refine(
  item => !item.id2 || (Boolean(item.id) && item.id2 !== item.id),
  { message: "Segundo sabor invalido.", path: ["id2"] }
);

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

/* Acrescentar item num pedido que ja existe — cliente ligou pedindo mais uma
 * coisa, ou o balcao esqueceu de lancar algo. Mesmo formato de item do pedido
 * novo: sem preco, o servidor precifica pelo cadastro atual. */
export const adicionarItensPedidoSchema = z.object({
  items: z.array(itemPedidoSchema).min(1, "Adicione ao menos um item.").max(LIMITES.ITENS_POR_PEDIDO)
}).strict();

export const mudarStatusSchema = z.object({
  status: z.enum(STATUS_PEDIDO, { message: "Status invalido." }),
  motoboy: texto(80).optional(),
  /* So faz sentido junto de status "entregue": marca ali mesmo, na hora, que
   * o pagamento nao foi recebido — motivo obrigatorio checado no service. */
  pagamentoNaoRecebido: z.boolean().optional(),
  motivoNaoPago: texto(200).optional()
});

export const cancelarPedidoSchema = z.object({
  motivo: texto(200, { obrigatorio: true })
});

/* Apagar pedido some com o registro de verdade — diferente de cancelar, que so
 * muda o status e mantem tudo rastreavel. Por isso exige a senha do proprio
 * admin de novo, mesmo com a sessao ja logada: confirma que e a pessoa na
 * frente do teclado, nao uma aba esquecida aberta. */
export const excluirPedidoSchema = z.object({
  senha: texto(200, { obrigatorio: true })
}).strict();

export const motoboyPedidoSchema = z.object({
  motoboy: texto(80, { obrigatorio: true })
});

/* "+"/"-" no detalhe do pedido. Zero e valido de proposito — zerar reaproveita
 * a mesma regra de remover item (ver pedidos.service.js). */
export const ajustarQuantidadeItemSchema = z.object({
  qty: z.coerce.number().int().min(0).max(LIMITES.QTD_ITEM_MAX)
}).strict();

export const dividirPagamentoSchema = z.object({
  componentes: z.array(z.object({
    forma: texto(30, { obrigatorio: true }),
    valor: dinheiro
  }).strict()).min(2, "Informe pelo menos duas formas de pagamento.").max(6)
}).strict();

/* Cortesia: pedido todo ou so alguns itens (itemId de pedido_itens), sempre
 * com motivo — e o que fica na auditoria do "por que" esse dinheiro nao
 * entrou. Lista vazia so e valida quando todoPedido = true. */
export const definirCortesiaSchema = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).max(LIMITES.ITENS_POR_PEDIDO).default([]),
  todoPedido: z.boolean().default(false),
  motivo: texto(200, { obrigatorio: true })
}).strict().refine(
  dados => dados.todoPedido || dados.itemIds.length > 0,
  { message: "Selecione o pedido todo ou ao menos um item.", path: ["itemIds"] }
);

export const definirTaxaServicoSchema = z.object({
  aplicar: z.boolean()
}).strict();

export const definirPagamentoSchema = z.object({
  pagamento: texto(60, { obrigatorio: true }),
  /* Obrigatorio so quando pagamento = "Não pago" — checado no service, nao
   * aqui, porque o schema nao sabe nada sobre o valor de outro campo nessa
   * versao. */
  motivo: texto(200)
}).strict();

export const localizacaoMotoboySchema = z.object({
  lat: latitude,
  lng: longitude,
  accuracy: z.coerce.number().min(0).max(10000).nullable().optional(),
  deviceId: idTexto.default("principal"),
  deviceName: texto(80),
  motoboy: texto(80).optional()
}).strict();

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
  periodo: z.enum(["hoje", "ontem", "7dias", "30dias", "mes", "tudo", "personalizado"]).default("hoje"),
  desde: dataIso.optional(),
  ate: dataIso.optional(),
  canal: z.enum(CANAIS).optional(),
  pagamento: texto(60).optional(),
  categoria: texto(60).optional()
});
