/* Mapa das rotas da API.
 *
 * Tres grupos, com fronteira de acesso explicita:
 *   /api/publico  - aberto, sem sessao
 *   /api/auth     - login e sessao
 *   /api/painel   - exige sessao; o papel e checado rota a rota
 *   /api/eventos  - SSE, canal conforme o publico
 */
import { Router } from "express";
import { rotasPublicas } from "./publico.routes.js";
import { rotasAuth } from "./auth.routes.js";
import { rotasPainel } from "./painel.routes.js";
import { rotasEventos } from "./eventos.routes.js";
import { totalOuvintes } from "../lib/events.js";
import { todos } from "../db/postgres.js";

export const rotasApi = Router();

/* Continua sempre 200/ok:true — nao mexe aqui porque o proprio host (Square
 * Cloud) pode estar usando esta rota como sinal de "container vivo, nao
 * precisa reiniciar". Trocar pra 503 quando o banco cair transformaria uma
 * lentidao passageira do Postgres numa queda forcada do processo pelo host,
 * o oposto do que se quer. */
rotasApi.get("/saude", (_req, res) => res.json({
  ok: true,
  versao: process.env.npm_package_version || "2.0.0",
  ouvintes: totalOuvintes()
}));

/* Rota separada, so pra quem quer monitorar de fora (UptimeRobot e afins) e
 * precisa saber se o banco tambem esta respondendo, nao so o processo Node.
 * Teto de 3s: banco travado nao pode deixar o healthcheck pendurado. */
rotasApi.get("/saude/banco", async (_req, res) => {
  const inicio = Date.now();
  try {
    await Promise.race([
      todos("SELECT 1"),
      new Promise((_resolve, rejeitar) => setTimeout(() => rejeitar(new Error("timeout")), 3000))
    ]);
    res.json({ ok: true, banco: true, latenciaMs: Date.now() - inicio });
  } catch (erro) {
    res.status(503).json({ ok: false, banco: false, erro: erro.message });
  }
});

rotasApi.use("/publico", rotasPublicas);
rotasApi.use("/auth", rotasAuth);
rotasApi.use("/painel", rotasPainel);
rotasApi.use("/eventos", rotasEventos);
