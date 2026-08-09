/* Primeira carga: administrador, mesas, cardapio de exemplo e ajustes.
 *
 * Idempotente — rodar de novo nao duplica nada, so completa o que falta. */
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { abrirPool, emTransacao, fecharPool } from "./postgres.js";
import { migrar } from "./migrate.js";
import { usuariosRepo } from "../repositories/usuarios.repo.js";
import { produtosRepo } from "../repositories/produtos.repo.js";
import { mesasRepo } from "../repositories/mesas.repo.js";
import { ajustesRepo } from "../repositories/ajustes.repo.js";
import { gerarHashSenha } from "../lib/password.js";

const PRODUTOS_EXEMPLO = [
  { id: "pizza-calabresa", name: "Pizza Calabresa", category: "pizzas", price: 39.9, stock: 18, minStock: 4, badge: "Pizza", description: "Mussarela, calabresa, cebola e oregano." },
  { id: "pizza-frango", name: "Pizza Frango Catupiry", category: "pizzas", price: 44.9, stock: 14, minStock: 4, badge: "Pizza", description: "Frango temperado, catupiry e mussarela." },
  { id: "pizza-baixo-k", name: "Pizza Baixo K", category: "pizzas", price: 49.9, stock: 10, minStock: 3, badge: "Mais pedida", description: "Massa da casa, mix de queijos, bacon e finalizacao especial." },
  { id: "burguer-classico", name: "Burguer Classico", category: "burgues", price: 22.9, stock: 30, minStock: 6, badge: "Burguer", description: "Pao brioche, carne, queijo, salada e molho da casa." },
  { id: "burguer-bacon", name: "Burguer Bacon", category: "burgues", price: 27.9, stock: 24, minStock: 6, badge: "Bacon", description: "Carne, cheddar, bacon crocante e cebola caramelizada." },
  { id: "burguer-duplo", name: "Burguer Duplo K", category: "burgues", price: 34.9, stock: 16, minStock: 4, badge: "Duplo", description: "Duas carnes, queijo duplo, bacon e molho especial." },
  { id: "massa-bolonhesa", name: "Massa Bolonhesa", category: "massas", price: 31.9, stock: 12, minStock: 3, badge: "Massa", description: "Massa ao molho bolonhesa com parmesao." },
  { id: "massa-alfredo", name: "Massa Alfredo", category: "massas", price: 33.9, stock: 12, minStock: 3, badge: "Cremosa", description: "Molho branco cremoso, frango e toque de ervas." },
  { id: "batata-k", name: "Batata Baixo K", category: "porcoes", price: 24.9, stock: 20, minStock: 5, badge: "Porcao", description: "Batata frita com cheddar, bacon e molho da casa." },
  { id: "refri-lata", name: "Refrigerante Lata", category: "drinks", price: 7.9, stock: 48, minStock: 12, badge: "Gelado", description: "Lata 350ml gelada." },
  { id: "refri-2l", name: "Refrigerante 2L", category: "drinks", price: 14.9, stock: 18, minStock: 6, badge: "2 litros", description: "Garrafa 2L gelada." },
  { id: "drink-limao", name: "Drink Limao", category: "drinks", price: 16.9, stock: 22, minStock: 5, badge: "Drink", description: "Drink refrescante de limao para acompanhar o pedido." },
  { id: "drink-maracuja", name: "Drink Maracuja", category: "drinks", price: 18.9, stock: 18, minStock: 5, badge: "Assinatura", description: "Maracuja, gelo e finalizacao da casa." }
];

const MESAS_INICIAIS = 8;
const PERMISSOES_ADMIN = ["pedidos", "mesas", "produtos", "promos", "entrega", "estoque", "dashboard", "plano", "usuarios"];
const PERMISSOES_BALCAO = ["pedidos", "mesas", "estoque"];
const PERMISSOES_COZINHA = ["pedidos"];

