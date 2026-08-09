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
let timerPainelLocalizacoes = null;
const timersMotoboy = new Map();
const INTERVALO_LOCALIZACAO_MS = 1000;
const CHAVE_MOTOBOY_NOME = "baixok.motoboy.nome";

const senha = pedido => String(pedido.id).slice(-3).toUpperCase();
const porData = lista => [...lista].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const podeVerLocalizacoes = () => ["admin", "caixa"].includes(estado.usuario?.papel);
const podeEnviarLocalizacao = () => estado.usuario?.papel === "entregador";
const ehAdmin = () => estado.usuario?.papel === "admin";
const normalizarNome = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .trim()
  .toLowerCase();

function nomeMotoboyLocal() {
  try {
    return localStorage.getItem(CHAVE_MOTOBOY_NOME) || "";
  } catch {
    return "";
  }
}

function salvarNomeMotoboyLocal(nome) {
  if (!nome || !podeEnviarLocalizacao()) return;
  try {
    localStorage.setItem(CHAVE_MOTOBOY_NOME, nome);
  } catch {
    /* Sem localStorage, a localizacao continua usando o nome do login. */
  }
}

export function registrarMotoboyLocal(nome) {
  salvarNomeMotoboyLocal(nome);
  if (!podeEnviarLocalizacao() || !("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    posicao => enviarLocalizacao(posicao, { forcar: true }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

function deviceId() {
  try {
    const chave = "baixok.motoboy.deviceId";
    const salvo = localStorage.getItem(chave);
    if (salvo) return salvo;
    const novo = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `motoboy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(chave, novo);
    return novo;
  } catch {
    return "principal";
  }
}

function navegadorNome(ua) {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\//i.test(ua)) return "Opera";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/crios\//i.test(ua)) return "Chrome iOS";
  if (/chrome\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return "";
}

function sistemaNome(ua, plataforma = "") {
  const base = `${ua} ${plataforma}`;
  if (/iphone/i.test(base)) return "iPhone";
  if (/ipad/i.test(base)) return "iPad";
  if (/android/i.test(base)) return "Android";
  if (/windows/i.test(base)) return "Windows";
  if (/mac/i.test(base)) return "macOS";
  if (/linux/i.test(base)) return "Linux";
  return plataforma || "";
}

async function deviceName() {
  const ua = navigator.userAgent || "";
  const partes = [];
  const uaData = navigator.userAgentData;
  let plataforma = navigator.platform || "";
  let modelo = "";
  let mobile = /mobile|android|iphone|ipad/i.test(ua);

  try {
    if (uaData?.getHighEntropyValues) {
      const dados = await uaData.getHighEntropyValues(["platform", "model", "mobile"]);
      plataforma = dados.platform || plataforma;
      modelo = dados.model || "";
      mobile = Boolean(dados.mobile);
    }
  } catch {
    /* O navegador pode negar esses detalhes por privacidade. */
  }

  partes.push(mobile ? "celular" : "computador");
  const sistema = sistemaNome(ua, plataforma);
  if (sistema) partes.push(sistema);
  if (modelo) partes.push(modelo);
  const navegador = navegadorNome(ua);
  if (navegador) partes.push(navegador);

  return Array.from(new Set(partes)).join(" - ").slice(0, 120);
}

function minutosDesde(data) {
  const diff = Date.now() - new Date(data).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutos = Math.max(0, Math.round(diff / 60000));
  if (minutos < 1) return "agora";
  if (minutos === 1) return "há 1 min";
  return `há ${minutos} min`;
}

function mapaUrl(localizacao) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${localizacao.lat},${localizacao.lng}`)}`;
}

function detalheAparelho(localizacao) {
  const partes = [];
  if (localizacao.usuario) partes.push(`Login ${localizacao.usuario}`);
  if (localizacao.deviceName) partes.push(localizacao.deviceName);
  return partes.join(" | ");
}

function nomesDaLocalizacao(localizacao) {
  return [localizacao.nome, localizacao.usuario].map(normalizarNome).filter(Boolean);
}

function localizacaoDoMotoboy(nome) {
  const chave = normalizarNome(nome);
  if (!chave) return null;
  return localizacoes.find(localizacao => nomesDaLocalizacao(localizacao).includes(chave)) || null;
}

function ultimaEntregaDaLocalizacao(localizacao) {
  const nomes = new Set(nomesDaLocalizacao(localizacao));
  if (!nomes.size) return null;
  return porData(entregas.filter(pedido =>
    pedido.status === "entregue" && nomes.has(normalizarNome(pedido.motoboy))
  ))[0] || null;
}

function trocoResumo(pedido) {
  if (!String(pedido.payment || "").toLowerCase().includes("dinheiro")) return null;
  const trocoPara = Number(pedido.trocoPara || 0);
  if (!trocoPara) return "Pagamento em dinheiro. Conferir troco.";
  const troco = Math.max(0, trocoPara - Number(pedido.total || 0));
  return `Troco para ${reais(trocoPara)} | devolver ${reais(troco)}`;
}

function fotoItem(item) {
  if (!item?.image) return el("div.motoboy-item-thumb.no-photo", {}, "Sem foto");
  return el("span.fit-media.motoboy-item-thumb", {},
    el("img.fit-media-bg", {
      src: item.image,
      alt: "",
      loading: "lazy",
      decoding: "async",
      "aria-hidden": "true"
    }),
    el("img.fit-media-main", {
      src: item.image,
      alt: item.name || "Produto",
      loading: "lazy",
      decoding: "async",
      onerror: evento => evento.target.closest(".fit-media")?.replaceWith(el("div.motoboy-item-thumb.no-photo", {}, "Sem foto"))
    })
  );
}

function linhaItemPedido(item) {
  const total = Number(item.price || 0) * Number(item.qty || 0);
  return el("div.motoboy-item-row", {},
    fotoItem(item),
    el("div", {},
      el("strong", {}, `${item.qty}x ${item.name}`),
      el("span", {}, `${reais(item.price || 0)} cada`)
    ),
    el("strong", {}, reais(total))
  );
}

function cartaoLocalizacaoAoVivo(localizacao) {
  const nomeEntrega = localizacao.nome || "";
  const login = localizacao.usuario || "-";
  const aparelho = localizacao.deviceName || "nao informado pelo navegador";
  const entrega = ultimaEntregaDaLocalizacao(localizacao);
  const precisao = localizacao.accuracy ? ` | precisão ${Math.round(localizacao.accuracy)}m` : "";
  return el("article.location-card", { class: localizacao.online ? "live" : "" },
    el("div", {},
      el("span", {}, localizacao.online ? "Ao vivo" : "Última posição"),
      el("strong", {}, nomeEntrega || login || "Motoboy"),
      el("small", {}, `Nome salvo na entrega: ${nomeEntrega || "ainda nao informado"}`),
      el("small", {}, `Login usado: ${login}`),
      el("small", {}, `Aparelho detectado: ${aparelho}`),
      el("small", {}, `${minutosDesde(localizacao.updatedAt)}${precisao}`),
      entrega ? el("small.location-order", {},
        `Pedido ${senha(entrega)} entregue por ${entrega.motoboy || localizacao.nome} - ${entrega.customer || "Cliente"}`
      ) : null
    ),
    el("a.secondary.small", { href: mapaUrl(localizacao), target: "_blank", rel: "noopener" }, "Abrir no Google")
  );
}

function cartaoExplicacaoLocalizacao() {
  return el("article.location-card.explain", {},
    el("div", {},
      el("span", {}, "Como identificar"),
      el("strong", {}, "Mesmo login, controle por nome salvo e aparelho"),
      el("small", {}, "O navegador nao libera o nome real do telefone. O sistema mostra o login usado, o aparelho detectado e o nome digitado quando a entrega e salva.")
    )
  );
}

function cartaoLocalizacao(localizacao) {
  const aparelho = detalheAparelho(localizacao);
  return el("article.location-card", {},
    el("div", {},
      el("span", {}, "Ultima posicao"),
      el("strong", {}, localizacao.nome || "Motoboy"),
      aparelho ? el("small", {}, aparelho) : null,
      el("small", {}, `${minutosDesde(localizacao.updatedAt)}${localizacao.accuracy ? ` | precisão ${Math.round(localizacao.accuracy)}m` : ""}`)
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
          el("span", {}, "Localização do entregador"),
          el("strong#motoboy-location-status", {}, watchId == null ? "Aguardando permissão do navegador" : "Localização ativa"),
          el("small", {}, "A posição só é enviada enquanto esta página estiver aberta.")
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
      ? [cartaoExplicacaoLocalizacao(), ...localizacoes.map(cartaoLocalizacaoAoVivo)]
      : el("article.location-card", { class: "empty" },
          el("div", {},
            el("span", {}, "Localização"),
            el("strong", {}, "Nenhum motoboy com posição recente"),
            el("small", {}, "Quando o entregador abrir a aba Motoboy e permitir localização, aparece aqui.")
          )
        )
  );
}

async function enviarLocalizacao(posicao, { forcar = false } = {}) {
  const agora = Date.now();
  if (!forcar && agora - ultimoEnvioLocalizacao < INTERVALO_LOCALIZACAO_MS) return;
  ultimoEnvioLocalizacao = agora;

  try {
    await apiMotoboys.salvarLocalizacao({
      lat: posicao.coords.latitude,
      lng: posicao.coords.longitude,
      accuracy: posicao.coords.accuracy,
      deviceId: deviceId(),
      deviceName: await deviceName(),
      motoboy: nomeMotoboyLocal() || undefined
    });
    const status = $("#motoboy-location-status");
    if (status) status.textContent = "Localização ativa";
  } catch (erro) {
    const status = $("#motoboy-location-status");
    if (status) status.textContent = "Não foi possível salvar a localização";
    if (!erroLocalizacaoMostrado) {
      erroLocalizacaoMostrado = true;
      toastFalha(erro, "Localização");
    }
  }
}

export function iniciarRastreamentoMotoboy() {
  if (!podeEnviarLocalizacao() || watchId != null) return;
  const status = $("#motoboy-location-status");
  if (!("geolocation" in navigator)) {
    if (status) status.textContent = "Este aparelho não liberou geolocalização";
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    enviarLocalizacao,
    () => {
      const alvo = $("#motoboy-location-status");
      if (alvo) alvo.textContent = "Localização bloqueada no navegador";
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

async function atualizarLocalizacoesPainel() {
  if (!podeVerLocalizacoes()) return;
  try {
    const resposta = await apiMotoboys.localizacoes();
    localizacoes = resposta.localizacoes || [];
    desenharLocalizacoes();
  } catch {
    /* Falha pontual no mapa nao deve piscar erro na operacao. */
  }
}

function iniciarAtualizacaoLocalizacoesPainel() {
  if (!podeVerLocalizacoes() || timerPainelLocalizacoes != null) return;
  atualizarLocalizacoesPainel();
  timerPainelLocalizacoes = setInterval(atualizarLocalizacoesPainel, INTERVALO_LOCALIZACAO_MS);
}

function cardEntrega(pedido) {
  const entregue = pedido.status === "entregue";
  const podeEditarMotoboy = !pedido.motoboy || ehAdmin();
  const troco = trocoResumo(pedido);
  const localizacao = localizacaoDoMotoboy(pedido.motoboy);
  const precisao = localizacao?.accuracy ? ` | precisão ${Math.round(localizacao.accuracy)}m` : "";

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
      el("p", {}, el("span", {}, "Horário"), el("strong", {}, dataHora(pedido.createdAt))),
      el("p", {}, el("span", {}, "Telefone"), el("strong", {}, pedido.phone || "-")),
      el("p", {}, el("span", {}, "Endereço"), el("strong", {}, pedido.place || "-"))
    ),
    el("div.motoboy-items-grid", {},
      pedido.items.length
        ? pedido.items.map(linhaItemPedido)
        : el("p.faint", {}, "Sem itens neste pedido.")
    ),
    pedido.note ? el("p.order-note", {}, el("strong", {}, "Obs: "), pedido.note) : null,
    troco ? el("p.order-note.money", {}, el("strong", {}, "Troco: "), troco) : null,
    localizacao ? el("p.order-note.route", {},
      el("strong", {}, "Localização: "),
      `${localizacao.nome || pedido.motoboy} ${minutosDesde(localizacao.updatedAt)}${precisao} `,
      el("a", { href: mapaUrl(localizacao), target: "_blank", rel: "noopener" }, "abrir no Google")
    ) : null,
    el("div.motoboy-actions", {},
      el("label", {},
        el("span", {}, "Motoboy"),
        el("input", {
          value: pedido.motoboy || "",
          maxlength: 80,
          placeholder: "Nome de quem fez a entrega",
          disabled: !podeEditarMotoboy,
          dataset: { acao: "motoboy-nome" }
        })
      ),
      el("button.secondary.small", {
        type: "button",
        disabled: !podeEditarMotoboy,
        dataset: { acao: "salvar-motoboy" }
      }, podeEditarMotoboy ? "Salvar motoboy" : "Motoboy salvo"),
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
    iniciarRastreamentoMotoboy();
    iniciarAtualizacaoLocalizacoesPainel();

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
  if ((card.dataset.motoboySalvo || "") && nome !== card.dataset.motoboySalvo && !ehAdmin()) {
    return toastFalha(new Error("Motoboy ja foi salvo. Apenas administrador pode alterar."), "Motoboy");
  }
  if (nome === (card.dataset.motoboySalvo || "")) {
    statusMotoboy(card, "Salvo", "ok");
    return;
  }

  try {
    statusMotoboy(card, "Salvando...");
    await apiPedidos.definirMotoboy(card.dataset.id, nome);
    registrarMotoboyLocal(nome);
    card.dataset.motoboySalvo = nome;
    statusMotoboy(card, "Salvo", "ok");
    if (redesenhar) await desenharMotoboy();
  } catch (erro) {
    statusMotoboy(card, "Não salvou", "erro");
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
    if (!nome) return toastFalha(new Error("Informe o motoboy antes de marcar a entrega como entregue."), "Entrega");
    if ((card.dataset.motoboySalvo || "") && nome !== card.dataset.motoboySalvo && !ehAdmin()) {
      return toastFalha(new Error("Motoboy ja foi salvo. Apenas administrador pode alterar."), "Entrega");
    }
    await apiPedidos.mudarStatus(card.dataset.id, "entregue", { motoboy: nome });
    registrarMotoboyLocal(nome);
    toast("Pedido marcado como entregue.");
    await desenharMotoboy();
  } catch (erro) {
    toastFalha(erro, "Entrega");
  }
}

export function ligarMotoboy() {
  const alvo = $("#motoboy-list");
  if (!alvo) return;

  iniciarRastreamentoMotoboy();
  iniciarAtualizacaoLocalizacoesPainel();

  delegar(alvo, "click", "[data-acao='salvar-motoboy']", (_e, botao) => salvarMotoboy(botao.closest(".motoboy-card")));
  delegar(alvo, "click", "[data-acao='entregue']", (_e, botao) => marcarEntregue(botao.closest(".motoboy-card")));
  delegar(alvo, "input", "[data-acao='motoboy-nome']", (_e, input) => agendarSalvarMotoboy(input));
  delegar(alvo, "change", "[data-acao='motoboy-nome']", (_e, input) => salvarMotoboy(input.closest(".motoboy-card")));
}
