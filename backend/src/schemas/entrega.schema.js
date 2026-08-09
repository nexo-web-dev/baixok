import { z } from "zod";
import { texto, dinheiro, longitude, latitude } from "./comum.schema.js";

const faixaSchema = z.object({
  km: z.coerce.number().positive("O raio precisa ser maior que zero.").max(200),
  fee: dinheiro,
  min: dinheiro.default(0)
});

export const configEntregaSchema = z.object({
  endereco: texto(200),
  lng: longitude.nullable().default(null),
  lat: latitude.nullable().default(null),
  /* Ordenadas na entrada: o resto do sistema conta com km crescente para achar
   * "a primeira faixa que alcanca". */
  zones: z.array(faixaSchema).max(20, "No maximo 20 faixas.").default([])
}).strict().transform(dados => ({
  ...dados,
  zones: [...dados.zones].sort((a, b) => a.km - b.km)
}));

export const buscarEnderecoSchema = z.object({
  q: z.string().trim().min(3, "Digite pelo menos 3 caracteres.").max(256)
});

/* Previa da taxa mostrada no carrinho.
 *
 * lng/lat sao opcionais e vem do widget da Mapbox quando ele carregou. Mesmo
 * forjadas, so enganam a propria tela: no fechamento do pedido o servidor
 * geocodifica o endereco de novo e refaz a conta do zero. */
export const cotarEntregaSchema = z.object({
  q: z.string().trim().min(3, "Endereço muito curto.").max(256),
  lng: longitude.optional(),
  lat: latitude.optional()
});
