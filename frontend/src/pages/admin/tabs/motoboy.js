import { el, render, $, delegar } from "../../../utils/dom.js";
import { reais, dataHora } from "../../../utils/formato.js";
import { STATUS_ROTULO, CANAIS_ROTULO } from "../../../utils/categorias.js";
import { apiMotoboys, apiPedidos } from "../../../services/api.js";
import { toast, toastFalha } from "../../../components/toast.js";
import { estado } from "../store.js";

let entregas = [];
let localizacoes = [];
let watchId = null;
let ultimoEnvioLocalizacao = 0;
let erroLocalizacaoMostrado = false;
const timersMotoboy = new Map();

const senha = pedido => String(pedido.id).slice(-3).toUpperCase();
const porData = lista => [...lista].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const podeVerLocalizacoes = () => ["admin", "caixa"].includes(estado.usuario?.papel);
const podeEnviarLocalizacao = () => estado.usuario?.papel === "entregador";

function minutosDesde(data) {
  const diff = Date.now() - new Date(data).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutos = Math.max(0, Math.round(diff / 60000));
  if (minutos < 1) return "agora";
  if (minutos === 1) return "ha 1 min";
  return `ha ${minutos} min`;
}

function mapaUrl(localizacao) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${localizacao.lat},${localizacao.lng}`)}`;
}

function cartaoLocalizacao(localizacao) {
  return el("article.location-card", {},
    el("div", {},
      el("span", {}, "Ultima posicao"),
      el("strong", {}, localizacao.nome || "Motoboy"),
      el("small", {}, `${minutosDesde(localizacao.updatedAt)}${localizacao.accuracy ? ` | precisao ${Math.round(localizacao.accuracy)}m` : ""}`)
    ),
    el("a.secondary.small", { href: mapaUrl(localizacao), target: "_blank", rel: "noopener" }, "Abrir mapa")
  );
}

function desenharLocalizacoes() {
  const alvo = $("#motoboy-location-panel");
  if (!alvo) return;

  if (podeEnviarLocalizacao()) {
    render(alvo,
      el("article.location-card", { class: "self" },
        el("div", {},
          el("span", {}, "Localizacao do entregador"),
          el("strong#motoboy-location-status", {}, watchId == null ? "Aguardando permissao do navegador" : "Localizacao ativa"),
          el("small", {}, "A posicao so e enviada enquanto esta pagina estiver aberta.")
        )
      )
    );
    return;
  }

  if (!podeVerLocalizacoes()) {
    render(alvo);
    return;
  }

  render(alvo,
    localizacoes.length
      ? localizacoes.map(cartaoLocalizacao)
      : el("article.location-card", { class: "empty" },
          el("div", {},
            el("span", {}, "Localizacao"),
            el("strong", {}, "Nenhum motoboy com posicao recente"),
            el("small", {}, "Quando o entregador abrir a aba Motoboy e permitir localizacao, aparece aqui.")
          )
        )
  );
}

async function enviarLocalizacao(posicao) {
  const agora = Date.now();
  if (agora - ultimoEnvioLocalizacao < 30000) return;
  ultimoEnvioLocalizacao = agora;

  try {
    await apiMotoboys.salvarLocalizacao({
      lat: posicao.coords.latitude,
      lng: posicao.coords.longitude,
      accuracy: posicao.coords.accuracy
    });
    const status = $("#motoboy-location-status");
    if (status) status.textContent = "Localizacao ativa";
  } catch (erro) {
    const status = $("#motoboy-location-status");
    if (status) status.textContent = "Nao foi possivel salvar a localizacao";
    if (!erroLocalizacaoMostrado) {
      erroLocalizacaoMostrado = true;
      toastFalha(erro, "Localizacao");
    }
  }
}

function iniciarRastreamento() {
  if (!podeEnviarLocalizacao() || watchId != null) return;
  const status = $("#motoboy-location-status");
  if (!("geolocation" in navigator)) {
    if (status) status.textContent = "Este aparelho nao liberou geolocalizacao";
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    enviarLocalizacao,
    () => {
      const alvo = $("#motoboy-location-status");
      if (alvo) alvo.textContent = "Localizacao bloqueada no navegador";
    },
    { enableHighAccuracy: false, maximumAge: 30000, timeout: 12000 }
  );
}