export async function semear({ silencioso = false } = {}) {
  abrirPool();
  await migrar();

  const avisar = (...args) => { if (!silencioso) console.log(...args); };
  const resultado = { admin: null, senhaGerada: null, produtos: 0, mesas: 0 };

  /* Administrador. A senha vem do ambiente ou e sorteada — nunca ha senha
   * padrao cravada no codigo, que e como instalacoes ficam abertas por anos. */
  const usuarioAdmin = env.ADMIN_BOOTSTRAP_USER === "admin" ? "baixok@food.com" : env.ADMIN_BOOTSTRAP_USER;

  const adminExistente = await usuariosRepo.buscarPorUsuario(usuarioAdmin);
  if (!adminExistente) {
    const senha = env.ADMIN_BOOTSTRAP_PASSWORD || randomBytes(12).toString("base64url");
    const usuario = await usuariosRepo.criar({
      usuario: usuarioAdmin,
      nome: "Admin Baixo K",
      senhaHash: await gerarHashSenha(senha),
      papel: "admin",
      abasVer: PERMISSOES_ADMIN,
      abasEditar: PERMISSOES_ADMIN
    });
    resultado.admin = usuario.usuario;
    if (!env.ADMIN_BOOTSTRAP_PASSWORD) resultado.senhaGerada = senha;

    avisar("\n=================================================");
    avisar("  ADMINISTRADOR CRIADO");
    avisar(`  usuario: ${usuario.usuario}`);
    avisar(`  senha:   ${senha}`);
    avisar("  Anote agora e troque no primeiro acesso.");
    avisar("=================================================\n");
  } else {
    await usuariosRepo.atualizar(adminExistente.id, {
      nome: "Admin Baixo K",
      papel: "admin",
      ativo: true,
      abasVer: PERMISSOES_ADMIN,
      abasEditar: PERMISSOES_ADMIN
    });
    if (env.ADMIN_BOOTSTRAP_PASSWORD) {
      await usuariosRepo.trocarSenha(adminExistente.id, await gerarHashSenha(env.ADMIN_BOOTSTRAP_PASSWORD));
    }
    resultado.admin = adminExistente.usuario;
    avisar("Administrador padrao atualizado.");
  }

  await emTransacao(async () => {
    if (!(await produtosRepo.listar()).length) {
      for (const produto of PRODUTOS_EXEMPLO) {
        await produtosRepo.criar({ ...produto, active: true, image: "" });
        resultado.produtos += 1;
      }
    }
    if (!(await mesasRepo.listar()).length) {
      for (let n = 1; n <= MESAS_INICIAIS; n += 1) {
        await mesasRepo.criar(n);
        resultado.mesas += 1;
      }
    }
    await ajustesRepo.gravarVarios({ nome_loja: "Baixo K", taxa_servico_mesa: "0.1" });
  });

  if (!(await usuariosRepo.buscarPorUsuario("balcao@baixok.com"))) {
    const senhaBalcao = env.BALCAO_BOOTSTRAP_PASSWORD || randomBytes(12).toString("base64url");
    await usuariosRepo.criar({
      usuario: "balcao@baixok.com",
      nome: "Balcão Baixo K",
      senhaHash: await gerarHashSenha(senhaBalcao),
      papel: "caixa",
      abasVer: PERMISSOES_BALCAO,
      abasEditar: ["pedidos", "mesas"]
    });
    avisar("Usuario de balcao criado: balcao@baixok.com");
    if (!env.BALCAO_BOOTSTRAP_PASSWORD) avisar(`Senha inicial do balcão: ${senhaBalcao}`);
  } else if (env.BALCAO_BOOTSTRAP_PASSWORD) {
    const balcao = await usuariosRepo.buscarPorUsuario("balcao@baixok.com");
    await usuariosRepo.trocarSenha(balcao.id, await gerarHashSenha(env.BALCAO_BOOTSTRAP_PASSWORD));
    avisar("Senha do balcao atualizada.");
  }

  if (resultado.produtos) avisar(`Cardapio de exemplo: ${resultado.produtos} produtos.`);
  if (resultado.mesas) avisar(`Mesas criadas: ${resultado.mesas}.`);
  return resultado;
}

if (process.argv[1]?.endsWith("seed.js")) {
  try {
    await semear();
  } catch (erro) {
    console.error("Falha no seed:", erro.message);
    process.exitCode = 1;
  } finally {
    /* Fecha o pool em vez de process.exit(): com o Postgres ha conexoes abertas,
     * e sair na marra deixaria a ultima transacao sem COMMIT confirmado. */
    await fecharPool();
  }
}
