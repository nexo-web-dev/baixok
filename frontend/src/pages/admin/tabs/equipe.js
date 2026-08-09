/* Usuarios e auditoria. O backend cria a credencial no Supabase Auth (quando
 * configurado) e o perfil local numa unica operacao. */
import { el, render, $, delegar } from "../../../utils/dom.js";
import { dataHora, reais } from "../../../utils/formato.js";
import { PAPEIS_ROTULO } from "../../../utils/categorias.js";
import { apiUsuarios } from "../../../services/api.js";
import { estado } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";
import { ABAS } from "../abas.js";

let usuarios = [];
let usuarioEmEdicao = null;

const DESCRICAO_ACAO = {
  login: "entrou no sistema",
  logout: "saiu do sistema",
  pedido_criado: "pedido pelo cardápio",
  pedido_lancado: "lançou pedido manual",
  pedido_status: "mudou status do pedido",
  pedido_cancelado: "cancelou pedido",
  pedido_motoboy: "informou motoboy",
  produto_criado: "criou produto",
  produto_alterado: "alterou produto",
  produto_removido: "excluiu produto",
  produto_pausado: "pausou produto",
  produto_ativado: "reativou produto",
  produto_ordem: "alterou ordem do cardápio",
  estoque_ajustado: "ajustou estoque",
  insumo_criado: "criou insumo",
  insumo_alterado: "alterou insumo",
  insumo_estoque: "ajustou insumo",
  insumo_removido: "removeu insumo",
  promocao_salva: "criou promoção",
  promocao_encerrada: "encerrou promoção",
  cupom_criado: "criou cupom",
  cupom_ativado: "ativou cupom",
  cupom_desativado: "desativou cupom",
  cupom_removido: "excluiu cupom",
  mesa_aberta: "abriu mesa",
  mesa_conta_fechada: "fechou conta da mesa",
  mesa_liberada: "liberou mesa",
  entrega_configurada: "configurou área de entrega",
  usuario_criado: "cadastrou usuário",
  usuario_alterado: "alterou usuário",
  usuario_removido: "removeu usuário",
  senha_trocada: "trocou a própria senha",
  senha_redefinida: "redefiniu senha de outro usuário"
};

const ROTULOS_ABAS = Object.fromEntries(
  Object.entries(ABAS).map(([chave, aba]) => [chave, aba.rotulo || aba.titulo || chave])
);

const PADRAO_PERMISSOES = {
  admin: { ver: Object.keys(ABAS), editar: Object.keys(ABAS) },
  caixa: { ver: ["pedidos", "motoboy", "mesas", "estoque", "dashboard", "fechamentos"], editar: ["pedidos", "motoboy", "mesas", "estoque"] },
  cozinha: { ver: ["pedidos"], editar: ["pedidos"] },
  entregador: { ver: ["pedidos", "motoboy"], editar: ["pedidos", "motoboy"] }
};

function permissaoPadrao(papel) {
  return PADRAO_PERMISSOES[papel] || PADRAO_PERMISSOES.caixa;
}

function normalizarLista(lista) {
  return Array.from(new Set((lista || []).filter(Boolean)));
}

function montarPermissoesSelecionadas() {
  const checkboxes = Array.from(document.querySelectorAll("[data-permissao]"));
  return {
    abasVer: checkboxes.filter(caixa => caixa.dataset.permissao === "ver" && caixa.checked).map(caixa => caixa.dataset.aba),
    abasEditar: checkboxes.filter(caixa => caixa.dataset.permissao === "editar" && caixa.checked).map(caixa => caixa.dataset.aba)
  };
}

function aplicarPermissoesNaTela(permissoes) {
  const abasVer = new Set(permissoes.abasVer || []);
  const abasEditar = new Set(permissoes.abasEditar || []);
  const alvo = $("#user-permissions");

  if (!alvo) return;

  render(alvo,
    el("div.permission-head", {},
      el("strong", {}, "Permissões por aba"),
      el("span.small.faint", {}, "Marque o que a pessoa pode ver e o que pode editar")
    ),
    ...Object.entries(ABAS).map(([chave, aba]) =>
      el("label.permission-row", {},
        el("span.permission-name", {},
          el("strong", {}, aba.rotulo || aba.titulo || chave),
          el("span.small.faint", {}, chave)
        ),
        el("span.permission-group", {},
          el("label.permission-chip", {},
            el("input", {
              type: "checkbox",
              checked: abasVer.has(chave),
              dataset: { permissao: "ver", aba: chave }
            }),
            "Ver"
          ),
          el("label.permission-chip", {},
            el("input", {
              type: "checkbox",
              checked: abasEditar.has(chave),
              dataset: { permissao: "editar", aba: chave }
            }),
            "Editar"
          )
        )
      )
    )
  );
}

