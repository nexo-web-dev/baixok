import { z } from "zod";

/* Ao fechar a conta, o balcao confirma se a taxa de servico (a "taxa do
 * garcom") foi cobrada do cliente. Por padrao cobra — e o que a casa faz na
 * imensa maioria das contas — mas negociar ou dispensar acontece, e o total
 * fechado (e o relatorio) precisam refletir isso. */
export const fecharContaSchema = z.object({
  cobrarServico: z.boolean().default(true)
}).strict();
