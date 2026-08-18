import { z } from "zod";
import { TIPOS_CUPOM } from "../config/constants.js";
import { texto, dinheiro, idTexto } from "./comum.schema.js";

/* Imagem: caminho relativo do proprio site ou data URL de imagem.
 *
 * O painel antigo aceitava qualquer string no campo, e ela ia direto para
 * `<img src="...">`. Um `javascript:` ali virava execucao de script no
 * cardapio de todo cliente. A lista fechada abaixo e o que fecha esse buraco na
 * entrada; o front ainda escapa na saida. */
const imagemSchema = z
  .string()
  .trim()
  .max(2_500_000, "Imagem grande demais. Envie uma foto menor.")
  .refine(
    valor => valor === ""
      || /^\/?images\/[\w.-]+$/.test(valor)
      || /^\/?uploads\/[\w.-]+$/.test(valor)
      || /^\/api\/publico\/produtos\/[^/]+\/imagem(?:\?[^&\s]*)?$/.test(valor)
      || /^https?:\/\/[^\s<>"']+$/.test(valor)
      || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(valor),
    "Use uma imagem do próprio site ou envie um arquivo de imagem."
  )
  .transform(valor => valor.replace(/^\/images\//, "images/"))
  .default("");

export const produtoSchema = z.object({
  name: texto(80, { obrigatorio: true }),
  category: texto(60, { obrigatorio: true }),
  price: dinheiro,
  stock: z.coerce.number().int().min(0).max(99999).default(0),
  minStock: z.coerce.number().int().min(0).max(9999).default(4),
  order: z.coerce.number().int().min(1).max(9999).optional(),
  featuredOrder: z.coerce.number().int().min(0).max(3).default(0),
  active: z.boolean().default(true),
  image: imagemSchema,
  saborPizza: z.boolean().default(false),
  description: texto(300)
}).strict();

/* Combo: item vendavel proprio, composto de produtos existentes em alguma
 * quantidade. Sem itens nao ha o que vender — pelo menos 1, e no maximo 10
 * pra nao virar um pedido inteiro disfarcado de combo. */
export const comboSchema = z.object({
  name: texto(80, { obrigatorio: true }),
  description: texto(300),
  price: dinheiro,
  image: imagemSchema,
  active: z.boolean().default(true),
  order: z.coerce.number().int().min(1).max(9999).optional(),
  items: z.array(z.object({
    productId: idTexto,
    quantity: z.coerce.number().int().min(1).max(20)
  })).min(1, "Escolha ao menos um produto para o combo.").max(10)
}).strict();

/* Preco da combinacao de 2 sabores. Sempre digitado pelo lojista — nao existe
 * calculo automatico (media, sabor mais caro etc). */
export const combinacaoSaborSchema = z.object({
  produtoAId: idTexto,
  produtoBId: idTexto,
  preco: dinheiro
}).strict().refine(
  dados => dados.produtoAId !== dados.produtoBId,
  { message: "Escolha dois sabores diferentes.", path: ["produtoBId"] }
);

/* CMV direto no produto: peso do saco comprado, quanto custou e quanto uma
 * porcao vendida usa — tudo em gramas. Zero e valido (ainda nao calculado). */
export const ajustarCmvSchema = z.object({
  portionG: z.coerce.number().finite("Porção inválida.").min(0).max(999999).default(0),
  packageWeightG: z.coerce.number().finite("Peso do pacote inválido.").min(0).max(999999).default(0),
  packageCost: z.coerce.number().finite("Custo inválido.").min(0).max(999999).default(0)
}).strict();

export const reordenarProdutoSchema = z.object({
  direction: z.enum(["up", "down"], { message: "Direcao invalida." })
}).strict();

export const reordenarProdutosSchema = z.object({
  ids: z.array(idTexto).min(1, "Envie ao menos um produto.").max(1000, "Envie no maximo 1000 produtos.")
}).strict();

export const ajusteEstoqueSchema = z.object({
  delta: z.coerce.number().int().min(-9999).max(9999).optional(),
  valor: z.coerce.number().int().min(0).max(99999).optional(),
  minStock: z.coerce.number().int().min(0).max(9999).optional()
}).refine(
  dados => dados.delta !== undefined || dados.valor !== undefined || dados.minStock !== undefined,
  "Informe delta, valor ou minStock."
);

/* A regra "promocional < preco cheio" nao cabe aqui: o schema nao conhece o
 * preco do produto. Fica no servico, que consulta o cadastro. */
export const promocaoSchema = z.object({
  productId: idTexto,
  price: dinheiro,
  until: texto(20)
}).strict();

export const promocaoBrindeSchema = z.object({
  buyProductId: idTexto,
  giftProductId: idTexto,
  buyQty: z.coerce.number().int().min(1).max(99).default(1),
  giftQty: z.coerce.number().int().min(1).max(99).default(1),
  until: texto(20),
  active: z.boolean().default(true)
}).strict().refine(
  dados => dados.buyProductId !== dados.giftProductId,
  { message: "Escolha produtos diferentes para compra e brinde.", path: ["giftProductId"] }
);

export const cupomSchema = z.object({
  code: z
    .string().trim().toUpperCase()
    .min(3, "O código precisa de pelo menos 3 caracteres.")
    .max(30)
    .regex(/^[A-Z0-9-]+$/, "Use apenas letras, numeros e hifen."),
  kind: z.enum(TIPOS_CUPOM, { message: "Tipo de cupom invalido." }),
  amount: z.coerce.number().positive("Informe o valor do desconto."),
  min: dinheiro.default(0),
  once: z.boolean().default(false),
  until: texto(20)
}).strict().refine(
  dados => dados.kind !== "pct" || dados.amount <= 100,
  { message: "Desconto percentual não pode passar de 100%.", path: ["amount"] }
);

/* Validar o cupom que o cliente digitou. Devolve so o efeito no carrinho
 * daquele cliente — nunca a lista de cupons existentes. */
export const validarCupomSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(30),
  subtotal: dinheiro,
  phone: texto(40)
});
