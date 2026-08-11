/* Montagem do Express. */
import path from "node:path";
import fs from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "./config/env.js";
import { rotasApi } from "./routes/index.js";
import { carregarSessao } from "./middlewares/auth.js";
import { exigirCsrf } from "./middlewares/csrf.js";
import { limiteGeral } from "./middlewares/rateLimit.js";
import { rotaNaoEncontrada, tratarErro } from "./middlewares/errorHandler.js";
import { logger } from "./lib/logger.js";

const PASTA_FRONT = path.resolve(env.RAIZ_BACKEND, "..", "frontend", "dist");

/* Paginas que exigem sessao. Continuam sendo barradas no servidor, e nao so
 * escondidas pelo JavaScript da propria pagina: sem isso, salvar o HTML e abrir
 * offline ja mostraria a interface do painel. O portao de verdade e a API, mas
 * nao ha razao para entregar a tela. */
const PAGINAS_RESTRITAS = new Set(["/admin.html", "/admin", "/telao.html", "/telao"]);

export function criarApp() {
  const app = express();

  /* Sem isto, `req.ip` devolve o IP do proxy para todo mundo e o limite por IP
   * trava a loja inteira quando um cliente erra a senha. Ligar sem proxy na
   * frente e pior: quem chama direto forja X-Forwarded-For e escapa do limite. */
  app.set("trust proxy", env.TRUST_PROXY ? 1 : false);
  app.disable("x-powered-by");

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        /* Sem 'unsafe-inline'. E o que a remocao dos onclick= do HTML comprou:
         * com a politica assim, um nome de produto com <script> dentro deixa de
         * poder executar qualquer coisa. */
        scriptSrc: ["'self'", "https://api.mapbox.com"],
        /* Os estilos do Google Fonts e do widget da Mapbox entram por <link>;
         * 'unsafe-inline' aqui e para o atributo style que o widget injeta. */
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://api.mapbox.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https://api.mapbox.com"],
        connectSrc: ["'self'", "https://api.mapbox.com", "https://events.mapbox.com"],
        workerSrc: ["'self'", "blob:"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(env.COOKIE_SECURE ? { upgradeInsecureRequests: [] } : {})
      }
    },
    /* Desligado: quebraria o carregamento das fontes e do widget da Mapbox. */
    crossOriginEmbedderPolicy: false,
    /* HSTS so faz sentido com TLS de verdade na frente. */
    hsts: env.COOKIE_SECURE ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: "same-origin" }
  }));

  /* Em dev o Vite roda em outra porta; em producao o front sai deste mesmo
   * servidor e nao ha CORS nenhum para liberar. */
  if (env.CORS_ORIGIN) {
    app.use((req, res, next) => {
      const origem = req.headers.origin;
      if (origem && env.CORS_ORIGIN.split(",").map(item => item.trim()).includes(origem)) {
        res.set("Access-Control-Allow-Origin", origem);
        res.set("Access-Control-Allow-Credentials", "true");
        res.set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
        res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.set("Vary", "Origin");
      }
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });
  }

  /* Teto de 1 MB: o unico corpo grande legitimo e a foto de produto em data URL,
   * que o schema ja limita em 500 KB. O antigo aceitava 5 MB em qualquer rota. */
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(limiteGeral);
  app.use(carregarSessao);
  app.use(exigirCsrf);

  app.use("/api", rotasApi);
  app.use("/api", rotaNaoEncontrada);

  // ------------------------------------------------------------- front-end ---
  if (fs.existsSync(PASTA_FRONT)) {
    app.get(["/admin", "/admin.html", "/telao", "/telao.html"], (req, res, next) => {
      if (req.usuario) return next();
      res.set("Cache-Control", "no-store, must-revalidate");
      res.sendFile(path.join(PASTA_FRONT, "entrar.html"));
    });

    app.use(express.static(PASTA_FRONT, {
      /* index.html e as demais paginas nao podem ficar em cache: uma publicacao
       * nova precisa aparecer com um F5. Os assets do Vite trazem hash no nome,
       * entao podem ser guardados por muito tempo. */
      setHeaders: (res, caminho) => {
        if (caminho.endsWith(".html")) res.set("Cache-Control", "no-store, must-revalidate");
        else if (caminho.includes("/assets/")) res.set("Cache-Control", "public, max-age=31536000, immutable");
        /* Sem isto o service worker cai no cache padrao da CDN (Cloudflare, no
         * Square Cloud) e uma correcao nele pode demorar dias para chegar ao
         * navegador do cliente. */
        else if (caminho.endsWith("service-worker.js")) res.set("Cache-Control", "no-store, must-revalidate");
      }
    }));

    app.use((req, res) => {
      if (PAGINAS_RESTRITAS.has(req.path) && !req.usuario) {
        res.set("Cache-Control", "no-store, must-revalidate");
        return res.sendFile(path.join(PASTA_FRONT, "entrar.html"));
      }
      res.status(404).sendFile(path.join(PASTA_FRONT, "index.html"));
    });
  } else {
    logger.warn("frontend/dist nao encontrado. Rode `npm run build` para servir o site pelo backend.");
    app.use((_req, res) => res.status(404).json({ erro: "Front-end nao compilado. Rode npm run build." }));
  }

  app.use(tratarErro);
  return app;
}