function prepararFormulario(usuario = null) {
  usuarioEmEdicao = usuario;

  const titulo = $("#user-form-title");
  const botao = $("#user-submit");
  const papel = $("#user-role");
  const nome = $("#user-name");
  const login = $("#user-login");
  const senha = $("#user-password");
  const credenciais = $("#user-credentials");
  const cancelar = $("#user-cancel");
  const hint = $("#user-form-hint");

  if (usuario) {
    if (titulo) titulo.textContent = `Editando ${usuario.nome}`;
    if (botao) botao.textContent = "Salvar permissões";
    if (nome) nome.value = usuario.nome || "";
    if (login) login.required = false;
    if (senha) senha.required = false;
    credenciais?.classList.add("hidden");
    cancelar?.classList.remove("hidden");
    if (papel) papel.value = usuario.papel;
    if (hint) hint.textContent = `Login fixo no Supabase: ${usuario.usuario}`;
    aplicarPermissoesNaTela({
      abasVer: usuario.abasVer || permissaoPadrao(usuario.papel).ver,
      abasEditar: usuario.abasEditar || permissaoPadrao(usuario.papel).editar
    });
    return;
  }

  if (titulo) titulo.textContent = "Novo usuário";
  if (botao) botao.textContent = "Criar usuário";
  if (nome) nome.value = "";
  if (login) {
    login.value = "";
    login.required = true;
  }
  if (senha) {
    senha.value = "";
    senha.required = true;
  }
  credenciais?.classList.remove("hidden");
  cancelar?.classList.add("hidden");
  if (papel) papel.value = "caixa";
  if (hint) hint.textContent = "Use um e-mail válido e uma senha com pelo menos 10 caracteres.";
  aplicarPermissoesNaTela(permissaoPadrao(papel?.value || "caixa"));
}

function atualizarPermissoesDoPapel() {
  aplicarPermissoesNaTela(permissaoPadrao($("#user-role")?.value || usuarioEmEdicao?.papel || "caixa"));
}

function resumoPermissoes(usuario) {
  const ver = normalizarLista(usuario.abasVer || permissaoPadrao(usuario.papel).ver)
    .map(chave => ROTULOS_ABAS[chave] || chave)
    .join(", ");
  const editar = normalizarLista(usuario.abasEditar || permissaoPadrao(usuario.papel).editar)
    .map(chave => ROTULOS_ABAS[chave] || chave)
    .join(", ");
  return `Ver: ${ver || "nenhuma"} | Editar: ${editar || "nenhuma"}`;
}

function linhaUsuario(usuario) {
  const euMesmo = usuario.id === estado.usuario?.id;

  return el("div.user-row", { class: usuario.ativo ? "" : "muted", dataset: { id: String(usuario.id) } },
    el("div", {},
      el("strong", {}, usuario.nome),
      el("span", {}, `@${usuario.usuario}${euMesmo ? " (você)" : ""}`),
      el("span.small.faint", {}, resumoPermissoes(usuario))
    ),
    el("select", { dataset: { acao: "papel", id: String(usuario.id) }, disabled: euMesmo },
      ...Object.entries(PAPEIS_ROTULO).map(([chave, rotulo]) =>
        el("option", { value: chave, selected: usuario.papel === chave }, rotulo))
    ),
    el("span.small", {}, usuario.ultimoLogin ? `ultimo acesso ${dataHora(usuario.ultimoLogin)}` : "nunca acessou"),
    el("div.row-actions", {},
      el("button.ghost.small", { type: "button", dataset: { acao: "editar", id: String(usuario.id) } }, "Editar"),
      euMesmo ? null : el("button.ghost.small", { type: "button", dataset: { acao: "ativo", id: String(usuario.id), valor: String(!usuario.ativo) } },
        usuario.ativo ? "Desativar" : "Reativar"),
      euMesmo ? null : el("button.danger.small", { type: "button", dataset: { acao: "remover", id: String(usuario.id) } }, "Remover")
    )
  );
}

function detalheAuditoria(registro) {
  const detalhes = registro.detalhes || {};

  if (registro.acao === "pedido_cancelado") {
    const itens = Array.isArray(detalhes.itens) && detalhes.itens.length
      ? ` | ${detalhes.itens.join(", ")}`
      : "";
    return `Motivo: ${detalhes.motivo || "não informado"}${detalhes.cliente ? ` | Cliente ${detalhes.cliente}` : ""}${detalhes.total ? ` | Total ${reais(detalhes.total)}` : ""}${itens}`;
  }
  if (registro.acao === "pedido_motoboy") {
    return `Motoboy: ${detalhes.motoboy || "-"}${detalhes.cliente ? ` | Cliente ${detalhes.cliente}` : ""}`;
  }
  if (registro.acao === "produto_ordem") {
    return `${detalhes.nome || "Produto"} agora está na ordem ${detalhes.ordem || "-"}`;
  }
  if (registro.acao?.startsWith("insumo_")) {
    if (detalhes.de !== undefined || detalhes.para !== undefined) {
      return `${detalhes.nome || "Insumo"}: ${detalhes.de ?? "-"} -> ${detalhes.para ?? "-"} ${detalhes.unidade || ""}`.trim();
    }
    return detalhes.nome || "";
  }
  return "";
}

