import { z } from "zod";
import { texto } from "./comum.schema.js";

export const abrirCaixaSchema = z.object({
  senha: texto(200, { obrigatorio: true })
}).strict();

export const fecharCaixaSchema = z.object({
  observacao: texto(500)
}).strict();

export const listarFechamentosSchema = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(100)
});
