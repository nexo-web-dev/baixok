/* Erro de dominio com status HTTP embutido.
 *
 * O server.js antigo devolvia todo erro como 400 com `error.message` cru no
 * corpo — inclusive erros internos, que vazavam caminho de arquivo e stack para
 * o navegador. Aqui so o que e ErroApp chega ao cliente; o resto vira 500
 * generico e fica no log. */
export class ErroApp extends Error {
  constructor(mensagem, status = 400, codigo = "erro_requisicao", detalhes = undefined) {
    super(mensagem);
    this.name = "ErroApp";
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
    this.esperado = true;
  }
}

export const erroValidacao = (mensagem, detalhes) => new ErroApp(mensagem, 422, "validacao", detalhes);
export const naoAutenticado = (mensagem = "Faca login para continuar.") => new ErroApp(mensagem, 401, "nao_autenticado");
/* 403, nao 401: aqui a sessao continua valida, so a reconfirmacao de senha
 * falhou. O front trata TODO 401 como sessao perdida e derruba pro login —
 * usar 401 aqui deslogaria quem so errou a senha ao tentar apagar um pedido
 * ou abrir o caixa. */
export const senhaIncorreta = (mensagem = "Senha incorreta.") => new ErroApp(mensagem, 403, "senha_incorreta");
export const semPermissao = (mensagem = "Seu perfil nao tem acesso a esta acao.") => new ErroApp(mensagem, 403, "sem_permissao");
export const naoEncontrado = (mensagem = "Recurso nao encontrado.") => new ErroApp(mensagem, 404, "nao_encontrado");
export const conflito = mensagem => new ErroApp(mensagem, 409, "conflito");
export const excedeuLimite = mensagem => new ErroApp(mensagem, 429, "limite_excedido");
export const indisponivel = mensagem => new ErroApp(mensagem, 502, "servico_externo");
