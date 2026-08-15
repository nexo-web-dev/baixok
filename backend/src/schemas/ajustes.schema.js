import { z } from "zod";
import { texto } from "./comum.schema.js";

/* Ajustes da casa. Antes eram constantes cravadas no app.js — mudar o WhatsApp
 * da entrega exigia editar codigo e publicar de novo. */
export const ajustesSchema = z.object({
  nome_loja: texto(60).optional(),
  endereco_loja: texto(160).optional(),
  /* Endereco publicado do cardapio: e o que vai dentro do QR code das mesas. */
  menu_url: z.string().trim().url("Informe uma URL valida.").max(200).or(z.literal("")).optional(),
  whatsapp_entrega: z
    .string().trim()
    .regex(/^\d{10,15}$/, "Use so numeros, com DDI e DDD. Ex.: 5521990180151.")
    .or(z.literal(""))
    .optional(),
  /* Guardado como fracao (0.1 = 10%). */
  taxa_servico_mesa: z.coerce.number().min(0).max(0.5, "Taxa de serviço acima de 50% não faz sentido.").optional(),
  /* Impressora da cozinha nem sempre e a mesma bobina do balcao — precisa ser
   * ajustavel sem depender de codigo novo a cada modelo diferente. */
  largura_papel_cozinha: z.coerce.number().int().min(40).max(120).optional()
}).strict();

export const auditoriaQuerySchema = z.object({
  entidade: z.enum(["pedido", "produto", "promocao", "cupom", "mesa", "usuario", "entrega", "sessao"]).optional(),
  usuarioId: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200)
});
