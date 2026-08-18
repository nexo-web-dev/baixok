/* Rotas do painel.
 *
 * As permissões reais vêm de `abasVer` e `abasEditar`, mas algumas áreas
 * continuam travadas ao admin por regra do negócio. Assim a UI e a API ficam
 * coerentes sem abrir espaço indevido para balcão ou cozinha.
 */
import { Router } from "express";
import {
  pedidosController, produtosController, promocoesController, cuponsController,
  mesasController, entregaController, relatoriosController, usuariosController, ajustesController,
  insumosController, caixaController, motoboysController, combosController, combinacoesSaboresController
} from "../controllers/painel.controller.js";
import { exigirLogin, exigirPapel, exigirAba } from "../middlewares/auth.js";
import { validarCorpo, validarQuery, validarParams } from "../middlewares/validate.js";
import { paramsId, paramsIdItem, paramsNumero, paramsParProdutos } from "../schemas/comum.schema.js";
import {
  criarPedidoManualSchema, mudarStatusSchema, cancelarPedidoSchema, motoboyPedidoSchema,
  listarPedidosSchema, relatorioSchema, localizacaoMotoboySchema, excluirPedidoSchema,
  adicionarItensPedidoSchema, definirPagamentoSchema, ajustarQuantidadeItemSchema, dividirPagamentoSchema
} from "../schemas/pedido.schema.js";
import { abrirCaixaSchema, fecharCaixaSchema, listarFechamentosSchema, excluirFechamentoSchema } from "../schemas/caixa.schema.js";
import {
  produtoSchema, ajusteEstoqueSchema, reordenarProdutoSchema, reordenarProdutosSchema, promocaoSchema, cupomSchema,
  promocaoBrindeSchema, comboSchema, combinacaoSaborSchema, fichaTecnicaSchema
} from "../schemas/catalogo.schema.js";
import { insumoSchema, ajusteInsumoSchema } from "../schemas/insumo.schema.js";
import { configEntregaSchema } from "../schemas/entrega.schema.js";
import { criarUsuarioSchema, atualizarUsuarioSchema, redefinirSenhaSchema } from "../schemas/auth.schema.js";
import { ajustesSchema, auditoriaQuerySchema } from "../schemas/ajustes.schema.js";
import { fecharContaSchema } from "../schemas/mesa.schema.js";

export const rotasPainel = Router();

rotasPainel.use(exigirLogin);

const VER_PEDIDOS = exigirAba("pedidos", "ver");
const EDIT_PEDIDOS = exigirAba("pedidos", "editar");
const VER_MESAS = exigirAba("mesas", "ver");
const EDIT_MESAS = exigirAba("mesas", "editar");
const VER_ESTOQUE = exigirAba("estoque", "ver");
const EDIT_ESTOQUE = exigirAba("estoque", "editar");
const VER_FECHAMENTOS = exigirAba("fechamentos", "ver");
const VER_MOTOBOY = exigirAba("motoboy", "ver");
const EDIT_MOTOBOY = exigirAba("motoboy", "editar");
const ADMIN = exigirPapel("admin");

// ------------------------------------------------------------------ pedidos ---
rotasPainel.get("/pedidos", VER_PEDIDOS, validarQuery(listarPedidosSchema), pedidosController.listar);
rotasPainel.get("/pedidos/abertos", VER_PEDIDOS, pedidosController.abertos);
rotasPainel.get("/pedidos/:id", VER_PEDIDOS, validarParams(paramsId), pedidosController.buscar);
rotasPainel.patch("/pedidos/:id/status", EDIT_PEDIDOS, validarParams(paramsId), validarCorpo(mudarStatusSchema), pedidosController.mudarStatus);
rotasPainel.post("/pedidos/:id/impresso", EDIT_PEDIDOS, validarParams(paramsId), pedidosController.marcarImpresso);
rotasPainel.post("/pedidos/:id/cancelar", EDIT_PEDIDOS, validarParams(paramsId), validarCorpo(cancelarPedidoSchema), pedidosController.cancelar);
rotasPainel.patch("/pedidos/:id/motoboy", EDIT_PEDIDOS, validarParams(paramsId), validarCorpo(motoboyPedidoSchema), pedidosController.definirMotoboy);
rotasPainel.patch("/pedidos/:id/pagamento", EDIT_PEDIDOS, validarParams(paramsId), validarCorpo(definirPagamentoSchema), pedidosController.definirPagamento);
rotasPainel.post("/pedidos/:id/pagamento/dividir", EDIT_PEDIDOS, validarParams(paramsId), validarCorpo(dividirPagamentoSchema), pedidosController.dividirPagamento);
rotasPainel.post("/pedidos", EDIT_PEDIDOS, validarCorpo(criarPedidoManualSchema), pedidosController.criarManual);
/* Apagar e diferente de cancelar: some com o registro. So o admin, e mesmo
 * logado precisa confirmar a propria senha de novo (corpo da requisicao). */
