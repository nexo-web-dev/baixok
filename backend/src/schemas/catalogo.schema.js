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
  .max(260_000, "Imagem grande demais. Envie uma foto menor.")
  .refine(
    valor => valor === ""
      || /^\/?images\/[\w.-]+$/.test(valor)
      || /^\/api\/publico\/produtos\/[^/]+\/imagem(?:\?v=[^&\s]*)?$/.test(valor)
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
  description: texto(300)
}).strict();

export const reordenarProdutoSchema = z.object({
  direction: z.enum(["up", "down"], { message: "Direcao invalida." })
}).strict();

export const ajusteEstoqueSchema = z.object({
  delta: z.coerce.number().int().min(-9999).max(9999).optional(),
  valor: z.coerce.number().int().min(0).max(99999).optional()
}).refine(
  dados => dados.delta !== undefined || dados.valor !== undefined,
  "Informe delta ou valor."
);

/* A regra "promocional < preco cheio" nao cabe aqui: o schema nao conhece o
 * preco do produto. Fica no servico, que consulta o cadastro. */
export const promocaoSchema = z.object({
  productId: idTexto,
  price: dinheiro,
  until: texto(20)
}).strict();

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
