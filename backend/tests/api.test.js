/* Testes de integracao das regras que sustentam a seguranca do sistema.
 *
 * Cada bloco aqui corresponde a um problema real do sistema antigo. Sao testes
 * de regressao: se alguem reabrir um desses buracos numa refatoracao futura, a
 * suite acusa. */
import test from "node:test";
import assert from "node:assert/strict";
import { prepararSchema, temBancoDeTeste, AVISO_SEM_BANCO } from "./apoio/banco.js";

/* Sem Postgres de teste nao ha o que exercitar: a suite inteira e de
 * integracao contra o banco de verdade. Pular avisando e melhor do que falhar
 * com erro de conexao, que nao diz o que fazer. */
if (!temBancoDeTeste) {
  test("suite de API", { skip: AVISO_SEM_BANCO }, () => {});
  process.exit(0);
}

/* O modulo de configuracao le process.env na importacao, entao o ambiente
 * precisa estar montado antes de qualquer import da aplicacao. */
const banco = await prepararSchema("api");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "senha-do-teste-1234";
/* PORT nao entra aqui: o teste chama listen(0) direto e deixa o sistema
 * escolher a porta, entao o schema continua exigindo porta valida em producao. */

/* A suite dispara dezenas de pedidos do mesmo IP e bateria no teto de producao.
 * Afrouxamos o limite de pedido e mantemos o de login apertado, para o teste
 * "forca bruta e barrada" continuar exercitando o mecanismo de verdade. */
process.env.LIMITE_PEDIDO = "500";
process.env.LIMITE_GERAL = "5000";
process.env.LIMITE_LOGIN = "10";

const { abrirPool, fecharPool } = await import("../src/db/postgres.js");
const { migrar } = await import("../src/db/migrate.js");
const { semear } = await import("../src/db/seed.js");
const { criarApp } = await import("../src/app.js");
const { usuariosService } = await import("../src/services/usuarios.service.js");
const { produtosRepo } = await import("../src/repositories/produtos.repo.js");
const { cuponsRepo } = await import("../src/repositories/cupons.repo.js");
const { mesasRepo } = await import("../src/repositories/mesas.repo.js");

abrirPool();
await migrar();
await semear({ silencioso: true });

const admin = { id: 1, usuario: "admin" };
await usuariosService.criar(
  { usuario: "caixa1", nome: "Caixa", senha: "senha-do-caixa-1234", papel: "caixa" },
  { usuario: admin, ip: "teste" }
);
await usuariosService.criar(
  { usuario: "cozinha1", nome: "Cozinha", senha: "senha-cozinha-1234", papel: "cozinha" },
  { usuario: admin, ip: "teste" }
);
await usuariosService.criar(
  { usuario: "entrega1", nome: "Entregador", senha: "senha-entrega-1234", papel: "entregador" },
  { usuario: admin, ip: "teste" }
);

const servidor = criarApp().listen(0);
await new Promise(resolve => servidor.once("listening", resolve));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

test.after(async () => {
  servidor.close();
  await fecharPool();
  await banco.derrubar();
});

// ------------------------------------------------------------------ auxiliar ---
async function chamar(caminho, { metodo = "GET", corpo, sessao } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (sessao) {
    headers.Cookie = sessao.cookie;
    headers["X-CSRF-Token"] = sessao.csrf;
  }
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers,
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await resposta.text();
  return {
    status: resposta.status,
    headers: resposta.headers,
    corpo: texto ? JSON.parse(texto) : null
  };
}

async function entrar(usuario, senha) {
  const resposta = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, senha })
  });
  assert.equal(resposta.status, 200, `login de ${usuario} deveria funcionar`);
  const cookies = resposta.headers.getSetCookie();
  const pegar = nome => cookies.find(item => item.startsWith(`${nome}=`))?.split(";")[0].split("=")[1];
  return {
    cookie: cookies.map(item => item.split(";")[0]).join("; "),
    csrf: decodeURIComponent(pegar("bk_csrf"))
  };
}

const sessaoAdmin = await entrar("admin", "senha-do-teste-1234");
const sessaoCaixa = await entrar("caixa1", "senha-do-caixa-1234");
const sessaoCozinha = await entrar("cozinha1", "senha-cozinha-1234");
const sessaoEntregador = await entrar("entrega1", "senha-entrega-1234");
await chamar("/api/painel/caixa/abrir", {
  metodo: "POST",
  sessao: sessaoAdmin,
  corpo: { senha: "senha-do-teste-1234" }
});

