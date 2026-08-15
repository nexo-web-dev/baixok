import { z } from "zod";

/* Ao fechar a conta, o balcao confirma se a taxa de servico (a "taxa do
 * garcom") foi cobrada do cliente. Por padrao cobra — e o que a casa faz na
 * imensa maioria das contas — mas negociar ou dispensar acontece, e o total
 * fechado (e o relatorio) precisam refletir isso.
 *
 * `pagamento` e obrigatorio: sem ele os pedidos da mesa ficariam pra sempre
 * marcados como "Pagar no balcao", que nunca foi forma de pagamento de
 * verdade — so um marcador de "ainda nao pago" enquanto a comanda estava
 * aberta. */
export const fecharContaSchema = z.object({
  cobrarServico: z.boolean().default(true),
  pagamento: z.string().trim().min(1, "Escolha a forma de pagamento.").max(60)
}).strict();
