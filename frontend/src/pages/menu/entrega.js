/* Endereco de entrega e previa da taxa.
 *
 * So um caminho: busca pelo proprio servidor (funciona sempre, inclusive com
 * token secreto, que nunca chega ao navegador). O widget oficial da Mapbox foi
 * desligado — ver o comentario em montarWidget() para o motivo.
 *
 * A taxa mostrada aqui e previa. Ao registrar o pedido o servidor geocodifica o
 * endereco de novo e refaz a conta: forjar coordenada no navegador so engana a
 * propria tela. */
import { el, render, $, mostrar } from "../../utils/dom.js";
import { reais } from "../../utils/formato.js";
import { apiPublica } from "../../services/api.js";

let statusCache = null;
let widget = null;
let timerBusca = null;
let requisicaoEmVoo = null;

export let cotacao = null;
export const limparCotacao = () => {
  cotacao = null;
  mostrar($("#entrega-aviso"), false);
  render($("#endereco-sugestoes"));
};

async function status() {
  if (statusCache) return statusCache;
  try {
    statusCache = await apiPublica.statusEntrega();
  } catch {
    statusCache = { configurado: false, token: "" };
  }
  return statusCache;
}

function mostrarAviso(mensagem, tom = "info") {
  const alvo = $("#entrega-aviso");
  if (!alvo) return;
  alvo.textContent = mensagem;
  alvo.className = `entrega-aviso ${tom}`;
  mostrar(alvo, Boolean(mensagem));
}

function descreverCotacao(resultado) {
  if (!resultado?.configurado) return "";
  if (!resultado.dentro) return `Esse endereço está a ${resultado.km} km da loja, fora da área de entrega.`;
  const minimo = resultado.minimo ? ` · pedido mínimo ${reais(resultado.minimo)}` : "";
  return `Entrega ${resultado.zona} · taxa ${reais(resultado.taxa)}${minimo}`;
}

async function cotar(params, aoAtualizar) {
  try {
    const resultado = await apiPublica.cotarEntrega(params);
    cotacao = resultado;
    mostrarAviso(descreverCotacao(resultado), resultado.dentro ? "ok" : "erro");
    aoAtualizar?.();
  } catch (erro) {
    cotacao = null;
    mostrarAviso(erro.message || "Não foi possível calcular a taxa agora.", "erro");
    aoAtualizar?.();
  }
}

/* Busca pelo servidor, com espera para nao disparar uma consulta por tecla
 * digitada — a Mapbox cobra por consulta e o teto por IP e por hora. */
export function buscarEndereco(termo, aoAtualizar) {
  clearTimeout(timerBusca);
  requisicaoEmVoo?.abort();

  const alvo = $("#endereco-sugestoes");
  if (!alvo) return;

  if (termo.trim().length < 3) {
    render(alvo);
    limparCotacao();
    return;
  }

  timerBusca = setTimeout(async () => {
    const controle = new AbortController();
    requisicaoEmVoo = controle;
    try {
      const { resultados } = await apiPublica.buscarEndereco(termo.trim(), { sinal: controle.signal });
      render(alvo, ...resultados.map(item =>
        el("button.sugestao", {
          type: "button",
          dataset: { acao: "escolher-endereco", lng: String(item.lng), lat: String(item.lat), texto: `${item.nome}${item.detalhe ? `, ${item.detalhe}` : ""}` }
        },
          el("strong", {}, item.nome),
          el("span", {}, item.detalhe || "")
        )
      ));
    } catch (erro) {
      if (erro.name !== "AbortError") render(alvo);
    } finally {
      requisicaoEmVoo = null;
    }
  }, 350);
}

export async function escolherEndereco({ texto, lng, lat }, aoAtualizar) {
  const campo = $("#customer-place");
  if (campo) campo.value = texto;
  render($("#endereco-sugestoes"));
  await cotar({ q: texto, lng, lat }, aoAtualizar);
}

/* Widget oficial da Mapbox DESLIGADO de proposito.
 *
 * A versao anterior so protegia a montagem (sincrona): construir, addTo,
 * registrar os listeners. Uma falha em tempo real — o cliente digitando e o
 * widget batendo na Mapbox por conta propria, sem passar pelo nosso servidor —
 * acontecia fora desse try/catch, sem log, sem fallback, e a essa altura o
 * campo simples (#customer-place) ja estava escondido. Foi exatamente o que
 * aconteceu em producao assim que o token ficou valido: parou de mostrar
 * sugestao nenhuma, sem erro visivel em lugar algum.
 *
 * A busca pelo nosso servidor (buscarEndereco, abaixo) e testada e continua
 * valendo sempre. Ate o widget ganhar um fallback de verdade para falha em
 * tempo de execucao, ele fica fora — nao ha nada para montar aqui. */
export async function montarWidget() {}

export function limparWidget() {
  try { widget?.clear(); } catch { /* widget ja descartado */ }
  const campo = $("#customer-place");
  if (campo) campo.value = "";
  limparCotacao();
}