// ===================================================== superficie publica ===
test("cardapio publico nao vaza cupons, estoque nem faixas de entrega", async () => {
  await cuponsRepo.criar({ code: "SECRETO50", kind: "pct", amount: 50, min: 0, once: false, until: "" });

  const { status, corpo } = await chamar("/api/publico/cardapio");
  assert.equal(status, 200);

  const serializado = JSON.stringify(corpo);
  assert.ok(!serializado.includes("SECRETO50"), "codigo de cupom nao pode aparecer no cardapio publico");
  assert.ok(!("cupons" in corpo), "resposta publica nao deve ter colecao de cupons");
  assert.ok(!("orders" in corpo) && !("pedidos" in corpo), "resposta publica nao deve ter pedidos");

  for (const produto of corpo.produtos) {
    assert.ok(!("stock" in produto), "quantidade em estoque e dado de operacao");
    assert.ok(!("minStock" in produto), "estoque minimo e dado de operacao");
  }
  /* Faixas com taxa e pedido minimo ficam no painel; o publico so sabe se ha
   * entrega e ate onde. */
  assert.ok(!("zones" in corpo.entrega), "faixas de entrega nao vao para o publico");
});

test("nao existe rota publica que liste cupons", async () => {
  assert.equal((await chamar("/api/publico/cupons")).status, 404);
  assert.equal((await chamar("/api/painel/cupons")).status, 401);
});

test("telao nao expoe telefone nem endereco do cliente", async () => {
  const { corpo } = await chamar("/api/eventos/telao/fila", { sessao: sessaoAdmin });
  const serializado = JSON.stringify(corpo);
  assert.ok(!serializado.includes("phone"), "telao nao deve carregar telefone");
  assert.ok(!serializado.includes("place"), "telao nao deve carregar endereco");
});

// ============================================== preco vem sempre do servidor ===
test("preco enviado pelo cliente e ignorado", async () => {
  const produto = (await produtosRepo.listar())[0];

  const { status, corpo } = await chamar("/api/publico/pedidos", {
    metodo: "POST",
    corpo: {
      customer: "Cliente Teste",
      items: [{ id: produto.id, qty: 2, price: 0.01, name: "Pizza de graca" }],
      fulfillment: "retirada"
    }
  });

  /* O schema e `.strict()`: campo desconhecido derruba a requisicao em vez de
   * ser silenciosamente ignorado. Qualquer um dos dois desfechos e seguro. */
  if (status === 201) {
    assert.equal(corpo.pedido.items[0].price, produto.price, "o preco tem que vir do cadastro");
    assert.equal(corpo.pedido.total, produto.price * 2);
  } else {
    assert.equal(status, 422, "campo extra deve ser recusado pela validacao");
  }
});

test("pedido acima do estoque e recusado e nao deixa baixa pela metade", async () => {
  const produto = (await produtosRepo.listar()).find(item => item.category === "drinks" && item.stock > 0);
  const estoqueAntes = (await produtosRepo.buscar(produto.id)).stock;

  const { status, corpo } = await chamar("/api/publico/pedidos", {
    metodo: "POST",
    corpo: {
      customer: "Cliente Guloso",
      items: [{ id: produto.id, qty: estoqueAntes + 50 }],
      fulfillment: "retirada"
    }
  });

  assert.equal(status, 409);
  assert.equal(corpo.codigo, "estoque_insuficiente");
  assert.equal((await produtosRepo.buscar(produto.id)).stock, estoqueAntes, "estoque nao pode mudar num pedido recusado");
});

test("pedidos simultaneos nao vendem alem do estoque", async () => {
  const produto = await produtosRepo.criar({
    id: "teste-corrida", name: "Item Escasso", category: "drinks", price: 10,
    stock: 5, minStock: 0, active: true, image: "", badge: "Teste", description: ""
  });

  /* Dez pedidos de uma unidade contra um estoque de cinco. No sistema antigo a
   * conferencia e a baixa ficavam separadas por um await, e todos passavam. */
  const respostas = await Promise.all(
    Array.from({ length: 10 }, () => chamar("/api/publico/pedidos", {
      metodo: "POST",
      corpo: { customer: "Corrida", items: [{ id: produto.id, qty: 1 }], fulfillment: "retirada" }
    }))
  );

  const aceitos = respostas.filter(resposta => resposta.status === 201).length;
  assert.equal(aceitos, 5, `deveriam passar exatamente 5 pedidos, passaram ${aceitos}`);
  assert.equal((await produtosRepo.buscar(produto.id)).stock, 0);
});

