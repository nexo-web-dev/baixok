/* Baixo K - servidor de sincronia entre aparelhos.
 *
 * Sem dependencias: roda com `node server.js`. Serve os arquivos do site e
 * guarda o estado compartilhado (pedidos, mesas, produtos, promocoes, cupons)
 * em data/baixo-k.json.
 *
 * Sem este servidor o site continua funcionando sozinho, guardando tudo no
 * localStorage do proprio navegador - so que ai cada aparelho fica com a sua
 * copia. Com ele, o celular do cliente e o tablet do balcao veem a mesma fila.
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");

function carregarEnvArquivo(caminho) {
  try {
    const texto = fs.readFileSync(caminho, "utf8");
    texto.split(/\r?\n/).forEach(linha => {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith("#")) return;
      const separador = limpa.indexOf("=");
      if (separador < 1) return;
      const chave = limpa.slice(0, separador).trim();
      let valor = limpa.slice(separador + 1).trim();
      if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
        valor = valor.slice(1, -1);
      }
      if (!(chave in process.env)) process.env[chave] = valor;
    });
  } catch {}
}

carregarEnvArquivo(path.join(__dirname, ".env.local"));
carregarEnvArquivo(path.join(__dirname, ".env"));

/* Chamada a servico de fora (Supabase e Mapbox).
 *
 * O certificado TLS E conferido. Estava com `rejectUnauthorized: false`, o que
 * desliga essa conferencia: qualquer um no meio do caminho — wifi aberto,
 * roteador comprometido, DNS envenenado — podia apresentar um certificado
 * falso e o servidor aceitaria sem reclamar. Por esse cano passa a
 * SUPABASE_SERVICE_ROLE_KEY, que e credencial de administrador do banco: ler
 * essa chave e ter o banco inteiro, com ou sem senha do painel.
 *
 * Se algum dia for preciso apontar para um servico local com certificado
 * proprio, use TLS_INSEGURO=1 — explicito, e so em teste. */
const TLS_INSEGURO = process.env.TLS_INSEGURO === "1";
function requestExterno(rawUrl, { method = "GET", headers = {}, body = null, responseType = "text" } = {}) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(rawUrl);
    const cliente = alvo.protocol === "http:" ? http : https;
    const req = cliente.request(alvo, {
      method,
      headers,
      rejectUnauthorized: !TLS_INSEGURO
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: responseType === "buffer" ? buffer : buffer.toString("utf8")
        });
      });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "baixo-k.json");
const SENHA_FILE = path.join(DATA_DIR, "senha.txt");

/* Paginas do balcao pedem senha; o cardapio do cliente e aberto.
 * Guardadas sem a barra e em minusculas: a comparacao acontece depois de
 * resolver o caminho, nunca sobre o texto cru da URL. */
const PAGINAS_RESTRITAS = new Set(["admin.html", "telao.html"]);

const SESSOES_FILE = path.join(DATA_DIR, "sessoes.json");
const SESSAO_MS = 30 * 24 * 60 * 60 * 1000;
/* token -> instante em que expira. Antes era um Set sem prazo: um cookie
 * roubado valia para sempre, porque o Max-Age do cookie so vale no navegador
 * e quem ataca simplesmente nao o respeita. */
let sessoes = new Map();

function carregarSessoes() {
  try {
    const bruto = JSON.parse(fs.readFileSync(SESSOES_FILE, "utf8"));
    sessoes = new Map(Object.entries(bruto).filter(([, ate]) => Date.now() < ate));
  } catch {
    sessoes = new Map();
  }
}
function gravarSessoes() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SESSOES_FILE, JSON.stringify(Object.fromEntries(sessoes)), "utf8");
  } catch {}
}
function limparSessoes() {
  const antes = sessoes.size;
  sessoes.forEach((ate, token) => { if (Date.now() > ate) sessoes.delete(token); });
  if (sessoes.size !== antes) gravarSessoes();
}

function senhaDaLoja() {
  if (process.env.BAIXOK_SENHA) return process.env.BAIXOK_SENHA;
  try {
    return fs.readFileSync(SENHA_FILE, "utf8").trim();
  } catch {
    const nova = crypto.randomInt(100000, 999999).toString();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SENHA_FILE, nova + "\n", "utf8");
    return nova;
  }
}
function ehBalcao(req) {
  const cookie = req.headers.cookie || "";
  const achou = cookie.split(";").map(p => p.trim()).find(p => p.startsWith("bk_sessao="));
  if (!achou) return false;
  const token = achou.slice("bk_sessao=".length);
  const ate = sessoes.get(token);
  if (!ate) return false;
  if (Date.now() > ate) { sessoes.delete(token); return false; }
  return true;
}
/* Comparacao de senha em tempo constante. Com senha de 6 digitos o ganho e
 * pequeno, mas custa uma linha e vale quando alguem trocar por uma frase. */
