/* Service worker do cardapio.
 *
 * Duas mudancas importantes em relacao ao anterior:
 *
 * 1. NADA de /api/ entra no cache. O anterior guardava toda resposta GET de
 *    mesma origem — e /api/state era GET. Resultado: o navegador do cliente
 *    ficava com uma copia do estado da loja no cache do disco, sobrevivendo ao
 *    fechamento da aba.
 *
 * 2. admin.html e telao.html sairam da lista de pre-cache. Sao paginas
 *    protegidas por sessao: guardar o HTML delas no aparelho de um cliente nao
 *    tem proposito nenhum.
 */
const CACHE = "baixok-v5";

/* So o esqueleto do cardapio. Os assets com hash no nome sao guardados sob
 * demanda, na primeira visita. */
const ESSENCIAIS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/images/baixok-logo-v2.png"
];

self.addEventListener("install", evento => {
  evento.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ESSENCIAIS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", evento => {
  evento.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(chave => chave !== CACHE).map(chave => caches.delete(chave))))
      .then(() => self.clients.claim())
  );
});

function podeGuardar(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;          // dado, nunca cache
  if (url.pathname.startsWith("/admin")) return false;         // pagina protegida
  if (url.pathname.startsWith("/telao")) return false;
  if (url.pathname.startsWith("/entrar")) return false;
  return true;
}

/* Rede primeiro, cache como reserva: a loja sempre recebe a versao publicada
 * mais recente, e o cardapio continua abrindo com a conexao caida. */
self.addEventListener("fetch", evento => {
  if (evento.request.method !== "GET") return;

  const url = new URL(evento.request.url);
  if (!podeGuardar(url)) return;      // deixa passar direto para a rede

  evento.respondWith(
    fetch(evento.request)
      .then(resposta => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE).then(cache => cache.put(evento.request, copia)).catch(() => {});
        }
        return resposta;
      })
      .catch(() => caches.match(evento.request).then(guardada => guardada || caches.match("/index.html")))
  );
});
