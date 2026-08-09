/* Autenticacao e autorizacao por papel.
 *
 * Toda rota do painel declara explicitamente quem pode chamar. O sistema antigo
 * tinha um unico portao (`if (!balcao) return 401`) e, passado ele, quem estava
 * na cozinha podia apagar o cardapio inteiro pela mesma API. */
import { env } from "../config/env.js";
import { authService } from "../services/auth.service.js";
import { naoAutenticado, semPermissao } from "../lib/errors.js";

const ABAS_PADRAO_VER = Object.freeze({
  admin: ["pedidos", "motoboy", "mesas", "produtos", "promos", "entrega", "estoque", "dashboard", "fechamentos", "plano", "usuarios"],
  caixa: ["pedidos", "motoboy", "mesas", "estoque", "dashboard", "fechamentos"],
  cozinha: ["pedidos"],
  entregador: ["pedidos"]
});

const ABAS_PADRAO_EDITAR = Object.freeze({
  admin: ["pedidos", "motoboy", "mesas", "produtos", "promos", "entrega", "estoque", "dashboard", "fechamentos", "plano", "usuarios"],
  caixa: ["pedidos", "motoboy", "mesas", "estoque"],
  cozinha: [],
  entregador: ["pedidos"]
});

function listaAbas(usuario, modo = "ver") {
  const chave = modo === "editar" ? "abasEditar" : "abasVer";
  const abas = usuario?.[chave];
  if (Array.isArray(abas) && abas.length) return abas;
  return modo === "editar"
    ? ABAS_PADRAO_EDITAR[usuario?.papel] || []
    : ABAS_PADRAO_VER[usuario?.papel] || [];
}

/* Popula req.sessao quando ha cookie valido, e segue adiante de qualquer jeito.
 * Roda em tudo, inclusive nas rotas publicas.
 *
 * Sem cookie o resolverSessao devolve null antes de tocar o banco. Isso importa
 * agora: com o Postgres cada consulta e uma ida a rede, e o visitante do
 * cardapio — que e a maioria — nao paga nada por este middleware. */
export async function carregarSessao(req, _res, next) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  req.sessao = await authService.resolverSessao(token);
  req.usuario = req.sessao?.usuario || null;
  req.tokenSessao = token || null;
  next();
}

export function exigirLogin(req, _res, next) {
  if (!req.usuario) return next(naoAutenticado());
  next();
}

/* exigirPapel("admin") ou exigirPapel("admin", "caixa").
 *
 * Sem hierarquia implicita de proposito: "cozinha" nao e um "caixa com menos
 * poder", e um perfil diferente. Cada rota lista quem aceita, e a lista fica
 * legivel no proprio arquivo de rotas. */
export function exigirPapel(...papeisAceitos) {
  return (req, _res, next) => {
    if (!req.usuario) return next(naoAutenticado());
    if (!papeisAceitos.includes(req.usuario.papel)) {
      return next(semPermissao(`Esta acao e restrita a: ${papeisAceitos.join(", ")}.`));
    }
    next();
  };
}

export function exigirAba(aba, modo = "ver") {
  return (req, _res, next) => {
    if (!req.usuario) return next(naoAutenticado());
    if (listaAbas(req.usuario, modo).includes(aba)) return next();
    const verbo = modo === "editar" ? "editar" : "ver";
    return next(semPermissao(`Esta acao e restrita a quem pode ${verbo} a aba ${aba}.`));
  };
}