export async function desenharEquipe() {
  try {
    usuarios = (await apiUsuarios.listar()).usuarios;
  } catch (erro) {
    return toastFalha(erro, "Usuários");
  }

  render($("#user-list"), ...usuarios.map(linhaUsuario));

  try {
    const { registros } = await apiUsuarios.auditoria({ limite: 100 });
    render($("#audit-list"), ...registros.map(registro =>
      el("div.audit-row", {},
        el("span.audit-when", {}, dataHora(registro.criado_em)),
        el("strong", {}, registro.usuario || "cliente"),
        el("span", {},
          DESCRICAO_ACAO[registro.acao] || registro.acao,
          detalheAuditoria(registro) ? el("small.audit-detail", {}, detalheAuditoria(registro)) : null
        ),
        el("span.small.faint", {}, registro.entidade_id ? `#${String(registro.entidade_id).slice(-8)}` : "")
      )
    ));
  } catch {
    render($("#audit-list"), el("p.faint", {}, "Não foi possível carregar a auditoria."));
  }

  if (!usuarioEmEdicao) prepararFormulario(null);
}

export function ligarEquipe() {
  prepararFormulario(null);

  $("#user-role")?.addEventListener("change", atualizarPermissoesDoPapel);
  $("#user-cancel")?.addEventListener("click", () => prepararFormulario(null));

  $("#form-usuario")?.addEventListener("submit", async evento => {
    evento.preventDefault();
    const erro = $("#user-error");
    if (!usuarioEmEdicao) {
      const papel = $("#user-role").value;
      const permissoes = montarPermissoesSelecionadas();
      try {
        await apiUsuarios.criar({
          usuario: $("#user-login").value.trim().toLowerCase(),
          senha: $("#user-password").value,
          nome: $("#user-name").value.trim(),
          papel,
          abasVer: normalizarLista(permissoes.abasVer),
          abasEditar: normalizarLista(permissoes.abasEditar)
        });
        toast("Usuário criado.");
        evento.target.reset();
        erro?.classList.add("hidden");
        prepararFormulario(null);
        await desenharEquipe();
      } catch (falha) {
        if (erro) {
          erro.textContent = falha.message;
          erro.classList.remove("hidden");
        }
      }
      return;
    }
    const nome = $("#user-name").value.trim();
    const papel = $("#user-role").value;
    const permissoes = montarPermissoesSelecionadas();
    const abasVer = normalizarLista(permissoes.abasVer);
    const abasEditar = normalizarLista(permissoes.abasEditar);

    try {
      await apiUsuarios.atualizar(usuarioEmEdicao.id, {
        nome,
        papel,
        abasVer,
        abasEditar
      });

      toast("Permissões atualizadas.");
      evento.target.reset();
      erro.classList.add("hidden");
      prepararFormulario(null);
      await desenharEquipe();
    } catch (falha) {
      erro.textContent = falha.message;
      erro.classList.remove("hidden");
    }
  });

  const lista = $("#user-list");

  delegar(lista, "click", "[data-acao='editar']", (_e, botao) => {
    const usuario = usuarios.find(item => item.id === Number(botao.dataset.id));
    if (!usuario) return;

    prepararFormulario(usuario);
    $("#form-usuario")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  delegar(lista, "change", "[data-acao='papel']", async (_e, select) => {
    const papel = select.value;
    const permissoes = permissaoPadrao(papel);

    try {
      await apiUsuarios.atualizar(Number(select.dataset.id), {
        papel,
        abasVer: permissoes.ver,
        abasEditar: permissoes.editar
      });
      await desenharEquipe();
      toast("Papel atualizado.");
    } catch (erro) {
      toastFalha(erro);
      await desenharEquipe();
    }
  });

  delegar(lista, "click", "[data-acao='ativo']", async (_e, botao) => {
    try {
      await apiUsuarios.atualizar(Number(botao.dataset.id), { ativo: botao.dataset.valor === "true" });
      await desenharEquipe();
    } catch (erro) {
      toastFalha(erro);
    }
  });

  delegar(lista, "click", "[data-acao='remover']", async (_e, botao) => {
    const usuario = usuarios.find(item => item.id === Number(botao.dataset.id));
    if (!confirm(`Remover ${usuario?.nome}? O histórico de auditoria é mantido.`)) return;
    try {
      await apiUsuarios.remover(Number(botao.dataset.id));
      await desenharEquipe();
      toast("Usuário removido.");
    } catch (erro) {
      toastFalha(erro);
    }
  });
}