rotasPainel.delete("/pedidos/:id", ADMIN, validarParams(paramsId), validarCorpo(excluirPedidoSchema), pedidosController.remover);
rotasPainel.post("/pedidos/:id/itens", EDIT_PEDIDOS, validarParams(paramsId), validarCorpo(adicionarItensPedidoSchema), pedidosController.adicionarItens);
rotasPainel.delete("/pedidos/:id/itens/:itemId", EDIT_PEDIDOS, validarParams(paramsIdItem), pedidosController.removerItem);
rotasPainel.patch("/pedidos/:id/itens/:itemId", EDIT_PEDIDOS, validarParams(paramsIdItem), validarCorpo(ajustarQuantidadeItemSchema), pedidosController.ajustarQuantidadeItem);

// ----------------------------------------------------------------- motoboy ---
rotasPainel.get("/motoboys/localizacoes", exigirPapel("admin", "caixa"), motoboysController.localizacoes);
rotasPainel.post("/motoboys/localizacao", VER_MOTOBOY, EDIT_MOTOBOY, validarCorpo(localizacaoMotoboySchema), motoboysController.salvarLocalizacao);

// -------------------------------------------------------------------- caixa ---
rotasPainel.get("/caixa/atual", VER_PEDIDOS, caixaController.atual);
rotasPainel.post("/caixa/abrir", EDIT_PEDIDOS, validarCorpo(abrirCaixaSchema), caixaController.abrir);
rotasPainel.post("/caixa/fechar", EDIT_PEDIDOS, validarCorpo(fecharCaixaSchema), caixaController.fechar);
rotasPainel.get("/caixa/fechamentos", VER_FECHAMENTOS, validarQuery(listarFechamentosSchema), caixaController.listar);
rotasPainel.get("/caixa/fechamentos/:id", VER_FECHAMENTOS, validarParams(paramsId), caixaController.buscar);
rotasPainel.get("/caixa/fechamentos/:id/pdf", VER_FECHAMENTOS, validarParams(paramsId), caixaController.pdf);
/* Mesma regra da exclusao de pedido: so admin, com senha de novo no corpo. */
rotasPainel.delete("/caixa/fechamentos/:id", ADMIN, validarParams(paramsId), validarCorpo(excluirFechamentoSchema), caixaController.remover);

// ----------------------------------------------------------------- produtos ---
rotasPainel.get("/produtos", produtosController.listar);
rotasPainel.get("/produtos/em-falta", ADMIN, produtosController.emFalta);
rotasPainel.post("/produtos", ADMIN, validarCorpo(produtoSchema), produtosController.criar);
rotasPainel.patch("/produtos/ordem", ADMIN, validarCorpo(reordenarProdutosSchema), produtosController.reordenar);
rotasPainel.put("/produtos/:id", ADMIN, validarParams(paramsId), validarCorpo(produtoSchema), produtosController.atualizar);
rotasPainel.delete("/produtos/:id", ADMIN, validarParams(paramsId), produtosController.remover);
rotasPainel.post("/produtos/:id/alternar", ADMIN, validarParams(paramsId), produtosController.alternarAtivo);
rotasPainel.patch("/produtos/:id/estoque", EDIT_ESTOQUE, validarParams(paramsId), validarCorpo(ajusteEstoqueSchema), produtosController.ajustarEstoque);
rotasPainel.patch("/produtos/:id/ordem", ADMIN, validarParams(paramsId), validarCorpo(reordenarProdutoSchema), produtosController.moverOrdem);
rotasPainel.put("/produtos/:id/ficha-tecnica", ADMIN, validarParams(paramsId), validarCorpo(fichaTecnicaSchema), produtosController.definirFichaTecnica);

// -------------------------------------------------------------------- combos ---
rotasPainel.get("/combos", combosController.listar);
rotasPainel.post("/combos", ADMIN, validarCorpo(comboSchema), combosController.criar);
rotasPainel.put("/combos/:id", ADMIN, validarParams(paramsId), validarCorpo(comboSchema), combosController.atualizar);
rotasPainel.delete("/combos/:id", ADMIN, validarParams(paramsId), combosController.remover);
rotasPainel.post("/combos/:id/alternar", ADMIN, validarParams(paramsId), combosController.alternarAtivo);