function cardEntrega(pedido) {
  const entregue = pedido.status === "entregue";

  return el("article.motoboy-card", { class: entregue ? "done" : "", dataset: { id: pedido.id, motoboySalvo: pedido.motoboy || "" } },
    el("div.motoboy-card-head", {},
      el("div", {},
        el("span.pill", { class: `status-${pedido.status}` }, STATUS_ROTULO[pedido.status] || pedido.status),
        el("h2", {}, `Pedido ${senha(pedido)} - ${pedido.customer || "Cliente"}`)
      ),
      el("strong.price", {}, reais(pedido.total || 0))
    ),
    el("div.motoboy-grid", {},
      el("p", {}, el("span", {}, "Canal"), el("strong", {}, CANAIS_ROTULO[pedido.channel] || pedido.channel || "-")),
      el("p", {}, el("span", {}, "Horario"), el("strong", {}, dataHora(pedido.createdAt))),
      el("p", {}, el("span", {}, "Telefone"), el("strong", {}, pedido.phone || "-")),
      el("p", {}, el("span", {}, "Endereco"), el("strong", {}, pedido.place || "-"))
    ),
    el("p.motoboy-items", {}, pedido.items.map(item => `${item.qty}x ${item.name}`).join(" | ") || "Sem itens"),
    pedido.note ? el("p.order-note", {}, el("strong", {}, "Obs: "), pedido.note) : null,
    el("div.motoboy-actions", {},
      el("label", {},
        el("span", {}, "Motoboy"),
        el("input", {
          value: pedido.motoboy || "",
          maxlength: 80,
          placeholder: "Nome de quem fez a entrega",
          dataset: { acao: "motoboy-nome" }
        })
      ),
      el("button.secondary.small", { type: "button", dataset: { acao: "salvar-motoboy" } }, "Salvar motoboy"),
      el("span.motoboy-save-state", { dataset: { acao: "motoboy-status" } }, pedido.motoboy ? "Salvo" : ""),
      !entregue
        ? el("button.ghost-green.small", { type: "button", dataset: { acao: "entregue" } }, "Marcar entregue")
        : null
    )
  );
}

export async function desenharMotoboy() {
  const alvo = $("#motoboy-list");
  if (!alvo) return;

  try {
    desenharLocalizacoes();
    iniciarRastreamento();

    const [respostaPedidos, respostaLocalizacoes] = await Promise.all([
      apiPedidos.listar({ limite: 500 }),
      podeVerLocalizacoes() ? apiMotoboys.localizacoes() : Promise.resolve({ localizacoes: [] })
    ]);
    const { pedidos } = respostaPedidos;
    localizacoes = respostaLocalizacoes.localizacoes || [];
    entregas = porData(pedidos.filter(pedido =>
      pedido.fulfillment === "entrega" && ["pronto", "entregue"].includes(pedido.status)
    ));
  } catch (erro) {
    toastFalha(erro, "Motoboy");
    return;
  }

  render(alvo, entregas.length
    ? entregas.map(cardEntrega)
    : el("p.faint.pad", {}, "Nenhuma entrega pronta ou entregue."));
  desenharLocalizacoes();
}

function statusMotoboy(card, texto, classe = "") {
  const alvo = card?.querySelector("[data-acao='motoboy-status']");
  if (!alvo) return;
  alvo.textContent = texto;
  alvo.className = `motoboy-save-state ${classe}`.trim();
}

async function salvarMotoboy(card, { redesenhar = false } = {}) {
  const nome = card.querySelector("[data-acao='motoboy-nome']")?.value.trim() || "";
  if (!nome) return toastFalha(new Error("Informe o nome do motoboy."), "Motoboy");
  if (nome === (card.dataset.motoboySalvo || "")) {
    statusMotoboy(card, "Salvo", "ok");
    return;
  }

  try {
    statusMotoboy(card, "Salvando...");
    await apiPedidos.definirMotoboy(card.dataset.id, nome);
    card.dataset.motoboySalvo = nome;
    statusMotoboy(card, "Salvo", "ok");
    if (redesenhar) await desenharMotoboy();
  } catch (erro) {
    statusMotoboy(card, "Nao salvou", "erro");
    toastFalha(erro, "Motoboy");
  }
}

function agendarSalvarMotoboy(input) {
  const card = input.closest(".motoboy-card");
  if (!card) return;
  const nome = input.value.trim();
  clearTimeout(timersMotoboy.get(card.dataset.id));
  if (!nome || nome === (card.dataset.motoboySalvo || "")) {
    statusMotoboy(card, nome ? "Salvo" : "");
    return;
  }
  statusMotoboy(card, "Salvando...");
  timersMotoboy.set(card.dataset.id, setTimeout(() => salvarMotoboy(card), 900));
}

async function marcarEntregue(card) {
  try {
    const nome = card.querySelector("[data-acao='motoboy-nome']")?.value.trim() || "";
    if (nome && nome !== (card.dataset.motoboySalvo || "")) await salvarMotoboy(card);
    await apiPedidos.mudarStatus(card.dataset.id, "entregue");
    toast("Pedido marcado como entregue.");
    await desenharMotoboy();
  } catch (erro) {
    toastFalha(erro, "Entrega");
  }
}

export function ligarMotoboy() {
  const alvo = $("#motoboy-list");
  if (!alvo) return;

  delegar(alvo, "click", "[data-acao='salvar-motoboy']", (_e, botao) => salvarMotoboy(botao.closest(".motoboy-card")));
  delegar(alvo, "click", "[data-acao='entregue']", (_e, botao) => marcarEntregue(botao.closest(".motoboy-card")));
  delegar(alvo, "input", "[data-acao='motoboy-nome']", (_e, input) => agendarSalvarMotoboy(input));
  delegar(alvo, "change", "[data-acao='motoboy-nome']", (_e, input) => salvarMotoboy(input.closest(".motoboy-card")));
}
