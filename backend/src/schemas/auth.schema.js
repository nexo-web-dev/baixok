import { z } from "zod";
import { TODOS_PAPEIS } from "../config/constants.js";
import { texto } from "./comum.schema.js";

/* Politica de senha: comprimento acima de tudo.
 *
 * Trocamos a senha de 6 digitos (900 mil combinacoes, quebravel em horas) por
 * um minimo de 10 caracteres. Sem exigencia de simbolo obrigatorio de proposito
 * — na pratica isso produz "Senha@123" em todo mundo. Comprimento e o que
 * realmente aumenta o custo do ataque. */
export const senhaSchema = z
  .string()
  .min(10, "A senha precisa de pelo menos 10 caracteres.")
  .max(200, "Senha longa demais.")
  .refine(valor => valor.trim().length >= 10, "A senha não pode ser só espaços.");

export const loginSchema = z.object({
  usuario: z.string().trim().min(3, "Informe o usuario.").max(50),
  senha: z.string().min(1, "Informe a senha.").max(200)
});

export const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1, "Informe a senha atual.").max(200),
  senhaNova: senhaSchema
});

export const criarUsuarioSchema = z.object({
  usuario: z
    .string().trim().toLowerCase()
    .min(3, "O usuario precisa de pelo menos 3 caracteres.")
    .max(80)
    .refine(valor =>
      /^[a-z0-9._-]+$/.test(valor) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor),
    "Informe um e-mail valido ou um nome de usuario."),
  nome: texto(80, { obrigatorio: true }),
  senha: senhaSchema,
  papel: z.enum(TODOS_PAPEIS, { message: "Papel invalido." }),
  abasVer: z.array(z.string().trim().min(1).max(40)).default([]),
  abasEditar: z.array(z.string().trim().min(1).max(40)).default([])
});

export const atualizarUsuarioSchema = z.object({
  nome: texto(80).optional(),
  papel: z.enum(TODOS_PAPEIS).optional(),
  ativo: z.boolean().optional(),
  abasVer: z.array(z.string().trim().min(1).max(40)).optional(),
  abasEditar: z.array(z.string().trim().min(1).max(40)).optional()
});

export const redefinirSenhaSchema = z.object({ senha: senhaSchema });