// ------------------------------------------------------ combinacoes de sabores ---
rotasPainel.get("/combinacoes-sabores", combinacoesSaboresController.listar);
rotasPainel.post("/combinacoes-sabores", ADMIN, validarCorpo(combinacaoSaborSchema), combinacoesSaboresController.salvar);
rotasPainel.delete("/combinacoes-sabores/:a/:b", ADMIN, validarParams(paramsParProdutos), combinacoesSaboresController.remover);

// ------------------------------------------------------------------ insumos ---
rotasPainel.get("/insumos", VER_ESTOQUE, insumosController.listar);
rotasPainel.post("/insumos", EDIT_ESTOQUE, validarCorpo(insumoSchema), insumosController.criar);
rotasPainel.put("/insumos/:id", EDIT_ESTOQUE, validarParams(paramsId), validarCorpo(insumoSchema), insumosController.atualizar);
rotasPainel.patch("/insumos/:id/estoque", EDIT_ESTOQUE, validarParams(paramsId), validarCorpo(ajusteInsumoSchema), insumosController.ajustar);
rotasPainel.delete("/insumos/:id", EDIT_ESTOQUE, validarParams(paramsId), insumosController.remover);

// -------------------------------------------------------- promocoes e cupons ---
rotasPainel.get("/promocoes", ADMIN, promocoesController.listar);
rotasPainel.post("/promocoes", ADMIN, validarCorpo(promocaoSchema), promocoesController.salvar);
rotasPainel.post("/promocoes/brindes", ADMIN, validarCorpo(promocaoBrindeSchema), promocoesController.salvarBrinde);
rotasPainel.delete("/promocoes/brindes/:id", ADMIN, validarParams(paramsId), promocoesController.removerBrinde);
rotasPainel.delete("/promocoes/:id", ADMIN, validarParams(paramsId), promocoesController.remover);
rotasPainel.get("/cupons", ADMIN, cuponsController.listar);
rotasPainel.post("/cupons", ADMIN, validarCorpo(cupomSchema), cuponsController.criar);
rotasPainel.post("/cupons/:id/alternar", ADMIN, validarParams(paramsId), cuponsController.alternarAtivo);
rotasPainel.delete("/cupons/:id", ADMIN, validarParams(paramsId), cuponsController.remover);

// ------------------------------------------------------------------- mesas ---
rotasPainel.get("/mesas", VER_MESAS, mesasController.listar);
rotasPainel.post("/mesas", EDIT_MESAS, mesasController.adicionar);
rotasPainel.delete("/mesas/:n", EDIT_MESAS, validarParams(paramsNumero), mesasController.remover);
rotasPainel.post("/mesas/:n/abrir", EDIT_MESAS, validarParams(paramsNumero), mesasController.abrir);
rotasPainel.post("/mesas/:n/fechar", EDIT_MESAS, validarParams(paramsNumero), validarCorpo(fecharContaSchema), mesasController.fecharConta);
rotasPainel.post("/mesas/:n/liberar", EDIT_MESAS, validarParams(paramsNumero), mesasController.liberar);

// ----------------------------------------------------------------- entrega ---
rotasPainel.get("/entrega", ADMIN, entregaController.config);
rotasPainel.put("/entrega", ADMIN, validarCorpo(configEntregaSchema), entregaController.salvar);
rotasPainel.get("/entrega/mapa", ADMIN, entregaController.mapa);

// -------------------------------------------------------------- relatorios ---
rotasPainel.get("/relatorios/dashboard", ADMIN, validarQuery(relatorioSchema), relatoriosController.dashboard);
rotasPainel.get("/relatorios/exportar", ADMIN, validarQuery(relatorioSchema), relatoriosController.exportacao);

// ---------------------------------------------------------------- usuarios ---
rotasPainel.get("/usuarios", ADMIN, usuariosController.listar);
rotasPainel.post("/usuarios", ADMIN, validarCorpo(criarUsuarioSchema), usuariosController.criar);
rotasPainel.patch("/usuarios/:id", ADMIN, validarParams(paramsId), validarCorpo(atualizarUsuarioSchema), usuariosController.atualizar);
rotasPainel.post("/usuarios/:id/senha", ADMIN, validarParams(paramsId), validarCorpo(redefinirSenhaSchema), usuariosController.redefinirSenha);
rotasPainel.delete("/usuarios/:id", ADMIN, validarParams(paramsId), usuariosController.remover);
rotasPainel.get("/auditoria", ADMIN, validarQuery(auditoriaQuerySchema), usuariosController.auditoria);

// ----------------------------------------------------------------- ajustes ---
rotasPainel.get("/ajustes", ADMIN, ajustesController.ler);
rotasPainel.put("/ajustes", ADMIN, validarCorpo(ajustesSchema), ajustesController.gravar);
