/* Contrato com o back-end, em um lugar so.
 *
 * Nenhuma tela monta URL na mao. Renomear uma rota no servidor passa a ser uma
 * linha aqui, e a lista abaixo serve de indice do que o front consegue fazer —
 * inclusive deixando obvio o que ele NAO consegue mais: nao ha "salvar estado
 * inteiro", que era como o painel antigo gravava tudo. */
import { http } from "./http.js";

export const apiPublica = {
  cardapio: () => http.get("/publico/cardapio"),
  mesa: numero => http.get(`/publico/mesas/${numero}`),
  criarPedido: (pedido, opcoes) => http.post("/publico/pedidos", pedido, opcoes),
  historicoPedidos: phone => http.get("/publico/pedidos/historico", { phone }),
  validarCupom: dados => http.post("/publico/cupons/validar", dados),
  statusEntrega: () => http.get("/publico/entrega/status"),
  buscarEndereco: (q, opcoes) => http.get("/publico/entrega/buscar", { q }, opcoes),
  cotarEntrega: params => http.get("/publico/entrega/cotar", params)
};

export const apiAuth = {
  eu: () => http.get("/auth/eu"),
  entrar: (usuario, senha) => http.post("/auth/login", { usuario, senha }),
  sair: () => http.post("/auth/logout"),
  trocarSenha: dados => http.post("/auth/senha", dados)
};

export const apiPedidos = {
  listar: filtros => http.get("/painel/pedidos", filtros),
  abertos: () => http.get("/painel/pedidos/abertos"),
  buscar: id => http.get(`/painel/pedidos/${id}`),
  criarManual: (pedido, opcoes) => http.post("/painel/pedidos", pedido, opcoes),
  mudarStatus: (id, status, dados = {}) => http.patch(`/painel/pedidos/${id}/status`, { status, ...dados }),
  cancelar: (id, motivo) => http.post(`/painel/pedidos/${id}/cancelar`, { motivo }),
  definirMotoboy: (id, motoboy) => http.patch(`/painel/pedidos/${id}/motoboy`, { motoboy }),
  marcarImpresso: id => http.post(`/painel/pedidos/${id}/impresso`)
};

export const apiMotoboys = {
  localizacoes: () => http.get("/painel/motoboys/localizacoes"),
  salvarLocalizacao: dados => http.post("/painel/motoboys/localizacao", dados)
};

export const apiProdutos = {
  listar: () => http.get("/painel/produtos"),
  emFalta: () => http.get("/painel/produtos/em-falta"),
  criar: produto => http.post("/painel/produtos", produto),
  atualizar: (id, produto) => http.put(`/painel/produtos/${id}`, produto),
  remover: id => http.delete(`/painel/produtos/${id}`),
  alternarAtivo: id => http.post(`/painel/produtos/${id}/alternar`),
  ajustarEstoque: (id, ajuste) => http.patch(`/painel/produtos/${id}/estoque`, ajuste),
  moverOrdem: (id, direction) => http.patch(`/painel/produtos/${id}/ordem`, { direction }),
  reordenar: ids => http.patch("/painel/produtos/ordem", { ids })
};

export const apiInsumos = {
  listar: () => http.get("/painel/insumos"),
  criar: insumo => http.post("/painel/insumos", insumo),
  atualizar: (id, insumo) => http.put(`/painel/insumos/${id}`, insumo),
  ajustarEstoque: (id, ajuste) => http.patch(`/painel/insumos/${id}/estoque`, ajuste),
  remover: id => http.delete(`/painel/insumos/${id}`)
};

export const apiPromocoes = {
  listar: () => http.get("/painel/promocoes"),
  salvar: promocao => http.post("/painel/promocoes", promocao),
  remover: id => http.delete(`/painel/promocoes/${id}`)
};

export const apiCupons = {
  listar: () => http.get("/painel/cupons"),
  criar: cupom => http.post("/painel/cupons", cupom),
  alternarAtivo: code => http.post(`/painel/cupons/${code}/alternar`),
  remover: code => http.delete(`/painel/cupons/${code}`)
};

export const apiMesas = {
  listar: () => http.get("/painel/mesas"),
  adicionar: () => http.post("/painel/mesas"),
  remover: n => http.delete(`/painel/mesas/${n}`),
  abrir: n => http.post(`/painel/mesas/${n}/abrir`),
  fecharConta: (n, cobrarServico = true) => http.post(`/painel/mesas/${n}/fechar`, { cobrarServico }),
  liberar: n => http.post(`/painel/mesas/${n}/liberar`)
};

export const apiCombos = {
  listar: () => http.get("/painel/combos"),
  criar: combo => http.post("/painel/combos", combo),
  atualizar: (id, combo) => http.put(`/painel/combos/${id}`, combo),
  remover: id => http.delete(`/painel/combos/${id}`),
  alternarAtivo: id => http.post(`/painel/combos/${id}/alternar`)
};

export const apiCombinacoesSabores = {
  listar: () => http.get("/painel/combinacoes-sabores"),
  salvar: combinacao => http.post("/painel/combinacoes-sabores", combinacao),
  remover: (produtoAId, produtoBId) =>
    http.delete(`/painel/combinacoes-sabores/${encodeURIComponent(produtoAId)}/${encodeURIComponent(produtoBId)}`)
};

export const apiEntrega = {
  config: () => http.get("/painel/entrega"),
  salvar: config => http.put("/painel/entrega", config),
  urlMapa: () => "/api/painel/entrega/mapa"
};

export const apiRelatorios = {
  dashboard: filtros => http.get("/painel/relatorios/dashboard", filtros),
  exportar: filtros => http.get("/painel/relatorios/exportar", filtros)
};

export const apiCaixa = {
  atual: () => http.get("/painel/caixa/atual"),
  abrir: senha => http.post("/painel/caixa/abrir", { senha }),
  fechar: observacao => http.post("/painel/caixa/fechar", { observacao }),
  fechamentos: filtros => http.get("/painel/caixa/fechamentos", filtros),
  relatorioUrl: id => `/api/painel/caixa/fechamentos/${encodeURIComponent(id)}/pdf`
};

export const apiUsuarios = {
  listar: () => http.get("/painel/usuarios"),
  criar: usuario => http.post("/painel/usuarios", usuario),
  atualizar: (id, dados) => http.patch(`/painel/usuarios/${id}`, dados),
  redefinirSenha: (id, senha) => http.post(`/painel/usuarios/${id}/senha`, { senha }),
  remover: id => http.delete(`/painel/usuarios/${id}`),
  auditoria: filtros => http.get("/painel/auditoria", filtros)
};

export const apiAjustes = {
  ler: () => http.get("/painel/ajustes"),
  gravar: ajustes => http.put("/painel/ajustes", ajustes)
};

export const apiTelao = {
  fila: () => http.get("/eventos/telao/fila")
};
