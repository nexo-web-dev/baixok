/* Controllers do painel. Todos exigem sessao; o papel e checado na rota.
 *
 * Todo handler que toca o banco e async: com o Postgres as consultas voltaram
 * assincronas, e um handler sincrono responderia com Promise no lugar do dado.
 * O Express 5 encaminha a rejeicao de um handler async para o tratarErro
 * sozinho, entao nao ha try/catch repetido aqui. */
import { pedidosService } from "../services/pedidos.service.js";
import { produtosService, promocoesService } from "../services/produtos.service.js";
import { insumosService } from "../services/insumos.service.js";
import { mesasService } from "../services/mesas.service.js";
import { cuponsService } from "../services/cupons.service.js";
import { entregaService } from "../services/entrega.service.js";
import { relatoriosService } from "../services/relatorios.service.js";
import { usuariosService } from "../services/usuarios.service.js";
import { ajustesRepo } from "../repositories/ajustes.repo.js";
import { mapaEstatico } from "../lib/mapbox.js";
import { contexto } from "./contexto.js";

export const pedidosController = {
  async listar(req, res) {
    res.json({ pedidos: await pedidosService.listar(req.validado.query) });
  },
  async abertos(_req, res) {
    const [pedidos, resumo] = await Promise.all([
      pedidosService.listarAbertos(),
      pedidosService.resumoDoDia()
    ]);
    res.json({ pedidos, resumo });
  },
  async buscar(req, res) {
    res.json({ pedido: await pedidosService.buscar(req.validado.params.id) });
  },
  async criarManual(req, res) {
    res.status(201).json({ pedido: await pedidosService.criarManual(req.validado.body, contexto(req)) });
  },
  async mudarStatus(req, res) {
    const { id } = req.validado.params;
    res.json({ pedido: await pedidosService.mudarStatus(id, req.validado.body.status, contexto(req)) });
  },
  async cancelar(req, res) {
    const { id } = req.validado.params;
    res.json({ pedido: await pedidosService.cancelar(id, req.validado.body.motivo, contexto(req)) });
  },
  async definirMotoboy(req, res) {
    const { id } = req.validado.params;
    res.json({ pedido: await pedidosService.definirMotoboy(id, req.validado.body.motoboy, contexto(req)) });
  },
  async marcarImpresso(req, res) {
    await pedidosService.marcarImpresso(req.validado.params.id);
    res.json({ ok: true });
  }
};

export const insumosController = {
  async listar(_req, res) {
    res.json({ insumos: await insumosService.listar() });
  },
  async criar(req, res) {
    res.status(201).json({ insumo: await insumosService.criar(req.validado.body, contexto(req)) });
  },
  async atualizar(req, res) {
    res.json({ insumo: await insumosService.atualizar(req.validado.params.id, req.validado.body, contexto(req)) });
  },
  async ajustar(req, res) {
    res.json({ insumo: await insumosService.ajustar(req.validado.params.id, req.validado.body, contexto(req)) });
  },
  async remover(req, res) {
    await insumosService.remover(req.validado.params.id, contexto(req));
    res.json({ ok: true });
  }
};

export const produtosController = {
  async listar(_req, res) {
    res.json({ produtos: await produtosService.listar() });
  },
  async criar(req, res) {
    res.status(201).json({ produto: await produtosService.criar(req.validado.body, contexto(req)) });
  },
  async atualizar(req, res) {
    res.json({ produto: await produtosService.atualizar(req.validado.params.id, req.validado.body, contexto(req)) });
  },
  async remover(req, res) {
    await produtosService.remover(req.validado.params.id, contexto(req));
    res.json({ ok: true });
  },
  async alternarAtivo(req, res) {
    res.json({ produto: await produtosService.alternarAtivo(req.validado.params.id, contexto(req)) });
  },
  async ajustarEstoque(req, res) {
    res.json({ produto: await produtosService.ajustarEstoque(req.validado.params.id, req.validado.body, contexto(req)) });
  },
  async moverOrdem(req, res) {
    res.json({ produto: await produtosService.moverOrdem(req.validado.params.id, req.validado.body.direction, contexto(req)) });
  },
  async emFalta(_req, res) {
    res.json({ produtos: await produtosService.emFalta() });
  }
};

