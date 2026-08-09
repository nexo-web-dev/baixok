/* Autenticacao: login, sessao e troca de senha.
 *
 * O sistema antigo guardava uma senha unica da loja em texto puro e liberava
 * tudo para quem entrasse. Agora a autenticacao pode vir do Supabase Auth,
 * enquanto o banco local continua guardando o perfil, as permissoes e as
 * sessoes do painel. */
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { usuariosRepo } from "../repositories/usuarios.repo.js";
import { sessoesRepo } from "../repositories/sessoes.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { gerarHashSenha, conferirSenha, gastarTempoDeHash } from "../lib/password.js";
import { ErroApp, naoAutenticado, conflito } from "../lib/errors.js";
import { PAPEIS } from "../config/constants.js";
import { logger } from "../lib/logger.js";
import { supabaseAuth } from "./supabase-auth.js";

const ABAS_POR_PADRAO = {
  [PAPEIS.ADMIN]: ["pedidos", "motoboy", "mesas", "produtos", "promos", "entrega", "estoque", "dashboard", "fechamentos", "plano", "usuarios"],
  [PAPEIS.CAIXA]: ["pedidos", "motoboy", "mesas", "estoque", "dashboard", "fechamentos"],
  [PAPEIS.COZINHA]: ["pedidos"],
  [PAPEIS.ENTREGADOR]: ["pedidos", "motoboy"]
};

const EDITAVEIS_POR_PADRAO = {
  [PAPEIS.ADMIN]: ["pedidos", "motoboy", "mesas", "produtos", "promos", "entrega", "estoque", "dashboard", "fechamentos", "plano", "usuarios"],
  [PAPEIS.CAIXA]: ["pedidos", "motoboy", "mesas", "estoque"],
  [PAPEIS.COZINHA]: [],
  [PAPEIS.ENTREGADOR]: ["pedidos", "motoboy"]
};

function normalizarEmail(email) {
  const login = String(email || "").trim().toLowerCase();
  if (login === "admin") return "baixok@food.com";
  return login;
}