test("comida ativa nao depende do estoque operacional", async () => {
  const produto = await produtosRepo.criar({
    id: "teste-pizza-sem-estoque", name: "Pizza Sem Estoque Operacional", category: "pizzas", price: 35,
    stock: 0, minStock: 0, active: true, image: "", badge: "Pizza", description: ""
  });

  const cardapio = await chamar("/api/publico/cardapio");
  assert.equal(cardapio.status, 200);
  assert.ok(cardapio.corpo.produtos.some(item => item.id === produto.id), "comida ativa continua no cardapio");

  const pedido = await chamar("/api/publico/pedidos", {
    metodo: "POST",
    corpo: { customer: "Cliente", items: [{ id: produto.id, qty: 2 }], fulfillment: "retirada" }
  });
  assert.equal(pedido.status, 201);
  assert.equal((await produtosRepo.buscar(produto.id)).stock, 0);
});

test("pedido em mesa fechada e recusado", async () => {
  const produto = (await produtosRepo.listar())[0];
  const mesaFechada = (await mesasRepo.listar()).find(mesa => mesa.status === "livre");

  const { status, corpo } = await chamar("/api/publico/pedidos", {
    metodo: "POST",
    corpo: {
      customer: "Cliente", items: [{ id: produto.id, qty: 1 }],
      fulfillment: "mesa", tableNumber: mesaFechada.n
    }
  });
  assert.equal(status, 409);
  assert.equal(corpo.codigo, "mesa_fechada");
});

// ============================================ autenticacao e autorizacao ===
test("painel nao responde sem sessao", async () => {
  for (const rota of ["/api/painel/pedidos", "/api/painel/produtos", "/api/painel/relatorios/dashboard", "/api/painel/usuarios"]) {
    const { status } = await chamar(rota);
    assert.equal(status, 401, `${rota} deveria exigir login`);
  }
});

test("localizacao do motoboy separa aparelhos do mesmo login", async () => {
  for (const [deviceId, deviceName, lat] of [
    ["celular-1", "Celular da rota", -22.897],
    ["celular-2", "Segundo aparelho", -22.898]
  ]) {
    const envio = await chamar("/api/painel/motoboys/localizacao", {
      metodo: "POST",
      sessao: sessaoEntregador,
      corpo: { lat, lng: -43.187, accuracy: 8, deviceId, deviceName }
    });
    assert.equal(envio.status, 200);
  }

  const { status, corpo } = await chamar("/api/painel/motoboys/localizacoes", { sessao: sessaoAdmin });
  assert.equal(status, 200);
  const ids = corpo.localizacoes.map(item => item.deviceId);
  assert.ok(ids.includes("celular-1"));
  assert.ok(ids.includes("celular-2"));
});

test("cozinha nao cancela pedido nem mexe em preco", async () => {
  const cancelar = await chamar("/api/painel/pedidos/qualquer/cancelar", {
    metodo: "POST", corpo: { motivo: "teste" }, sessao: sessaoCozinha
  });
  assert.equal(cancelar.status, 403);

  const preco = await chamar("/api/painel/produtos", {
    metodo: "POST", sessao: sessaoCozinha,
    corpo: { name: "Hack", category: "pizzas", price: 1, stock: 1, minStock: 1, active: true, image: "", description: "" }
  });
  assert.equal(preco.status, 403);
});

test("caixa nao muda preco, nao ve faturamento e nao lista cupons", async () => {
  const produto = (await produtosRepo.listar())[0];

  const alterar = await chamar(`/api/painel/produtos/${produto.id}`, {
    metodo: "PUT", sessao: sessaoCaixa,
    corpo: { ...produto, price: 0.5, description: produto.description || "" }
  });
  assert.equal(alterar.status, 403);

  assert.equal((await chamar("/api/painel/relatorios/dashboard", { sessao: sessaoCaixa })).status, 403);
  assert.equal((await chamar("/api/painel/cupons", { sessao: sessaoCaixa })).status, 403);
});

test("caixa faz o trabalho dele: estoque, mesas e lancamento manual", async () => {
  const produto = (await produtosRepo.listar())[0];

  const estoque = await chamar(`/api/painel/produtos/${produto.id}/estoque`, {
    metodo: "PATCH", corpo: { delta: 3 }, sessao: sessaoCaixa
  });
  assert.equal(estoque.status, 200);

  const mesa = (await mesasRepo.listar())[0];
  assert.equal((await chamar(`/api/painel/mesas/${mesa.n}/abrir`, { metodo: "POST", sessao: sessaoCaixa })).status, 200);
});