export const promocoesController = {
  async listar(_req, res) {
    res.json({ promocoes: await promocoesService.listar() });
  },
  async salvar(req, res) {
    res.status(201).json({ promocao: await promocoesService.salvar(req.validado.body, contexto(req)) });
  },
  async remover(req, res) {
    await promocoesService.remover(req.validado.params.id, contexto(req));
    res.json({ ok: true });
  }
};

export const cuponsController = {
  async listar(_req, res) {
    res.json({ cupons: await cuponsService.listar() });
  },
  async criar(req, res) {
    res.status(201).json({ cupom: await cuponsService.criar(req.validado.body, contexto(req)) });
  },
  async alternarAtivo(req, res) {
    res.json({ cupom: await cuponsService.alternarAtivo(req.validado.params.id, contexto(req)) });
  },
  async remover(req, res) {
    await cuponsService.remover(req.validado.params.id, contexto(req));
    res.json({ ok: true });
  }
};

export const mesasController = {
  async listar(_req, res) {
    res.json({ mesas: await mesasService.listar() });
  },
  async adicionar(req, res) {
    res.status(201).json({ mesa: await mesasService.adicionar(contexto(req)) });
  },
  async remover(req, res) {
    await mesasService.remover(req.validado.params.n, contexto(req));
    res.json({ ok: true });
  },
  async abrir(req, res) {
    res.json({ mesa: await mesasService.abrir(req.validado.params.n, contexto(req)) });
  },
  async fecharConta(req, res) {
    res.json({ conta: await mesasService.fecharConta(req.validado.params.n, contexto(req)) });
  },
  async liberar(req, res) {
    res.json({ mesa: await mesasService.liberar(req.validado.params.n, contexto(req)) });
  }
};

export const entregaController = {
  async config(_req, res) {
    res.json({ entrega: await entregaService.config() });
  },
  async salvar(req, res) {
    res.json({ entrega: await entregaService.salvarConfig(req.validado.body, contexto(req)) });
  },
  /* O mapa passa pelo servidor para o token nao aparecer na URL da imagem. */
  async mapa(_req, res) {
    const loja = await entregaService.config();
    if (loja.lng == null) return res.status(404).json({ erro: "Marque o ponto da loja primeiro." });
    const imagem = await mapaEstatico({
      lng: loja.lng, lat: loja.lat, raios: loja.zones.map(zona => Number(zona.km)).filter(Boolean)
    });
    res.set("Content-Type", "image/png").set("Cache-Control", "private, max-age=300").send(imagem);
  }
};

export const relatoriosController = {
  async dashboard(req, res) {
    res.json(await relatoriosService.dashboard(req.validado.query));
  },
  async exportacao(req, res) {
    res.json(await relatoriosService.exportacao(req.validado.query));
  }
};

export const usuariosController = {
  async listar(_req, res) {
    res.json({ usuarios: await usuariosService.listar() });
  },
  async criar(req, res) {
    res.status(201).json({ usuario: await usuariosService.criar(req.validado.body, contexto(req)) });
  },
  async atualizar(req, res) {
    res.json({ usuario: await usuariosService.atualizar(Number(req.validado.params.id), req.validado.body, contexto(req)) });
  },
  async redefinirSenha(req, res) {
    await usuariosService.redefinirSenha(Number(req.validado.params.id), req.validado.body.senha, contexto(req));
    res.json({ ok: true });
  },
  async remover(req, res) {
    await usuariosService.remover(Number(req.validado.params.id), contexto(req));
    res.json({ ok: true });
  },
  async auditoria(req, res) {
    res.json({ registros: await usuariosService.auditoria(req.validado.query) });
  }
};

export const ajustesController = {
  async ler(_req, res) {
    res.json({ ajustes: await ajustesRepo.todos() });
  },
  async gravar(req, res) {
    res.json({ ajustes: await ajustesRepo.gravarVarios(req.validado.body) });
  }
};
