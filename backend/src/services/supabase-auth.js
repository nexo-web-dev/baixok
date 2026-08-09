import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { ErroApp } from "../lib/errors.js";

let cliente = null;

function ativo() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && !env.ehTeste);
}

function obterCliente() {
  if (!ativo()) return null;
  if (env.SUPABASE_INSECURE_TLS) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  if (!cliente) {
    cliente = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    });
  }
  return cliente;
}

function erroAutenticacao(mensagem = "Usuário ou senha inválidos.") {
  return new ErroApp(mensagem, 401, "credenciais_invalidas");
}

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function listarUsuarioPorEmail(client, email) {
  const alvo = normalizarEmail(email);
  if (!alvo) return null;

  let pagina = 1;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) throw new ErroApp(error.message || "Falha ao consultar Supabase Auth.", 502, "supabase_auth");
    const encontrado = data.users.find(usuario => normalizarEmail(usuario.email) === alvo);
    if (encontrado) return encontrado;
    if (!data.users.length || data.users.length < 1000) return null;
    pagina += 1;
  }
}

export const supabaseAuth = {
  ativo,

  async autenticarComSenha(email, senha) {
    const client = obterCliente();
    if (!client) return null;

    const { data, error } = await client.auth.signInWithPassword({
      email: normalizarEmail(email),
      password: senha
    });

    if (error || !data?.user) throw erroAutenticacao();
    return data.user;
  },

  async buscarUsuarioPorEmail(email) {
    const client = obterCliente();
    if (!client) return null;
    return listarUsuarioPorEmail(client, email);
  },

  async criarUsuario({ email, senha, nome, papel, abasVer = [], abasEditar = [] }) {
    const client = obterCliente();
    if (!client) return null;

    const { data, error } = await client.auth.admin.createUser({
      email: normalizarEmail(email),
      password: senha,
      email_confirm: true,
      user_metadata: {
        nome,
        papel,
        abasVer,
        abasEditar
      },
      app_metadata: {
        papel
      }
    });

    if (error || !data?.user) {
      throw new ErroApp(error?.message || "Falha ao criar usuario no Supabase.", 502, "supabase_auth");
    }
    return data.user;
  },

  async atualizarUsuarioPorId(authId, dados) {
    const client = obterCliente();
    if (!client || !authId) return null;

    const { data, error } = await client.auth.admin.updateUserById(authId, dados);
    if (error || !data?.user) {
      throw new ErroApp(error?.message || "Falha ao atualizar usuario no Supabase.", 502, "supabase_auth");
    }
    return data.user;
  },

  async atualizarSenha(authId, senha) {
    return this.atualizarUsuarioPorId(authId, { password: senha });
  },

  async removerUsuario(authId) {
    const client = obterCliente();
    if (!client || !authId) return null;

    const { error } = await client.auth.admin.deleteUser(authId);
    if (error) {
      throw new ErroApp(error.message || "Falha ao remover usuario no Supabase.", 502, "supabase_auth");
    }
    return true;
  },

  async sincronizarMetadados(authId, metadados = {}) {
    if (!authId) return null;
    return this.atualizarUsuarioPorId(authId, {
      user_metadata: metadados,
      app_metadata: { papel: metadados.papel }
    });
  }
};
