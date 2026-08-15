/* Estado do painel.
 *
 * Mudanca central em relacao ao sistema antigo: NAO ha localStorage aqui. O
 * painel lia e escrevia num banco local e, quando o servidor nao respondia,
 * caia nele em silencio e continuava funcionando — inclusive sem senha. Era o
 * furo mais grave do projeto: bastava derrubar a rede para o painel destravar.
 *
 * Agora, sem servidor, o painel simplesmente diz que esta sem conexao. Estes
 * dados sao cache de leitura em memoria: somem quando a aba fecha e nunca sao
 * usados para gravar coisa nenhuma. */
import {
  apiPedidos, apiProdutos, apiPromocoes, apiCupons,
  apiMesas, apiEntrega, apiAjustes, apiInsumos, apiCaixa,
  apiCombos, apiCombinacoesSabores
} from "../../services/api.js";

export const estado = {
  usuario: null,
  pedidos: [],
  resumo: { abertos: 0, porStatus: {} },
  produtos: [],
  insumos: [],
  promocoes: [],
  brindesPromocionais: [],
  cupons: [],
  combos: [],
  combinacoesSabores: [],
  mesas: [],
  caixaAtual: null,
  fechamentos: [],
  entrega: { endereco: "", lng: null, lat: null, zones: [] },
  ajustes: {},
  online: true
};

const ouvintes = new Set();
export const aoMudarEstado = callback => {
  ouvintes.add(callback);
  return () => ouvintes.delete(callback);
};
const avisar = assunto => ouvintes.forEach(callback => callback(assunto));

export function marcarConexao(online) {
  if (estado.online === online) return;
  estado.online = online;
  document.body.classList.toggle("sem-conexao", !online);
  avisar("conexao");
}

/* Cada carregador cuida da propria area. Dividir assim e o que permite o SSE
 * dizer "produtos mudaram" e sabermos recarregar so o cardapio, em vez de puxar
 * o sistema inteiro a cada aviso, como o sync antigo fazia. */
const carregadores = {
  async pedidos() {
    const { pedidos, resumo } = await apiPedidos.abertos();
    estado.pedidos = pedidos;
    estado.resumo = resumo;
  },
  async produtos() {
    estado.produtos = (await apiProdutos.listar()).produtos;
  },
  async insumos() {
    estado.insumos = (await apiInsumos.listar()).insumos;
  },
  async promocoes() {
    const dados = await apiPromocoes.listar();
    estado.promocoes = dados.promocoes || [];
    estado.brindesPromocionais = dados.brindes || [];
  },
  async cupons() {
    /* So admin ve cupons. Para caixa e cozinha a rota responde 403, e a lista
     * fica vazia sem quebrar a tela. */
    if (estado.usuario?.papel !== "admin") return;
    estado.cupons = (await apiCupons.listar()).cupons;
  },
  async mesas() {
    estado.mesas = (await apiMesas.listar()).mesas;
  },
  async combos() {
    estado.combos = (await apiCombos.listar()).combos;
  },
  async combinacoesSabores() {
    estado.combinacoesSabores = (await apiCombinacoesSabores.listar()).combinacoes;
  },
  async caixa() {
    estado.caixaAtual = (await apiCaixa.atual()).caixa;
  },
  async fechamentos() {
    estado.fechamentos = (await apiCaixa.fechamentos()).fechamentos;
  },
  async entrega() {
    if (estado.usuario?.papel === "cozinha") return;
    estado.entrega = (await apiEntrega.config()).entrega;
  },
  async ajustes() {
    estado.ajustes = (await apiAjustes.ler()).ajustes;
  }
};

export async function carregar(...areas) {
  const alvos = areas.length ? areas : Object.keys(carregadores);
  const resultados = await Promise.allSettled(alvos.map(area => carregadores[area]?.()));

  /* 403 numa area que o papel nao alcanca e esperado e nao vira erro de tela.
   * Falha de rede, sim: marca o painel como offline. */
  const perdeuRede = resultados.some(
    resultado => resultado.status === "rejected" && resultado.reason?.codigo === "offline"
  );
  marcarConexao(!perdeuRede);

  for (const area of alvos) avisar(area);
  return !perdeuRede;
}

/* Consultas derivadas, calculadas a partir do estado carregado. */
export const promocaoDoProduto = produtoId =>
  estado.promocoes.find(promocao => promocao.productId === produtoId) || null;

export const precoEfetivo = produto => {
  const promocao = promocaoDoProduto(produto.id);
  return promocao ? Number(promocao.price) : Number(produto.price || 0);
};

export const pedidosPorStatus = status => estado.pedidos.filter(pedido => pedido.status === status);
