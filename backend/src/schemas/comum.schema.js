/* Blocos reaproveitados pelos demais schemas. */
import { z } from "zod";
import { LIMITES } from "../config/constants.js";

/* Texto de formulario: apara espacos, corta no limite e aceita vazio.
 * O `.slice()` repetido campo a campo no server.js antigo virou isto. */
export const texto = (max, { obrigatorio = false } = {}) => {
  const base = z.string().trim().max(max, `Use no maximo ${max} caracteres.`);
  return obrigatorio ? base.min(1, "Campo obrigatório.") : base.default("");
};

export const dinheiro = z
  .coerce.number({ message: "Informe um valor numerico." })
  .finite("Valor invalido.")
  .min(0, "O valor não pode ser negativo.")
  .max(99999, "Valor acima do permitido.")
  /* Duas casas: sem isto, 19.999999 entra no banco e o total fecha com centavo
   * de diferenca em relacao ao que o cliente viu. */
  .transform(valor => Math.round(valor * 100) / 100);

export const quantidade = z.coerce.number().int().min(1).max(LIMITES.QTD_ITEM_MAX);

export const idTexto = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/, "Identificador invalido.");

export const paramsId = z.object({ id: idTexto });

export const paramsNumero = z.object({
  n: z.coerce.number().int().min(1).max(999)
});

export const longitude = z.coerce.number().min(-180).max(180);
export const latitude = z.coerce.number().min(-90).max(90);

/* Datas do dashboard chegam como AAAA-MM-DD. */
export const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.");
