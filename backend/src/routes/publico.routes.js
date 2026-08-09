/* Rotas abertas — sem login.
 *
 * A lista e curta de proposito e cabe inteira numa tela: e a superficie exposta
 * do sistema. Qualquer rota nova aqui merece a pergunta "isto pode ser lido por
 * qualquer pessoa da internet?". */
import { Router } from "express";
import { publicoController } from "../controllers/publico.controller.js";
import { validarCorpo, validarQuery, validarParams } from "../middlewares/validate.js";
import { limitePedido, limiteGeocodificacao, limiteHistoricoPedidos } from "../middlewares/rateLimit.js";
import { criarPedidoPublicoSchema, historicoPedidoSchema } from "../schemas/pedido.schema.js";
import { validarCupomSchema } from "../schemas/catalogo.schema.js";
import { buscarEnderecoSchema, cotarEntregaSchema } from "../schemas/entrega.schema.js";
import { paramsId, paramsNumero } from "../schemas/comum.schema.js";

export const rotasPublicas = Router();

rotasPublicas.get("/cardapio", publicoController.cardapio);
rotasPublicas.get("/produtos/:id/imagem", validarParams(paramsId), publicoController.imagemProduto);
rotasPublicas.get("/mesas/:n", validarParams(paramsNumero), publicoController.statusMesa);
rotasPublicas.get("/pedidos/historico", limiteHistoricoPedidos, validarQuery(historicoPedidoSchema), publicoController.historicoPedidos);

rotasPublicas.post(
  "/pedidos",
  limitePedido,
  validarCorpo(criarPedidoPublicoSchema),
  publicoController.criarPedido
);

rotasPublicas.post("/cupons/validar", validarCorpo(validarCupomSchema), publicoController.validarCupom);

rotasPublicas.get("/entrega/status", publicoController.statusMapbox);
rotasPublicas.get("/entrega/buscar", limiteGeocodificacao, validarQuery(buscarEnderecoSchema), publicoController.buscarEndereco);
rotasPublicas.get("/entrega/cotar", limiteGeocodificacao, validarQuery(cotarEntregaSchema), publicoController.cotarEntrega);