test("ninguem se promove sozinho", async () => {
  const caixa = (await usuariosService.listar()).find(item => item.usuario === "caixa1");
  const { status } = await chamar(`/api/painel/usuarios/${caixa.id}`, {
    metodo: "PATCH", corpo: { papel: "admin" }, sessao: sessaoCaixa
  });
  assert.equal(status, 403, "caixa nao pode chegar na rota de usuarios");
});

test("o ultimo administrador nao pode ser rebaixado", async () => {
  const { status, corpo } = await chamar("/api/painel/usuarios/1", {
    metodo: "PATCH", corpo: { ativo: false }, sessao: sessaoAdmin
  });
  assert.equal(status, 409);
  assert.match(corpo.erro, /unico administrador/i);
});

test("login errado nao revela se o usuario existe", async () => {
  const inexistente = await chamar("/api/auth/login", {
    metodo: "POST", corpo: { usuario: "naoexiste", senha: "chute-errado-123" }
  });
  const senhaErrada = await chamar("/api/auth/login", {
    metodo: "POST", corpo: { usuario: "admin", senha: "chute-errado-123" }
  });
  assert.equal(inexistente.status, 401);
  assert.equal(senhaErrada.status, 401);
  assert.equal(inexistente.corpo.erro, senhaErrada.corpo.erro, "as duas mensagens tem que ser iguais");
});

test("cookie de sessao e HttpOnly", async () => {
  const resposta = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "admin", senha: "senha-do-teste-1234" })
  });
  const sessao = resposta.headers.getSetCookie().find(item => item.startsWith("bk_sessao="));
  assert.match(sessao, /HttpOnly/i, "a sessao nao pode ser legivel por JavaScript");
  assert.match(sessao, /SameSite=Lax/i);
});

// ========================================================= CSRF e validacao ===
test("escrita sem token CSRF e recusada", async () => {
  const resposta = await fetch(`${BASE}/api/painel/mesas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessaoAdmin.cookie }
  });
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).codigo, "csrf_ausente");
});

test("token CSRF de outra sessao nao serve", async () => {
  const resposta = await fetch(`${BASE}/api/painel/mesas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessaoAdmin.cookie,
      "X-CSRF-Token": sessaoCaixa.csrf
    }
  });
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).codigo, "csrf_invalido");
});

test("validacao recusa entrada malformada", async () => {
  const casos = [
    { corpo: { customer: "A", items: [], fulfillment: "retirada" }, porque: "pedido sem itens" },
    { corpo: { customer: "A", items: [{ id: "x", qty: -5 }], fulfillment: "retirada" }, porque: "quantidade negativa" },
    { corpo: { customer: "A", items: [{ id: "x", qty: 1 }], fulfillment: "teletransporte" }, porque: "modalidade inexistente" },
    { corpo: { items: [{ id: "x", qty: 1 }] }, porque: "sem nome do cliente" }
  ];
  for (const caso of casos) {
    const { status } = await chamar("/api/publico/pedidos", { metodo: "POST", corpo: caso.corpo });
    assert.equal(status, 422, `deveria recusar: ${caso.porque}`);
  }
});

test("promocao nao pode custar mais que o preco cheio", async () => {
  const produto = (await produtosRepo.listar())[0];
  const { status } = await chamar("/api/painel/promocoes", {
    metodo: "POST", sessao: sessaoAdmin,
    corpo: { productId: produto.id, price: produto.price + 10, until: "" }
  });
  assert.equal(status, 422);
});

test("imagem de produto so aceita caminho do site ou data URL", async () => {
  const { status } = await chamar("/api/painel/produtos", {
    metodo: "POST", sessao: sessaoAdmin,
    corpo: {
      name: "XSS", category: "pizzas", price: 10, stock: 1, minStock: 1, active: true,
      image: "javascript:alert(document.cookie)", description: ""
    }
  });
  assert.equal(status, 422);
});

