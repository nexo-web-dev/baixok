import { z } from "zod";
import { texto } from "./comum.schema.js";

export const insumoSchema = z.object({
  name: texto(80, { obrigatorio: true }),
  category: texto(60).default("Geral"),
  unit: texto(20).default("un"),
  qty: z.coerce.number().finite("Quantidade invalida.").min(0).max(999999).default(0),
  minQty: z.coerce.number().finite("Minimo invalido.").min(0).max(999999).default(0),
  /* Pra achar o CMV sozinho: quanto pagou no pacote comprado (ex.: R$20) e
   * quanto ele rende na mesma unidade do insumo (ex.: 2000, se `unit` = "g").
   * Custo por unidade e derivado (packageCost / packageQty), nunca gravado —
   * assim nao ha valor desatualizado se um dos dois mudar sozinho depois. */
  packageCost: z.coerce.number().finite("Custo invalido.").min(0).max(999999).default(0),
  packageQty: z.coerce.number().finite("Rendimento invalido.").min(0).max(999999).default(0),
  active: z.boolean().default(true)
}).strict();

export const ajusteInsumoSchema = z.object({
  delta: z.coerce.number().finite("Ajuste invalido.").min(-999999).max(999999).optional(),
  valor: z.coerce.number().finite("Valor invalido.").min(0).max(999999).optional()
}).refine(
  dados => dados.delta !== undefined || dados.valor !== undefined,
  "Informe delta ou valor."
);
