/* Gestao de usuarios. Restrito ao papel admin nas rotas. */
import { usuariosRepo } from "../repositories/usuarios.repo.js";
import { sessoesRepo } from "../repositories/sessoes.repo.js";
import { auditoriaRepo } from "../repositories/auditoria.repo.js";
import { gerarHashSenha } from "../lib/password.js";
import { naoEncontrado, conflito, ErroApp } from "../lib/errors.js";
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

function normalizarLista(valor, fallback = []) {
  if (Array.isArray(valor)) return [...new Set(valor.map(item => String(item).trim()).filter(Boolean))];
  return [...fallback];
}

async function resolverAuthId(usuario) {
  if (!supabaseAuth.ativo()) return null;
  if (usuario?.authId) return usuario.authId;
  const auth = await supabaseAuth.buscarUsuarioPorEmail(usuario?.usuario);
  return auth?.id || null;
}

/* Guarda contra o sistema ficar sem ninguem capaz de administrar: rebaixar ou
 * desativar o ultimo admin ativo deixaria a loja sem quem cadastre usuario,
 * mexa em cupom ou configure entrega.
 *
 * O `await` no contarAdminsAtivos nao e detalhe: com o repositorio assincrono e
 * a chamada sem await, a comparacao era `Promise <= 1`, que da NaN <= 1, que e
 * sempre falso. A trava existia no codigo e nunca disparava. */
async function garantirQueSobraAdmin(alvo, mudanca) {
  const perdendoAdmin =
    alvo.papel === PAPEIS.ADMIN &&
    alvo.ativo &&
    ((mudanca.papel && mudanca.papel !== PAPEIS.ADMIN) || mudanca.ativo === false);

  if (perdendoAdmin && (await usuariosRepo.contarAdminsAtivos()) <= 1) {
    throw conflito("Este e o unico administrador ativo. Promova outra pessoa antes.");
  }
}

export const usuariosService = {
  listar: () => usuariosRepo.listar(),

  async buscar(id) {
    const usuario = await usuariosRepo.buscar(id);
    if (!usuario) throw naoEncontrado("Usuario nao encontrado.");
    return usuario;
  },

  async criar(dados, { usuario: autor, ip }) {
    if (supabaseAuth.ativo() && !dados.usuario.includes("@")) {
      throw new ErroApp("Informe um e-mail valido para criar o acesso.", 400, "email_invalido");
    }
    if (await usuariosRepo.buscarPorUsuario(dados.usuario)) {
      throw conflito("Ja existe alguem com esse nome de usuario.");
    }
    if (supabaseAuth.ativo()) {
      const authExistente = await supabaseAuth.buscarUsuarioPorEmail(dados.usuario);
      if (authExistente) throw conflito("Ja existe alguem com esse nome de usuario.");
    }
    const abasVer = normalizarLista(dados.abasVer, ABAS_POR_PADRAO[dados.papel] || ["pedidos"]);
    const abasEditar = normalizarLista(dados.abasEditar, EDITAVEIS_POR_PADRAO[dados.papel] || []);
    const senhaHash = await gerarHashSenha(dados.senha);
    let authId = null;

    if (supabaseAuth.ativo()) {
      const authUser = await supabaseAuth.criarUsuario({
        email: dados.usuario,
        senha: dados.senha,
        nome: dados.nome,
        papel: dados.papel,
        abasVer,
        abasEditar
      });
      authId = authUser.id;
    }

    let criado;
    try {
      criado = await usuariosRepo.criar({
        usuario: dados.usuario,
        nome: dados.nome,
        senhaHash,
        papel: dados.papel,
        abasVer,
        abasEditar,
        authId
      });
    } catch (erro) {
      if (authId && supabaseAuth.ativo()) {
        try {
          await supabaseAuth.removerUsuario(authId);
        } catch (limpezaErro) {
          logger.warn("Falha ao desfazer usuario no Supabase apos erro local", {
            authId,
            erro: limpezaErro.message
          });
        }
      }
      throw erro;
    }
    await auditoriaRepo.registrar({
      usuarioId: autor.id, usuario: autor.usuario, acao: "usuario_criado",
      entidade: "usuario", entidadeId: criado.id, detalhes: { usuario: criado.usuario, papel: criado.papel }, ip
    });
    return criado;
  },

  async atualizar(id, dados, { usuario: autor, ip }) {
    const alvo = await this.buscar(id);
    await garantirQueSobraAdmin(alvo, dados);

    /* Ninguem muda o proprio papel: um caixa que conseguisse chamar esta rota se
     * promoveria a admin sozinho. Trocar de papel exige outra pessoa admin. */
    if (alvo.id === autor.id && dados.papel && dados.papel !== alvo.papel) {
      throw new ErroApp("Voce nao pode alterar o proprio papel.", 403, "auto_promocao");
    }

    const abasVer = dados.abasVer === undefined ? undefined : normalizarLista(dados.abasVer, []);
    const abasEditar = dados.abasEditar === undefined ? undefined : normalizarLista(dados.abasEditar, []);
    const atualizado = await usuariosRepo.atualizar(id, { ...dados, abasVer, abasEditar });

    if (supabaseAuth.ativo()) {
      const authId = await resolverAuthId(atualizado);
      if (authId) {
        try {
          await supabaseAuth.sincronizarMetadados(authId, {
            nome: atualizado.nome,
            papel: atualizado.papel,
            abasVer: atualizado.abasVer,
            abasEditar: atualizado.abasEditar
          });
        } catch (erro) {
          logger.warn("Nao foi possivel sincronizar metadados do usuario no Supabase", {
            authId,
            usuarioId: atualizado.id,
            erro: erro.message
          });
        }
      }
    }

    /* Desativar derruba as sessoes na hora, sem esperar os 30 dias. */
    if (dados.ativo === false) await sessoesRepo.removerDoUsuario(id);

    await auditoriaRepo.registrar({
      usuarioId: autor.id, usuario: autor.usuario, acao: "usuario_alterado",
      entidade: "usuario", entidadeId: id, detalhes: dados, ip
    });
    return atualizado;
  },

  async redefinirSenha(id, senha, { usuario: autor, ip }) {
    const alvo = await this.buscar(id);
    if (supabaseAuth.ativo()) {
      const authId = await resolverAuthId(alvo);
      if (authId) {
        await supabaseAuth.atualizarSenha(authId, senha);
      }
    }
    await usuariosRepo.trocarSenha(id, await gerarHashSenha(senha));
    const derrubadas = await sessoesRepo.removerDoUsuario(id);

    await auditoriaRepo.registrar({
      usuarioId: autor.id, usuario: autor.usuario, acao: "senha_redefinida",
      entidade: "usuario", entidadeId: id, detalhes: { alvo: alvo.usuario, sessoesEncerradas: derrubadas }, ip
    });
  },

  async remover(id, { usuario: autor, ip }) {
    const alvo = await this.buscar(id);
    if (alvo.id === autor.id) throw conflito("Voce nao pode remover o proprio usuario.");
    await garantirQueSobraAdmin(alvo, { ativo: false });

    await sessoesRepo.removerDoUsuario(id);
    if (supabaseAuth.ativo()) {
      const authId = await resolverAuthId(alvo);
      if (authId) await supabaseAuth.removerUsuario(authId);
    }
    await usuariosRepo.remover(id);
    await auditoriaRepo.registrar({
      usuarioId: autor.id, usuario: autor.usuario, acao: "usuario_removido",
      entidade: "usuario", entidadeId: id, detalhes: { usuario: alvo.usuario }, ip
    });
  },

  auditoria: filtros => auditoriaRepo.listar(filtros)
};