function senhaConfere(enviada, correta) {
  const a = Buffer.from(String(enviada));
  const b = Buffer.from(String(correta));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* — limite de tentativas por IP —
 * A senha tem 6 digitos: 900 mil combinacoes. Sem limite, um script testa
 * tudo em algumas horas. Nao substitui um proxy na frente, mas fecha o obvio. */
const tentativas = new Map();
/* Atras de um proxy com TLS, todo mundo chega com o IP do proxy: um cliente
 * errando a senha travaria a loja inteira. Com CONFIAR_PROXY=1 usamos o IP
 * real que o proxy anuncia. Sem a variavel esse cabecalho e ignorado, porque
 * quem chama direto pode escrever nele o que quiser e escapar do limite. */
const CONFIAR_PROXY = process.env.CONFIAR_PROXY === "1";
function ipDe(req) {
  if (CONFIAR_PROXY) {
    const encaminhado = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (encaminhado) return encaminhado;
  }
  return String(req.socket.remoteAddress || "desconhecido");
}
function excedeu(chave, limite, janelaMs) {
  const agora = Date.now();
  const registro = tentativas.get(chave);
  if (!registro || agora > registro.ate) {
    tentativas.set(chave, { contagem: 1, ate: agora + janelaMs });
    return false;
  }
  registro.contagem += 1;
  return registro.contagem > limite;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const EMPTY = {
  products: [], orders: [], tables: [], promos: [], coupons: [],
  // area de entrega: ponto da loja e faixas de raio, em km crescente
  delivery: { endereco: "", lng: null, lat: null, zones: [] }
};

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
const SUPABASE_ON = Boolean(SUPABASE_URL && SUPABASE_KEY);
const SUPABASE_STATE_TABLE = "app_state";

const MAPBOX_FILE = path.join(DATA_DIR, "mapbox.txt");
// permite apontar para outro endereco em teste ou atras de um proxy proprio
const MAPBOX_API = process.env.MAPBOX_API || "https://api.mapbox.com";
function tokenMapbox() {
  if (process.env.MAPBOX_TOKEN) return process.env.MAPBOX_TOKEN.trim();
  try { return fs.readFileSync(MAPBOX_FILE, "utf8").trim(); } catch { return ""; }
}
/* O widget de busca da Mapbox roda no navegador e exige o token la.
 * Token publico ("pk.") existe para isso e a propria Mapbox o trata como
 * exposto - a protecao dele e a restricao por URL na conta.
 * Token secreto ("sk.") nao sai daqui de jeito nenhum: nesse caso o navegador
 * fica sem widget e volta para a busca via servidor, que continua funcionando. */
function tokenPublico() {
  const token = tokenMapbox();
  return token.startsWith("pk.") ? token : "";
}

/* Distancia em linha reta, em km. E o que "raio de entrega" quer dizer:
 * nao mede trajeto, mede afastamento da loja. */
function distanciaKm(aLng, aLat, bLng, bLat) {
  const R = 6371;
  const rad = grau => (grau * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function faixaDaDistancia(km, zones) {
  return [...(zones || [])].sort((a, b) => a.km - b.km).find(zone => km <= Number(zone.km)) || null;
}

/* Caixa em volta da loja, com folga sobre a maior faixa cadastrada.
 * Serve de filtro duro na busca: `proximity` sozinho e so uma inclinacao, e a
 * Mapbox despreza ela quando o texto casa melhor em outra cidade. Medido com
 * a API de verdade: "Rua Barao de Tefe, 75" — que existe na Saude, a 500 m
 * daqui — voltava a de Sao Paulo em primeiro, e a taxa dava 363 km. O pedido
 * era recusado por um endereco que o entregador faz a pe. */
function caixaDaArea() {
  const loja = state.delivery || {};
  if (loja.lng == null || loja.lat == null) return null;
  const raios = (loja.zones || []).map(z => Number(z.km) || 0);
  const folga = Math.max(5, ...raios) * 1.6;
  const grausLat = folga / 111;
  const grausLng = folga / (111 * Math.cos((loja.lat * Math.PI) / 180));
  return [
    loja.lng - grausLng, loja.lat - grausLat,
    loja.lng + grausLng, loja.lat + grausLat
  ].map(n => n.toFixed(6)).join(",");
}

/* — CEP —
 * A Mapbox nao conhece CEP brasileiro completo. Medido com a API de verdade:
 * "20081-262", "20220-460", "22010-000" e ate "01310-100" (Avenida Paulista)
 * devolvem zero resultado, e "20081262" sem hifen casa com Piquete, no
 * interior de Sao Paulo. So o prefixo de 5 digitos funciona, e ele aponta
 * para a cidade inteira.
 *
 * O ViaCEP e o servico dos Correios, gratuito e sem cadastro. Traduzimos o CEP
 * para rua e bairro antes de mandar para a Mapbox. So sai daqui o CEP: nenhum
 * dado do cliente vai junto. */
const CEP = /^\s*(\d{5})-?(\d{3})\s*$/;
async function enderecoDoCep(texto) {
  const casou = CEP.exec(String(texto));
  if (!casou) return null;
  try {
    const resposta = await requestExterno(`https://viacep.com.br/ws/${casou[1]}${casou[2]}/json/`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (resposta.status !== 200) return null;
    const dados = JSON.parse(resposta.body || "{}");
    if (dados.erro || !dados.logradouro) return null;
    return [dados.logradouro, dados.bairro, dados.localidade, dados.uf].filter(Boolean).join(", ");
  } catch {
    return null;                       // ViaCEP fora do ar nao pode derrubar o pedido
  }
}

/* limitarNaArea: liga o bbox. Vale para endereco de cliente, onde tudo que
 * esta longe demais e ruido. Nao vale para a busca do endereco da propria
 * loja no painel, que pode estar corrigindo um ponto errado. */
async function geocodificar(texto, { limitarNaArea = false } = {}) {
  const token = tokenMapbox();
  if (!token) throw new Error("Mapbox nao configurado no servidor");
  const loja = state.delivery || {};
  const busca = (await enderecoDoCep(texto)) || String(texto);
  const params = new URLSearchParams({
    q: busca.slice(0, 256),
    access_token: token,
    country: "br",
    language: "pt",
    limit: "5",
    /* Esta e a v6. "street" so existe aqui; "poi" so existe na v5 do widget, e
     * aqui devolve 422 — ponto de referencia mudou para a Search Box API, que
     * e outro endpoint. O widget usa a intersecao das duas listas; aqui
     * podemos ser mais generosos, porque ser mais permissivo do lado que
     * confere nunca recusa o que o cliente escolheu. */
    types: "address,street,postcode,place,neighborhood"
  });
  // proximity ordena por perto da loja; bbox corta o que esta longe demais
  if (loja.lng != null && loja.lat != null) params.set("proximity", `${loja.lng},${loja.lat}`);
  if (limitarNaArea) {
    const caixa = caixaDaArea();
    if (caixa) params.set("bbox", caixa);
  }

  const resposta = await requestExterno(`${MAPBOX_API}/search/geocode/v6/forward?${params}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (resposta.status < 200 || resposta.status >= 300) {
    // a mensagem da Mapbox junto: so "422" nao diz qual parametro ela recusou
    let motivo = "";
    try { motivo = JSON.parse(resposta.body || "{}").message || ""; } catch {}
    throw new Error(`Mapbox respondeu ${resposta.status}${motivo ? `: ${motivo}` : ""}`);
  }
  const dados = JSON.parse(resposta.body || "{}");
  return (dados.features || []).map(f => ({
    id: f.properties?.mapbox_id || "",
    nome: f.properties?.name || "",
    detalhe: f.properties?.place_formatted || "",
    lng: f.properties?.coordinates?.longitude,
    lat: f.properties?.coordinates?.latitude,
    precisao: f.properties?.coordinates?.accuracy || ""
  })).filter(r => Number.isFinite(r.lng) && Number.isFinite(r.lat));
}

/* Taxa calculada aqui, nunca aceita do navegador. */
function taxaParaEndereco(endereco, coordenada) {
  const loja = state.delivery || {};
  if (loja.lng == null || loja.lat == null || !(loja.zones || []).length) {
    return { configurado: false, taxa: 0, km: null, zona: null };
  }
  const km = distanciaKm(loja.lng, loja.lat, coordenada.lng, coordenada.lat);
  const zona = faixaDaDistancia(km, loja.zones);
  return {
    configurado: true,
    dentro: Boolean(zona),
    km: Math.round(km * 10) / 10,
    taxa: zona ? Number(zona.fee) : 0,
    minimo: zona ? Number(zona.min || 0) : 0,
    zona: zona ? `ate ${zona.km} km` : null,
    endereco
  };
}
let state = { ...EMPTY, rev: 0 };
let supabasePersistMode = SUPABASE_ON ? "state" : "local";
let listeners = [];
const MAX_OUVINTES = 200;

const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BACKUPS_MANTIDOS = 14;

function lerArquivo(file) {
  // remove o BOM: o Bloco de Notas e o PowerShell gravam UTF-8 com marca no
  // inicio, e JSON.parse recusa. Sem isso, quem abrisse o arquivo para dar uma
  // olhada e salvasse por engano derrubava o banco para o backup da vespera
  const texto = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const dados = JSON.parse(texto);
  if (!dados || typeof dados !== "object" || !Array.isArray(dados.products)) {
    throw new Error("formato invalido");
  }
  // uma colecao corrompida nao pode derrubar o resto: cada uma cai para o vazio
  ["orders", "tables", "promos", "coupons"].forEach(chave => {
    if (!Array.isArray(dados[chave])) dados[chave] = [];
  });
  if (!dados.delivery || typeof dados.delivery !== "object") dados.delivery = { ...EMPTY.delivery };
  return dados;
}
function backupsMaisNovosPrimeiro() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter(n => n.endsWith(".json")).sort().reverse()
      .map(n => path.join(BACKUP_DIR, n));
  } catch {
    return [];
  }
}

function estadoNormalizado(dados = {}) {
  const state = { ...EMPTY, ...dados };
  state.products = Array.isArray(state.products) ? state.products : [];
  state.orders = Array.isArray(state.orders) ? state.orders : [];
  state.tables = Array.isArray(state.tables) ? state.tables : [];
  state.promos = Array.isArray(state.promos) ? state.promos : [];
  state.coupons = Array.isArray(state.coupons) ? state.coupons : [];
  const delivery = state.delivery && typeof state.delivery === "object" ? state.delivery : { ...EMPTY.delivery };
  state.delivery = {
    ...EMPTY.delivery,
    ...delivery,
    zones: Array.isArray(delivery.zones)
      ? delivery.zones.map(z => ({ km: Number(z.km) || 0, fee: Number(z.fee) || 0, min: Number(z.min) || 0 }))
        .filter(z => z.km > 0)
        .sort((a, b) => a.km - b.km)
      : []
  };
  state.rev = Number.isFinite(Number(state.rev)) ? Number(state.rev) : 0;
  return state;
}
function snapshotState() {
  return estadoNormalizado(state);
}
function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: "application/json",
    ...extra
  };
}
async function supabaseRequest(pathname, options = {}) {
  const resposta = await requestExterno(`${SUPABASE_URL}${pathname}`, {
    method: options.method || "GET",
    headers: supabaseHeaders(options.headers || {}),
    body: options.body ?? null
  });
  const texto = resposta.body || "";
  let dados = null;
  if (texto) {
    try { dados = JSON.parse(texto); } catch { dados = texto; }
  }
  if (resposta.status < 200 || resposta.status >= 300) {
    const mensagem = dados && typeof dados === "object"
      ? dados.message || dados.error || dados.details || JSON.stringify(dados)
      : String(dados || `status ${resposta.status}`);
    throw new Error(`Supabase ${resposta.status}: ${mensagem}`);
  }
  return dados;
}
function jsonArray(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === "string") {
    try {
      const parsed = JSON.parse(valor);
      return Array.isArray(parsed) ? parsed : [];
    } catch {}
  }
  return [];
}
function mapLegacyOrder(row) {
  return {
    id: row.id,
    createdAt: row.created_at || row.createdAt || "",
    status: row.status || "novo",
    customer: row.customer || "",
    phone: row.phone || "",
    place: row.place || "",
    note: row.note || "",
    payment: row.payment || "",
    channel: row.channel || "",
    fulfillment: row.fulfillment || "",
    items: jsonArray(row.items),
    subtotal: Number(row.subtotal || 0),
    coupon: row.coupon || "",
    discount: Number(row.discount || 0),
    deliveryFee: Number(row.delivery_fee ?? row.deliveryFee ?? 0),
    deliveryKm: row.delivery_km ?? row.deliveryKm ?? null,
    deliveryZone: row.delivery_zone || row.deliveryZone || "",
    total: Number(row.total || 0),
    printed: Boolean(row.printed),
    stockDeducted: Boolean(row.stock_deducted ?? row.stockDeducted),
    meta: row.meta && typeof row.meta === "object" ? row.meta : {}
  };
}
async function supabaseReadLegacyState() {
  const [products, orders, tables, promos, coupons, deliveryRows, zones] = await Promise.all([
    supabaseRequest("/rest/v1/products?select=*", { method: "GET" }).catch(() => []),
    supabaseRequest("/rest/v1/orders?select=*", { method: "GET" }).catch(() => []),
    supabaseRequest("/rest/v1/tables?select=*", { method: "GET" }).catch(() => []),
    supabaseRequest("/rest/v1/promos?select=*", { method: "GET" }).catch(() => []),
    supabaseRequest("/rest/v1/coupons?select=*", { method: "GET" }).catch(() => []),
    supabaseRequest("/rest/v1/delivery?select=*", { method: "GET" }).catch(() => []),
    supabaseRequest("/rest/v1/delivery_zones?select=*&order=km.asc", { method: "GET" }).catch(() => [])
  ]);
  const temConteudo = [products, orders, tables, promos, coupons, deliveryRows, zones].some(lista => Array.isArray(lista) && lista.length);
  if (!temConteudo) return null;
  const delivery = deliveryRows[0] || {};
  return estadoNormalizado({
    products: Array.isArray(products) ? products.map(row => ({
      id: row.id,
      name: row.name || "",
      category: row.category || "",
      price: Number(row.price || 0),
      stock: Number(row.stock || 0),
      minStock: Number(row.min_stock ?? row.minStock ?? 0),
      active: row.active !== false,
      image: row.image || "",
      badge: row.badge || "",
      description: row.description || ""
    })) : [],
    orders: Array.isArray(orders) ? orders.map(mapLegacyOrder) : [],
    tables: Array.isArray(tables) ? tables.map(row => ({
      n: Number(row.n),
      status: row.status || "livre",
      openedAt: row.opened_at || row.openedAt || null,
      items: jsonArray(row.items)
    })) : [],
    promos: Array.isArray(promos) ? promos.map(row => ({
      id: row.id,
      productId: row.product_id || row.productId || "",
      price: Number(row.price || 0),
      until: row.until || null
    })) : [],
    coupons: Array.isArray(coupons) ? coupons.map(row => ({
      code: row.code,
      kind: row.kind || "pct",
      amount: Number(row.amount || 0),
      min: Number(row.min || 0),
      once: Boolean(row.once),
      until: row.until || null,
      uses: Number(row.uses || 0),
      active: row.active !== false
    })) : [],
    delivery: {
      endereco: delivery.endereco || "",
      lng: delivery.lng ?? null,
      lat: delivery.lat ?? null,
      zones: Array.isArray(zones)
        ? zones.map(z => ({ km: Number(z.km) || 0, fee: Number(z.fee) || 0, min: Number(z.min) || 0 }))
          .filter(z => z.km > 0)
          .sort((a, b) => a.km - b.km)
        : []
    }
  });
}
function rowProducto(product) {
  return {
    id: product.id,
    name: product.name || "",
    category: product.category || "",
    price: Number(product.price || 0),
    stock: Number(product.stock || 0),
    min_stock: Number(product.minStock ?? product.min_stock ?? 0),
    active: product.active !== false,
    image: product.image || "",
    badge: product.badge || "",
    description: product.description || ""
  };
}
function rowPedido(order) {
  return {
    id: order.id,
    created_at: order.createdAt || new Date().toISOString(),
    status: order.status || "novo",
    customer: order.customer || "",
    phone: order.phone || "",
    place: order.place || "",
    note: order.note || "",
    payment: order.payment || "",
    channel: order.channel || "",
    fulfillment: order.fulfillment || "",
    subtotal: Number(order.subtotal || 0),
    coupon: order.coupon || "",
    discount: Number(order.discount || 0),
    delivery_fee: Number(order.deliveryFee || 0),
    delivery_km: order.deliveryKm ?? null,
    delivery_zone: order.deliveryZone || "",
    total: Number(order.total || 0),
    printed: Boolean(order.printed),
    stock_deducted: Boolean(order.stockDeducted),
    items: Array.isArray(order.items) ? order.items : [],
    meta: order.meta && typeof order.meta === "object" ? order.meta : {}
  };
}
function rowMesa(table) {
  return {
    n: Number(table.n),
    status: table.status || "livre",
    opened_at: table.openedAt || null,
    items: Array.isArray(table.items) ? table.items : []
  };
}
function rowPromo(promo) {
  return {
    id: promo.id,
    product_id: promo.productId || "",
    price: Number(promo.price || 0),
    until: promo.until || null
  };
}
function rowCupom(coupon) {
  return {
    code: coupon.code,
    kind: coupon.kind || "pct",
    amount: Number(coupon.amount || 0),
    min: Number(coupon.min || 0),
    once: Boolean(coupon.once),
    until: coupon.until || null,
    uses: Number(coupon.uses || 0),
    active: coupon.active !== false
  };
}
function rowZona(zona) {
  return {
    delivery_id: 1,
    km: Number(zona.km || 0),
    fee: Number(zona.fee || 0),
    min: Number(zona.min || 0)
  };
}
async function supabaseUpsert(table, rows, conflict) {
  if (!rows.length) return;
  await supabaseRequest(`/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
}
async function supabaseDeleteMissing(table, key, keepIds) {
  if (!keepIds.length) {
    await supabaseRequest(`/rest/v1/${table}?${key}=not.is.null`, { method: "DELETE" });
    return;
  }
  const codificados = keepIds.map(valor => String(valor).replace(/,/g, "\\,")).join(",");
  await supabaseRequest(`/rest/v1/${table}?${key}=not.in.(${codificados})`, { method: "DELETE" });
}
async function salvarEstadoLegacySupabase(snapshot) {
  const payload = estadoNormalizado(snapshot);
  await supabaseRequest(`/rest/v1/products?id=not.is.null`, { method: "DELETE" });
  await supabaseUpsert("products", payload.products.map(rowProducto), "id");

  await supabaseUpsert("orders", payload.orders.map(rowPedido), "id");

  await supabaseRequest(`/rest/v1/tables?n=not.is.null`, { method: "DELETE" });
  await supabaseUpsert("tables", payload.tables.map(rowMesa), "n");

  await supabaseRequest(`/rest/v1/promos?id=not.is.null`, { method: "DELETE" });
  await supabaseUpsert("promos", payload.promos.map(rowPromo), "id");

  await supabaseRequest(`/rest/v1/coupons?code=not.is.null`, { method: "DELETE" });
  await supabaseUpsert("coupons", payload.coupons.map(rowCupom), "code");

  await supabaseUpsert("delivery", [{ id: 1, endereco: payload.delivery.endereco || "", lng: payload.delivery.lng ?? null, lat: payload.delivery.lat ?? null }], "id");

  await supabaseRequest(`/rest/v1/delivery_zones?delivery_id=eq.1`, { method: "DELETE" });
  await supabaseUpsert("delivery_zones", payload.delivery.zones.map(rowZona), "delivery_id,km");
}
async function carregarEstadoSupabase() {
  try {
    const rows = await supabaseRequest(`/rest/v1/${SUPABASE_STATE_TABLE}?select=rev,payload&id=eq.1`, { method: "GET" });
    if (rows && Array.isArray(rows) && rows[0]) {
      supabasePersistMode = "state";
      const row = rows[0];
      return estadoNormalizado({ ...(row.payload || {}), rev: Number(row.rev ?? row.payload?.rev ?? 0) });
    }
  } catch (error) {
    if (!String(error.message || "").includes("app_state")) {
      console.log(`AVISO: Supabase indisponivel (${error.message}). Usando banco local.`);
      return null;
    }
  }
  const legado = await supabaseReadLegacyState().catch(error => {
    console.log(`AVISO: nao consegui ler as tabelas do Supabase (${error.message}).`);
    return null;
  });
  if (legado) {
    supabasePersistMode = "legacy";
    return legado;
  }
  supabasePersistMode = "legacy";
  return estadoNormalizado({ ...EMPTY, rev: 0 });
}
async function salvarEstadoSupabase(snapshot = snapshotState()) {
  const payload = estadoNormalizado(snapshot);
  if (supabasePersistMode === "legacy") {
    await salvarEstadoLegacySupabase(payload);
    return;
  }
  try {
    const body = [{ id: 1, rev: Number(payload.rev || 0), payload }];
    await supabaseRequest(`/rest/v1/${SUPABASE_STATE_TABLE}?on_conflict=id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (String(error.message || "").includes("app_state")) {
      supabasePersistMode = "legacy";
      await salvarEstadoLegacySupabase(payload);
      return;
    }
    throw error;
  }
}

function loadLocal() {
  const candidatos = [DATA_FILE, ...backupsMaisNovosPrimeiro()];
  for (const file of candidatos) {
    try {
      state = estadoNormalizado({ ...EMPTY, rev: 0, ...lerArquivo(file) });
      if (file !== DATA_FILE) {
        console.log(`AVISO: ${DATA_FILE} ilegivel. Restaurado de ${file}`);
        void gravar();   // reescreve ja: o arquivo quebrado nao pode continuar no disco
      }
      return;
    } catch (error) {
      if (fs.existsSync(file)) console.log(`AVISO: ${file} nao pode ser lido (${error.message})`);
    }
  }
  state = estadoNormalizado({ ...EMPTY, rev: 0 });
}

async function load() {
  if (SUPABASE_ON) {
    const remoto = await carregarEstadoSupabase();
    if (remoto) {
      state = remoto;
      return;
    }
  }
  loadLocal();
}

let saveTimer = null;
let backupDoDia = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Promise.resolve(gravar()).catch(error => {
      console.log(`AVISO: nao consegui gravar o estado (${error.message})`);
    });
  }, 120);
}
/* Grava em arquivo temporario e renomeia. O rename e atomico no mesmo disco:
 * ou o arquivo antigo continua inteiro, ou o novo esta completo. Nunca truncado. */
async function gravar() {
  if (SUPABASE_ON) {
    await salvarEstadoSupabase();
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const texto = JSON.stringify(state, null, 2);
  const temporario = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporario, texto, "utf8");
  fs.renameSync(temporario, DATA_FILE);

  const hoje = new Date().toISOString().slice(0, 10);
  if (backupDoDia === hoje) return;
  backupDoDia = hoje;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, `baixo-k-${hoje}.json`), texto, "utf8");
  backupsMaisNovosPrimeiro().slice(BACKUPS_MANTIDOS).forEach(velho => {
    try { fs.unlinkSync(velho); } catch {}
  });
}
function bump() {
  state.rev += 1;
  save();
  const line = `data: ${state.rev}\n\n`;
  listeners = listeners.filter(res => {
    try { res.write(line); return true; } catch { return false; }
  });
}

/* Mescla por chave em vez de substituir a lista inteira: um aparelho com a
 * copia atrasada nunca apaga o pedido que outro acabou de criar. */
function mergeBy(key, current, incoming) {
  const out = current.slice();
  incoming.forEach(row => {
    const at = out.findIndex(item => item[key] === row[key]);
    if (at >= 0) out[at] = { ...out[at], ...row };
    else out.push(row);
  });
  return out;
}

/* Coordenada valida, ou null.
 * Number(null) e Number("") valem 0, e 0 e um numero finito perfeitamente
 * valido — entao apagar o ponto da loja gravava lat 0, lng 0, que fica no
 * golfo da Guine. A partir dali toda distancia dava alguns milhares de km e
 * nenhum endereco do Rio caia em faixa nenhuma. */
function coordenada(valor, limite) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || Math.abs(numero) > limite) return null;
  return numero;
}

function applyPatch(patch) {
  if (Array.isArray(patch.orders)) state.orders = mergeBy("id", state.orders, patch.orders);
  if (Array.isArray(patch.products)) state.products = mergeBy("id", state.products, patch.products);
  if (Array.isArray(patch.tables)) state.tables = mergeBy("n", state.tables, patch.tables);
  // promos e cupons so mudam no painel, entao substituir e seguro e permite remover
  if (Array.isArray(patch.promos)) state.promos = patch.promos;
  if (Array.isArray(patch.coupons)) state.coupons = patch.coupons;
  if (Array.isArray(patch.removeTables)) {
    state.tables = state.tables.filter(table => !patch.removeTables.includes(table.n));
  }
  if (patch.delivery && typeof patch.delivery === "object") {
    state.delivery = {
      endereco: String(patch.delivery.endereco || "").slice(0, 200),
      lng: coordenada(patch.delivery.lng, 180),
      lat: coordenada(patch.delivery.lat, 90),
      zones: (Array.isArray(patch.delivery.zones) ? patch.delivery.zones : [])
        .map(z => ({ km: Number(z.km) || 0, fee: Number(z.fee) || 0, min: Number(z.min) || 0 }))
        .filter(z => z.km > 0)
        .sort((a, b) => a.km - b.km)
    };
  }
  bump();
}

function sendJson(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 5e6) reject(new Error("corpo grande demais"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

/* Nada aqui sai pela porta. Antes saia: `GET /data/senha.txt` devolvia a senha
 * do balcao em texto puro, e `/data/baixo-k.json` o cadastro inteiro com nome,
 * telefone e endereco de todo mundo que ja pediu. */
const PASTAS_PRIVADAS = new Set(["data", "node_modules", "backups"]);
const ARQUIVOS_PRIVADOS = new Set(["server.js", "package.json", "package-lock.json"]);

/* Resolve o que foi pedido para um caminho unico dentro da pasta do site, ou
 * null se escapar. Precisa acontecer ANTES de decidir se a pagina pede senha:
 * `/Admin.html`, `//admin.html` e `/%61dmin.html` chegam escritos diferente e
 * abrem o mesmo arquivo. Comparar o texto cru da URL deixava os tres passarem. */
function resolverCaminho(pathname) {
  let bruto;
  try {
    bruto = decodeURIComponent(pathname);
  } catch {
    return null;                                   // %zz invalido
  }
  if (bruto.includes("\0")) return null;
  // normalize resolve "..", "." e barras repetidas; a barra invertida vira barra
  const limpo = path.posix.normalize("/" + bruto.replace(/\\/g, "/")).replace(/^\/+/, "");
  const relativo = limpo === "" ? "index.html" : limpo;
  const arquivo = path.join(ROOT, relativo);
  /* ROOT + separador, e nao so ROOT: sem o separador uma pasta vizinha chamada
   * "Baixo Cais Antigo" passaria no teste de prefixo de "Baixo Cais". */
  if (!arquivo.startsWith(ROOT + path.sep)) return null;
  return { arquivo, relativo: relativo.toLowerCase() };
}
function ehPrivado(relativo) {
  const partes = relativo.split("/");
  if (partes.some(parte => parte.startsWith("."))) return true;      // .git, .env, .gitignore
  if (partes.some(parte => PASTAS_PRIVADAS.has(parte))) return true;
  if (ARQUIVOS_PRIVADOS.has(relativo)) return true;
  // so serve o que o site precisa: qualquer outra extensao fica de fora
  return !MIME[path.extname(relativo)];
}

function serveStatic(res, alvo) {
  fs.readFile(alvo.arquivo, (error, buffer) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("nao encontrado");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(alvo.relativo)] || "application/octet-stream",
      "Content-Length": buffer.length,
      // sem cache: toda edicao aparece com um F5, e o app pega versao nova na hora
      "Cache-Control": "no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      // o painel nunca deve abrir dentro de um iframe de outro site
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "same-origin"
    });
    res.end(buffer);
  });
}

/* O cliente do salao recebe cardapio e mesas, mas nunca a lista de pedidos:
 * ela carrega nome, telefone e endereco de todo mundo que ja pediu hoje. */
function estadoPara(balcao) {
  return balcao ? state : { ...state, orders: [] };
}

/* Pedido vindo do cliente: o servidor refaz o preco pelo proprio cadastro.
 * O que chega do navegador so diz o que foi pedido, nunca quanto custa. */
async function registrarPedido(corpo) {
  const pedido = corpo.order || {};
  const itens = Array.isArray(pedido.items) ? pedido.items : [];
  if (!itens.length) throw new Error("pedido sem itens");

  const mesa = corpo.tableNumber == null ? null : state.tables.find(t => t.n === Number(corpo.tableNumber));
  if (corpo.tableNumber != null && (!mesa || mesa.status !== "aberta")) {
    throw new Error("a comanda desta mesa nao esta aberta");
  }

  const conferidos = itens.map(item => {
    const produto = state.products.find(p => p.id === item.id);
    if (!produto) throw new Error(`produto fora do cardapio: ${item.name || item.id}`);
    if (produto.active === false) throw new Error(`${produto.name} esta pausado`);
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
    if (qty > Number(produto.stock || 0)) throw new Error(`${produto.name} sem estoque suficiente`);
    const promo = state.promos.find(p => p.productId === produto.id);
    return { id: produto.id, name: produto.name, qty, price: promo ? Number(promo.price) : Number(produto.price) };
  });

  const subtotal = conferidos.reduce((soma, item) => soma + item.price * item.qty, 0);
  let desconto = 0;
  const cupom = state.coupons.find(c => c.code === pedido.coupon && c.active);
  if (cupom && subtotal >= Number(cupom.min || 0)) {
    const bruto = cupom.kind === "pct" ? subtotal * (Number(cupom.amount) / 100) : Number(cupom.amount);
    desconto = Math.min(subtotal, Math.round(bruto * 100) / 100);
    cupom.uses = Number(cupom.uses || 0) + 1;
  }

  /* Entrega: o servidor geocodifica de novo o endereco que veio e refaz a conta.
   * Coordenada mandada pelo navegador nao entra: seria so trocar por uma perto
   * da loja para pagar frete de graca. */
  let entrega = { taxa: 0, km: null, zona: null };
  const ehEntrega = pedido.fulfillment === "entrega";
  if (ehEntrega && (state.delivery?.zones || []).length) {
    const achados = await geocodificar(pedido.place || "", { limitarNaArea: true });
    if (!achados.length) throw new Error("nao encontramos esse endereco");
    const calculo = taxaParaEndereco(pedido.place, achados[0]);
    if (!calculo.dentro) throw new Error(`endereco fora da area de entrega (${calculo.km} km da loja)`);
    if (subtotal - desconto < calculo.minimo) {
      throw new Error(`pedido minimo de R$ ${calculo.minimo.toFixed(2)} para entrega nessa faixa`);
    }
    entrega = { taxa: calculo.taxa, km: calculo.km, zona: calculo.zona };
  }

  /* Estoque baixa AQUI, no aceite, nao na entrega.
   * Antes so baixava quando alguem clicava "entregue" no painel. Com 18 pizzas
   * cadastradas, 18 clientes pediam 18 pizzas cada um e todos os pedidos eram
   * aceitos: a conferencia comparava com um estoque que nunca descia. A casa
   * vendia o que nao tinha e so descobria na hora de montar. */
  conferidos.forEach(item => {
    const produto = state.products.find(p => p.id === item.id);
    produto.stock = Math.max(0, Number(produto.stock || 0) - item.qty);
  });

  const novo = {
    id: `ped-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    createdAt: new Date().toISOString(),
    status: "novo",
    printed: false,
    stockDeducted: true,
    customer: String(pedido.customer || "Cliente").slice(0, 80),
    phone: String(pedido.phone || "").slice(0, 40),
    place: String(pedido.place || "").slice(0, 160),
    // numero e complemento vem separados: a distancia e medida pelo ponto que a
    // Mapbox devolveu, e "apto 302" no meio do texto so atrapalha a busca
    complemento: String(pedido.complemento || "").slice(0, 80),
    note: String(pedido.note || "").slice(0, 400),
    payment: String(pedido.payment || "").slice(0, 60),
    channel: "cardapio",
    fulfillment: ["retirada", "entrega", "mesa"].includes(pedido.fulfillment) ? pedido.fulfillment : "retirada",
    items: conferidos,
    subtotal,
    coupon: desconto ? cupom.code : "",
    discount: desconto,
    deliveryFee: entrega.taxa,
    deliveryKm: entrega.km,
    deliveryZone: entrega.zona,
    total: subtotal - desconto + entrega.taxa
  };
  state.orders = [novo, ...state.orders];
  if (mesa) mesa.items = [...(mesa.items || []), ...conferidos];
  bump();
  return novo;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);
  const balcao = ehBalcao(req);

  if (pathname === "/api/state") {
    return sendJson(res, 200, estadoPara(balcao));
  }

  if (pathname === "/api/me") {
    return sendJson(res, 200, { balcao });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    // 10 tentativas a cada 15 minutos por IP: o atendente que erra a senha nao
    // sente, e a varredura das 900 mil combinacoes deixa de ser viavel
    if (excedeu(`login:${ipDe(req)}`, 10, 15 * 60 * 1000)) {
      return sendJson(res, 429, { erro: "Muitas tentativas. Espere 15 minutos." });
    }
    const corpo = await readBody(req).catch(() => ({}));
    if (!senhaConfere(corpo.senha || "", senhaDaLoja())) {
      return sendJson(res, 401, { erro: "Senha incorreta." });
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessoes.set(token, Date.now() + SESSAO_MS);
    gravarSessoes();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      // Secure so quando ha TLS: em http o navegador descartaria o cookie
      "Set-Cookie": `bk_sessao=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSAO_MS / 1000}${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`,
      "Cache-Control": "no-store"
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    const cookie = (req.headers.cookie || "").split(";").map(p => p.trim()).find(p => p.startsWith("bk_sessao="));
    if (cookie) { sessoes.delete(cookie.slice("bk_sessao=".length)); gravarSessoes(); }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": "bk_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      "Cache-Control": "no-store"
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (pathname === "/api/order" && req.method === "POST") {
    try {
      return sendJson(res, 200, { pedido: await registrarPedido(await readBody(req)), estado: estadoPara(false) });
    } catch (error) {
      return sendJson(res, 400, { erro: error.message });
    }
  }

  /* Busca de endereco e mapa passam pelo servidor: o token nunca vai ao navegador.
   * Com limite por IP - sem ele, o endereco publico do site vira um servico de
   * geocodificacao de graca e as 100 mil buscas do mes acabam num dia. */
  if (pathname === "/api/entrega/buscar") {
    if (excedeu(`geo:${ipDe(req)}`, 120, 60 * 60 * 1000)) {
      return sendJson(res, 429, { erro: "muitas buscas seguidas, tente daqui a pouco" });
    }
    const q = (url.parse(req.url, true).query.q || "").toString().trim();
    if (q.length < 3) return sendJson(res, 200, { resultados: [] });
    try {
      // ?escopo=loja e a busca do endereco da propria loja, no painel: sem bbox
      const escopo = (url.parse(req.url, true).query.escopo || "").toString();
      return sendJson(res, 200, { resultados: await geocodificar(q, { limitarNaArea: escopo !== "loja" }) });
    } catch (error) {
      return sendJson(res, 502, { erro: error.message });
    }
  }

  /* Isto e uma previa mostrada no carrinho, nao o valor cobrado. Por isso pode
   * partir da coordenada que o widget do navegador escolheu: se alguem forjar
   * uma coordenada perto da loja, so engana a propria tela - na hora de fechar
   * o pedido o servidor geocodifica o endereco de novo e refaz a conta. */
  if (pathname === "/api/entrega/taxa") {
    if (excedeu(`taxa:${ipDe(req)}`, 120, 60 * 60 * 1000)) {
      return sendJson(res, 429, { erro: "muitas consultas seguidas, tente daqui a pouco" });
    }
    const busca = url.parse(req.url, true).query;
    const q = (busca.q || "").toString().trim();
    const lng = Number(busca.lng);
    const lat = Number(busca.lat);
    if (q.length < 3) return sendJson(res, 400, { erro: "endereco muito curto" });
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return sendJson(res, 200, taxaParaEndereco(q, { lng, lat }));
    }
    try {
      const achados = await geocodificar(q, { limitarNaArea: true });
      if (!achados.length) return sendJson(res, 404, { erro: "endereco nao encontrado" });
      return sendJson(res, 200, taxaParaEndereco(q, achados[0]));
    } catch (error) {
      return sendJson(res, 502, { erro: error.message });
    }
  }

  if (pathname === "/api/entrega/mapa") {
    const token = tokenMapbox();
    const loja = state.delivery || {};
    if (!token || loja.lng == null) return sendJson(res, 404, { erro: "mapa indisponivel" });
    const raios = (loja.zones || []).map(z => Number(z.km)).filter(Boolean);
    const zoom = raios.length ? Math.max(9, 14 - Math.log2(Math.max(...raios) || 1)) : 14;
    const pino = `pin-l-restaurant+c97443(${loja.lng},${loja.lat})`;
    const alvo = `${MAPBOX_API}/styles/v1/mapbox/dark-v11/static/${pino}/${loja.lng},${loja.lat},${zoom.toFixed(1)}/640x420@2x?access_token=${token}&attribution=true&logo=true`;
    try {
      const imagem = await requestExterno(alvo, { method: "GET", responseType: "buffer" });
      if (imagem.status < 200 || imagem.status >= 300) return sendJson(res, 502, { erro: `Mapbox respondeu ${imagem.status}` });
      const buffer = Buffer.from(imagem.body);
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buffer.length, "Cache-Control": "no-store" });
      return res.end(buffer);
    } catch (error) {
      return sendJson(res, 502, { erro: error.message });
    }
  }

  if (pathname === "/api/entrega/status") {
    const loja = state.delivery || {};
    return sendJson(res, 200, {
      configurado: Boolean(tokenMapbox()),
      // vazio quando o token e secreto: ai o navegador usa a busca via servidor
      token: tokenPublico(),
      origem: MAPBOX_API,
      loja: loja.lng != null ? { lng: loja.lng, lat: loja.lat } : null
    });
  }

  /* — busca do widget, atendida aqui —
   *
   * O widget de endereco da Mapbox chama `{origin}/geocoding/v5/mapbox.places/
   * {busca}.json`. Apontando o `origin` para o proprio site, essa chamada cai
   * aqui em vez de ir para a Mapbox, e passa a usar exatamente o mesmo caminho
   * que o servidor usa para conferir o pedido: ViaCEP para CEP, bbox da area,
   * proximity na loja.
   *
   * Motivo: falando direto com a Mapbox, o widget nao tinha o ViaCEP. CEP
   * brasileiro devolvia zero resultado na caixa de busca do cliente — medido:
   * 20081-262, 20220-460 e 22010-000, todos vazios — enquanto o servidor,
   * pelo mesmo CEP, achava a rua sem dificuldade. O cliente digitava o CEP,
   * nao vinha nada, e ele concluia que a loja nao entrega nele.
   *
   * De quebra o token deixa de ser necessario no navegador para a busca. */
  if (pathname.startsWith("/geocoding/v5/")) {
    if (excedeu(`geo:${ipDe(req)}`, 300, 60 * 60 * 1000)) {
      return sendJson(res, 429, { message: "muitas buscas seguidas" });
    }
    const bruto = decodeURIComponent(pathname.split("/").pop().replace(/\.json$/, ""));
    if (bruto.trim().length < 3) return sendJson(res, 200, { type: "FeatureCollection", query: [bruto], features: [] });
    try {
      const achados = await geocodificar(bruto, { limitarNaArea: true });
      return sendJson(res, 200, {
        type: "FeatureCollection",
        query: [bruto],
        attribution: "Mapbox",
        // o widget espera o formato da v5, que e diferente do da v6
        features: achados.map((r, i) => ({
          id: `address.${i}`,
          type: "Feature",
          place_type: ["address"],
          relevance: 1,
          properties: {},
          text: r.nome,
          place_name: [r.nome, r.detalhe].filter(Boolean).join(", "),
          center: [r.lng, r.lat],
          geometry: { type: "Point", coordinates: [r.lng, r.lat] }
        }))
      });
    } catch (error) {
      return sendJson(res, 502, { message: error.message });
    }
  }

  if (pathname === "/api/patch" && req.method === "POST") {
    if (!balcao) return sendJson(res, 401, { erro: "precisa entrar com a senha da loja" });
    try {
      applyPatch(await readBody(req));
      return sendJson(res, 200, state);
    } catch (error) {
      return sendJson(res, 400, { erro: error.message });
    }
  }

  if (pathname === "/api/events") {
    // teto de conexoes: cada aba aberta segura uma, e sem limite uma so
    // maquina derrubaria o servidor abrindo milhares
    if (listeners.length >= MAX_OUVINTES) return sendJson(res, 503, { erro: "muitas conexoes abertas" });
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive"
    });
    res.write(`data: ${state.rev}\n\n`);
    listeners.push(res);
    req.on("close", () => { listeners = listeners.filter(item => item !== res); });
    return;
  }

  if (pathname.startsWith("/api/")) return sendJson(res, 404, { erro: "rota desconhecida" });

  /* Daqui para baixo e arquivo. Resolver primeiro, decidir depois: e o que
   * impede /Admin.html e //admin.html de pularem a senha. */
  const alvo = resolverCaminho(pathname);
  if (!alvo || ehPrivado(alvo.relativo)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("nao encontrado");
    return;
  }
  if (PAGINAS_RESTRITAS.has(alvo.relativo) && !balcao) {
    return serveStatic(res, { arquivo: path.join(ROOT, "entrar.html"), relativo: "entrar.html" });
  }
  serveStatic(res, alvo);
});

/* Um comentario a cada 25s segura o SSE de pe. Sem isso, wifi de loja, NAT e
 * proxy fecham a conexao por ociosidade e o tablet da cozinha para de receber
 * pedido sem dar nenhum sinal de que parou. */
setInterval(() => {
  listeners = listeners.filter(res => {
    try { res.write(": ping\n\n"); return true; } catch { return false; }
  });
}, 25000).unref();
setInterval(() => {
  limparSessoes();
  const agora = Date.now();
  tentativas.forEach((registro, chave) => { if (agora > registro.ate) tentativas.delete(chave); });
}, 60 * 60 * 1000).unref();

// grava o que estiver pendente antes de sair, em vez de perder os ultimos 120ms
["SIGINT", "SIGTERM"].forEach(sinal => process.on(sinal, () => {
  Promise.resolve(gravar()).catch(() => {}).finally(() => process.exit(0));
}));

(async () => {
  await load();
  carregarSessoes();
  server.listen(PORT, () => {
    const senha = senhaDaLoja();
    console.log(`Baixo K rodando em http://localhost:${PORT}`);
    console.log(SUPABASE_ON ? "Estado compartilhado no Supabase" : `Estado compartilhado em ${DATA_FILE}`);
    console.log(`Senha do balcao: ${senha}`);
    if (!process.env.BAIXOK_SENHA) console.log(`(guardada em ${SENHA_FILE} - troque com a variavel BAIXOK_SENHA)`);
  });
})().catch(error => {
  console.error("Falha ao iniciar o servidor:", error);
  process.exit(1);
});