// ==================================================================== cupom ===
test("cupom de uso unico e barrado no segundo pedido do mesmo telefone", async () => {
  await cuponsRepo.criar({ code: "UMAVEZ", kind: "val", amount: 5, min: 0, once: true, until: "" });
  const produto = await produtosRepo.criar({
    id: "teste-cupom", name: "Item Cupom", category: "porcoes", price: 30,
    stock: 20, minStock: 0, active: true, image: "", badge: "Teste", description: ""
  });

  const pedido = corpo => chamar("/api/publico/pedidos", { metodo: "POST", corpo });
  const base = {
    customer: "Cliente Fiel", phone: "21999998888",
    items: [{ id: produto.id, qty: 1 }], fulfillment: "retirada", coupon: "UMAVEZ"
  };

  const primeiro = await pedido(base);
  assert.equal(primeiro.status, 201);
  assert.equal(primeiro.corpo.pedido.discount, 5, "o primeiro pedido leva o desconto");

  const segundo = await pedido(base);
  assert.equal(segundo.status, 201);
  assert.equal(segundo.corpo.pedido.discount, 0, "o mesmo telefone nao repete o cupom de uso unico");
});

test("cupom desconhecido nao derruba o pedido, so nao desconta", async () => {
  const produto = await produtosRepo.buscar("teste-cupom");
  const { status, corpo } = await chamar("/api/publico/pedidos", {
    metodo: "POST",
    corpo: {
      customer: "Cliente", items: [{ id: produto.id, qty: 1 }],
      fulfillment: "retirada", coupon: "NAOEXISTE"
    }
  });
  assert.equal(status, 201);
  assert.equal(corpo.pedido.discount, 0);
});

// =============================================================== auditoria ===
test("cancelamento devolve estoque uma vez so e fica registrado", async () => {
  const produto = await produtosRepo.criar({
    id: "teste-cancela", name: "Item Cancelavel", category: "drinks", price: 20,
    stock: 10, minStock: 0, active: true, image: "", badge: "Teste", description: ""
  });

  const criado = await chamar("/api/publico/pedidos", {
    metodo: "POST",
    corpo: { customer: "Cliente", items: [{ id: produto.id, qty: 3 }], fulfillment: "retirada" }
  });
  assert.equal(criado.status, 201);
  assert.equal((await produtosRepo.buscar(produto.id)).stock, 7);

  const id = criado.corpo.pedido.id;
  const primeiro = await chamar(`/api/painel/pedidos/${id}/cancelar`, {
    metodo: "POST", corpo: { motivo: "cliente desistiu" }, sessao: sessaoCaixa
  });
  assert.equal(primeiro.status, 200);
  assert.equal((await produtosRepo.buscar(produto.id)).stock, 10, "cancelar devolve o estoque");

  const segundo = await chamar(`/api/painel/pedidos/${id}/cancelar`, {
    metodo: "POST", corpo: { motivo: "clique duplo" }, sessao: sessaoCaixa
  });
  assert.equal(segundo.status, 409, "cancelar duas vezes nao pode inflar o estoque");
  assert.equal((await produtosRepo.buscar(produto.id)).stock, 10);

  const { corpo } = await chamar("/api/painel/auditoria?entidade=pedido", { sessao: sessaoAdmin });
  const registro = corpo.registros.find(item => item.entidade_id === id && item.acao === "pedido_cancelado");
  assert.ok(registro, "o cancelamento tem que ficar na auditoria");
  assert.equal(registro.usuario, "caixa1", "a auditoria guarda quem cancelou");
});

// ========================================================== forca bruta ===
/* Roda por ultimo de proposito: depois dele o IP do teste esta no teto de login
 * e nenhuma outra sessao pode ser aberta. */
test("tentativas seguidas de senha errada acabam barradas", async () => {
  let bloqueado = false;
  for (let tentativa = 0; tentativa < 15 && !bloqueado; tentativa += 1) {
    const { status } = await chamar("/api/auth/login", {
      metodo: "POST", corpo: { usuario: "admin", senha: `chute-numero-${tentativa}` }
    });
    if (status === 429) bloqueado = true;
  }
  assert.ok(bloqueado, "a forca bruta precisa acabar em 429");
});

// ============================================================== cabecalhos ===
test("cabecalhos de seguranca estao presentes e sem unsafe-inline em script", async () => {
  const resposta = await fetch(`${BASE}/api/saude`);
  const csp = resposta.headers.get("content-security-policy");
  assert.ok(csp, "CSP deve estar presente");
  assert.match(csp, /script-src[^;]*'self'/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src nao pode ter unsafe-inline");
  assert.equal(resposta.headers.get("x-content-type-options"), "nosniff");
  assert.equal(resposta.headers.get("x-powered-by"), null);
});
