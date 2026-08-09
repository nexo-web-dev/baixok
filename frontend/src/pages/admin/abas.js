/* Definicao das abas do painel.
 *
 * `abasVer` e `abasEditar` permitem ajustar o que cada usuario enxerga sem
 * depender apenas do papel. O backend continua validando tudo na API; aqui a
 * regra serve para esconder o que nao deve aparecer e evitar clique indevido.
 */

const PAPEL_PADRAO_VER = Object.freeze({
  admin: ["pedidos", "motoboy", "mesas", "produtos", "promos", "entrega", "estoque", "dashboard", "fechamentos", "plano", "usuarios"],
  caixa: ["pedidos", "motoboy", "mesas", "estoque", "dashboard", "fechamentos"],
  cozinha: ["pedidos"],
  entregador: ["pedidos", "motoboy"]
});

const PAPEL_PADRAO_EDITAR = Object.freeze({
  admin: ["pedidos", "motoboy", "mesas", "produtos", "promos", "entrega", "estoque", "dashboard", "fechamentos", "plano", "usuarios"],
  caixa: ["pedidos", "motoboy", "mesas", "estoque", "dashboard", "fechamentos"],
  cozinha: [],
  entregador: ["pedidos", "motoboy"]
});

export const ABAS = Object.freeze({
  pedidos: {
    titulo: "Fila de pedidos",
    subtitulo: "Tudo que entra pelo cardapio, WhatsApp ou lancamento manual.",
    icone: "☰",
    rotulo: "Pedidos",
    papeis: ["admin", "caixa", "cozinha", "entregador"]
  },
  motoboy: {
    titulo: "Motoboy",
    subtitulo: "Entregas prontas e entregues, com responsavel pela rota.",
    icone: "MB",
    rotulo: "Motoboy",
    papeis: ["admin", "caixa", "entregador"]
  },
  mesas: {
    titulo: "Mesas do salao",
    subtitulo: "Comanda por mesa com QR code, parcial e fechamento de conta.",
    icone: "▪",
    rotulo: "Mesas (salao)",
    papeis: ["admin", "caixa"]
  },
  produtos: {
    titulo: "Produtos",
    subtitulo: "Cardapio que o cliente ve. Pausar tira do ar sem apagar o cadastro.",
    icone: "◱",
    rotulo: "Produtos",
    papeis: ["admin"]
  },
  promos: {
    titulo: "Promocoes e cupons",
    subtitulo: "Preco promocional e cupons de desconto.",
    icone: "✦",
    rotulo: "Promocoes",
    papeis: ["admin"]
  },
  entrega: {
    titulo: "Area de entrega",
    subtitulo: "Ponto da loja e faixas de raio com taxa e pedido minimo.",
    icone: "◈",
    rotulo: "Area de entrega",
    papeis: ["admin"]
  },
  estoque: {
    titulo: "Estoque",
    subtitulo: "Contador por produto. Item zerado sai do cardapio sozinho.",
    icone: "▤",
    rotulo: "Estoque",
    papeis: ["admin", "caixa"]
  },
  dashboard: {
    titulo: "Dashboard",
    subtitulo: "Faturamento, movimento por hora e mais vendidos.",
    icone: "◔",
    rotulo: "Dashboard",
    papeis: ["admin", "caixa"]
  },
  fechamentos: {
    titulo: "Fechamentos de caixa",
    subtitulo: "Historico de aberturas, fechamentos e relatorios para imprimir ou salvar em PDF.",
    icone: "FC",
    rotulo: "Fechamentos",
    papeis: ["admin", "caixa"]
  },
  plano: {
    titulo: "Plano do sistema",
    subtitulo: "Valor da mensalidade, vencimento e dias restantes.",
    icone: "PL",
    rotulo: "Plano do sistema",
    papeis: ["admin"]
  },
  usuarios: {
    titulo: "Usuarios e auditoria",
    subtitulo: "Quem tem acesso, o que pode ver/editar, e o registro do que foi feito.",
    icone: "◍",
    rotulo: "Usuarios",
    papeis: ["admin"]
  }
});

export const abasDoPapel = papel =>
  Object.entries(ABAS).filter(([, aba]) => aba.papeis.includes(papel));

function listaPermitida(usuario, tipo) {
  const chave = tipo === "editar" ? "abasEditar" : "abasVer";
  const lista = usuario?.[chave];
  const padrao = tipo === "editar"
    ? PAPEL_PADRAO_EDITAR[usuario?.papel] || []
    : PAPEL_PADRAO_VER[usuario?.papel] || [];
  if (usuario?.papel === "admin") return Object.keys(ABAS);
  if (!Array.isArray(lista) || !lista.length) return padrao;
  if (["caixa", "entregador"].includes(usuario?.papel)) return [...new Set([...lista, ...padrao])];
  return lista;
}

export function abaInicial(usuario) {
  const permitidas = listaPermitida(usuario, "ver");
  if (usuario?.papel === "admin" && permitidas.includes("produtos")) return "produtos";
  return permitidas[0] || "pedidos";
}

export function podeVer(aba, usuario) {
  return listaPermitida(usuario, "ver").includes(aba);
}

export function podeEditar(aba, usuario) {
  return listaPermitida(usuario, "editar").includes(aba);
}