const paraLista = valor => {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor.filter(Boolean);
  if (typeof valor === "string") {
    try {
      const parsed = JSON.parse(valor);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
};

function abasDoUsuario(papel, valor, modo = "ver") {
  const salvas = paraLista(valor);
  const padrao = modo === "editar"
    ? EDITAVEIS_POR_PADRAO[papel] || []
    : ABAS_POR_PADRAO[papel] || [];

  if (papel === PAPEIS.ADMIN) return padrao;
  if (!salvas.length) return padrao;
  if ([PAPEIS.CAIXA, PAPEIS.ENTREGADOR].includes(papel)) return [...new Set([...salvas, ...padrao])];
  return salvas;
}

const paraUsuarioPublico = linha => ({
  id: linha.id,
  usuario: linha.usuario,
  nome: linha.nome,
  papel: linha.papel,
  abasVer: abasDoUsuario(linha.papel, linha.abas_ver, "ver"),
  abasEditar: abasDoUsuario(linha.papel, linha.abas_editar, "editar")
});

function nomePadraoPorEmail(email) {
  const login = normalizarEmail(email);
  if (login === "baixok@food.com") return "Admin Baixo K";
  if (login === "balcao@baixok.com") return "Balcao Baixo K";
  const parte = login.split("@")[0] || "usuario";
  return parte.charAt(0).toUpperCase() + parte.slice(1);
}

function papelPadraoPorEmail(email, sugerido) {
  if ([PAPEIS.ADMIN, PAPEIS.CAIXA, PAPEIS.COZINHA, PAPEIS.ENTREGADOR].includes(sugerido)) {
    return sugerido;
  }
  const login = normalizarEmail(email);
  if (login === "baixok@food.com") return PAPEIS.ADMIN;
  if (login === "balcao@baixok.com") return PAPEIS.CAIXA;
  return PAPEIS.CAIXA;
}

async function buscarUsuarioParaLogin(usuario) {
  const login = normalizarEmail(usuario);
  return usuariosRepo.buscarPorUsuarioComHash(login);
}

async function garantirUsuarioLocalDoSupabase(authUser, senha) {
  const email = normalizarEmail(authUser?.email);
  if (!email || !authUser?.id) return null;

  const metadados = authUser.user_metadata || {};
  const papel = papelPadraoPorEmail(email, metadados.papel || authUser.app_metadata?.papel);
  const abasVer = paraLista(metadados.abasVer).length ? paraLista(metadados.abasVer) : ABAS_POR_PADRAO[papel];
  const abasEditar = paraLista(metadados.abasEditar).length ? paraLista(metadados.abasEditar) : EDITAVEIS_POR_PADRAO[papel];

  const local = (await usuariosRepo.buscarPorAuthId(authUser.id)) || (await usuariosRepo.buscarPorUsuario(email));
  if (local) {
    await usuariosRepo.atualizarAuthId(local.id, authUser.id);
    return usuariosRepo.buscar(local.id);
  }

  const senhaHash = await gerarHashSenha(senha);
  return usuariosRepo.criar({
    usuario: email,
    nome: metadados.nome || nomePadraoPorEmail(email),
    senhaHash,
    papel,
    abasVer,
    abasEditar,
    authId: authUser.id
  });
}

/* Trava por conta, alem do limite por IP que o middleware ja aplica.
 * Sozinho, o limite por IP nao protege: uma botnet distribui as tentativas e
 * cada IP fica abaixo do teto. Travar a conta fecha esse caminho. */
const falhas = new Map();
const MAX_FALHAS = 8;
const JANELA_TRAVA_MS = 15 * 60 * 1000;

function registrarFalha(usuario) {
  const chave = String(usuario).toLowerCase();
  const agora = Date.now();
  const atual = falhas.get(chave);
  if (!atual || agora > atual.ate) {
    falhas.set(chave, { contagem: 1, ate: agora + JANELA_TRAVA_MS });
    return;
  }
  atual.contagem += 1;
}

function contaTravada(usuario) {
  const atual = falhas.get(String(usuario).toLowerCase());
  if (!atual || Date.now() > atual.ate) return false;
  return atual.contagem >= MAX_FALHAS;
}

const limparFalhas = usuario => falhas.delete(String(usuario).toLowerCase());

export function limparFalhasVencidas() {
  const agora = Date.now();
  for (const [chave, registro] of falhas) {
    if (agora > registro.ate) falhas.delete(chave);
  }
}

export const authService = {
  async login({ usuario, senha, ip, agente }) {
    if (contaTravada(usuario)) {
      throw new ErroApp("Conta bloqueada por tentativas seguidas. Espere 15 minutos.", 429, "conta_travada");
    }

    const login = normalizarEmail(usuario);

    if (supabaseAuth.ativo()) {
      try {
        const authUser = await supabaseAuth.autenticarComSenha(login, senha);
        const encontrado = await garantirUsuarioLocalDoSupabase(authUser, senha);

        if (!encontrado || !encontrado.ativo) {
          await gastarTempoDeHash();
          registrarFalha(usuario);
          logger.warn("Login recusado", { usuario, motivo: encontrado ? "inativo" : "inexistente", ip });
          throw new ErroApp("Usuario ou senha invalidos.", 401, "credenciais_invalidas");
        }

        limparFalhas(usuario);

        const token = randomBytes(32).toString("base64url");
        const csrfToken = randomBytes(32).toString("base64url");
        const expiraEm = new Date(Date.now() + env.SESSION_TTL_MS).toISOString().replace("T", " ").slice(0, 19);

        await sessoesRepo.criar({ token, csrfToken, usuarioId: encontrado.id, expiraEm, ip, agente });
        await usuariosRepo.registrarLogin(encontrado.id);
        await auditoriaRepo.registrar({
          usuarioId: encontrado.id, usuario: encontrado.usuario, acao: "login", entidade: "sessao", ip
        });

        return {
          token,
          csrfToken,
          usuario: paraUsuarioPublico(encontrado)
        };
      } catch (erro) {
        if (erro instanceof ErroApp && erro.status === 401) {
          registrarFalha(usuario);
          logger.warn("Login recusado", { usuario, motivo: "senha", ip });
          throw erro;
        }
        throw erro;
      }
    }

    const encontrado = await buscarUsuarioParaLogin(login);

    /* Mesmo sem usuario gastamos o tempo do hash. Sem isso, "login inexistente"
     * responde na hora e "senha errada" demora ~100ms - a diferenca entrega
     * quais logins existem na loja. */
    if (!encontrado || encontrado.ativo !== 1) {
      await gastarTempoDeHash();
      registrarFalha(usuario);
      logger.warn("Login recusado", { usuario, motivo: encontrado ? "inativo" : "inexistente", ip });
      throw new ErroApp("Usuario ou senha invalidos.", 401, "credenciais_invalidas");
    }

    if (!(await conferirSenha(senha, encontrado.senha_hash))) {
      registrarFalha(usuario);
      logger.warn("Login recusado", { usuario, motivo: "senha", ip });
      throw new ErroApp("Usuario ou senha invalidos.", 401, "credenciais_invalidas");
    }

    limparFalhas(usuario);

    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const expiraEm = new Date(Date.now() + env.SESSION_TTL_MS).toISOString().replace("T", " ").slice(0, 19);

    await sessoesRepo.criar({ token, csrfToken, usuarioId: encontrado.id, expiraEm, ip, agente });
    await usuariosRepo.registrarLogin(encontrado.id);
    await auditoriaRepo.registrar({
      usuarioId: encontrado.id, usuario: encontrado.usuario, acao: "login", entidade: "sessao", ip
    });

    return {
      token,
      csrfToken,
      usuario: paraUsuarioPublico(encontrado)
    };
  },

  async logout({ token, usuarioAtual, ip }) {
    if (!token) return;
    await sessoesRepo.remover(token);
    if (usuarioAtual) {
      await auditoriaRepo.registrar({
        usuarioId: usuarioAtual.id, usuario: usuarioAtual.usuario, acao: "logout", entidade: "sessao", ip
      });
    }
  },

  /* Resolve a sessao do cookie. Devolve null em vez de lancar: quem decide se a
   * rota exige login e o middleware, nao esta funcao - o cardapio publico
   * tambem chama isto so para saber se deve mostrar o link do painel. */
  async resolverSessao(token) {
    if (!token) return null;
    const sessao = await sessoesRepo.buscarValida(token);
    if (!sessao) return null;
    return {
      usuario: {
        id: sessao.usuario_id,
        usuario: sessao.usuario,
        nome: sessao.nome,
        papel: sessao.papel,
        abasVer: abasDoUsuario(sessao.papel, sessao.abas_ver, "ver"),
        abasEditar: abasDoUsuario(sessao.papel, sessao.abas_editar, "editar")
      },
      csrfHash: sessao.csrf_hash,
      expiraEm: sessao.expira_em
    };
  },

  async trocarPropriaSenha({ usuarioAtual, senhaAtual, senhaNova, token, ip }) {
    const login = normalizarEmail(usuarioAtual.usuario);
    const encontrado = await usuariosRepo.buscarPorUsuarioComHash(login);
    if (!encontrado) {
      throw naoAutenticado("Senha atual incorreta.");
    }
    if (await conferirSenha(senhaNova, encontrado.senha_hash)) {
      throw conflito("A senha nova precisa ser diferente da atual.");
    }

    if (supabaseAuth.ativo()) {
      const authUser = await supabaseAuth.autenticarComSenha(login, senhaAtual);
      const local = (await usuariosRepo.buscarPorAuthId(authUser.id)) || (await usuariosRepo.buscarPorUsuario(login));
      /* buscarPorAuthId e buscarPorUsuario passam pelo paraApi, que converte
       * `ativo` para booleano. O `!== 1` de antes comparava com o INTEGER cru do
       * SQLite e recusaria todo mundo aqui. */
      if (!local || !local.ativo) {
        throw naoAutenticado("Senha atual incorreta.");
      }
      await usuariosRepo.atualizarAuthId(local.id, authUser.id);
      await supabaseAuth.atualizarSenha(authUser.id, senhaNova);
    } else if (!(await conferirSenha(senhaAtual, encontrado.senha_hash))) {
      throw naoAutenticado("Senha atual incorreta.");
    }

    await usuariosRepo.trocarSenha(encontrado.id, await gerarHashSenha(senhaNova));

    /* Derruba as outras sessoes da pessoa e mantem a atual. Trocar senha porque
     * "acho que alguem viu" so serve se expulsar quem estava dentro. */
    await sessoesRepo.removerDoUsuario(encontrado.id);
    const csrfToken = randomBytes(32).toString("base64url");
    const novoToken = token || randomBytes(32).toString("base64url");
    const expiraEm = new Date(Date.now() + env.SESSION_TTL_MS).toISOString().replace("T", " ").slice(0, 19);
    await sessoesRepo.criar({ token: novoToken, csrfToken, usuarioId: encontrado.id, expiraEm, ip, agente: "" });

    await auditoriaRepo.registrar({
      usuarioId: encontrado.id, usuario: encontrado.usuario, acao: "senha_trocada", entidade: "usuario",
      entidadeId: encontrado.id, ip
    });

    return { token: novoToken, csrfToken };
  }
};
