const CACHE_NAME = "baixo-k-v23";
const ASSETS = [
  "./",
  "./index.html",
  "./admin.html",
  "./telao.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./images/baixok-logo-v2.png",
  "./images/loja-baixo-k-hero.png",
  "./images/produto-pizza.png",
  "./images/produto-burguer.png",
  "./images/produto-massa.png",
  "./images/produto-drinks.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

// Rede primeiro: a loja sempre recebe a versao publicada mais recente.
// O cache fica como reserva para quando a conexao cair, mantendo o app offline.
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const alvo = new URL(event.request.url);
  if (alvo.origin !== self.location.origin) return;
  /* Dado nao entra no cache do app. Sao respostas de consulta, nao arquivos do
   * site: guardar busca de endereco encheria o cache de resultado de pesquisa,
   * e servir estado antigo offline seria pior do que falhar. */
  if (alvo.pathname.startsWith("/api/") || alvo.pathname.startsWith("/geocoding/")) return;
  // cache: "no-store" pula o cache HTTP do navegador, que pode segurar
  // um CSS/JS antigo por conta propria e mascarar uma publicacao nova
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
  );
});
