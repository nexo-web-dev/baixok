/* Area de entrega: ponto da loja e faixas de raio.
 *
 * Os tres caminhos para marcar a loja foram preservados, e os dois primeiros
 * continuam funcionando sem conta na Mapbox:
 *   1. GPS do aparelho (exige https ou localhost)
 *   2. Colar a coordenada do Google Maps
 *   3. Buscar pelo endereco (so com Mapbox configurada) */
import { el, render, $, delegar, mostrar } from "../../../utils/dom.js";
import { reais, paraNumero } from "../../../utils/formato.js";
import { apiEntrega, apiPublica } from "../../../services/api.js";
import { estado, carregar } from "../store.js";
import { toast, toastFalha } from "../../../components/toast.js";

/* Rascunho local das faixas. So vira gravacao quando o usuario salva — editar
 * cada campo direto no servidor faria uma requisicao por tecla digitada. */
let rascunho = null;
let timerBusca = null;

const clonar = () => ({
  endereco: estado.entrega.endereco || "",
  lng: estado.entrega.lng,
  lat: estado.entrega.lat,
  zones: (estado.entrega.zones || []).map(zona => ({ km: zona.km, fee: zona.fee, min: zona.min }))
});

const BRASIL = { lat: [-34, 6], lng: [-74, -34] };
const dentroDoBrasil = (lat, lng) =>
  lat >= BRASIL.lat[0] && lat <= BRASIL.lat[1] && lng >= BRASIL.lng[0] && lng <= BRASIL.lng[1];

function cartaoDaLoja() {
  const marcada = rascunho.lng != null && rascunho.lat != null;

  return el("div.loja-atual", { class: marcada ? "marcada" : "" },
    el("strong", {}, marcada ? "Loja marcada no mapa" : "Loja ainda não marcada"),
    marcada ? el("span", {}, rascunho.endereco || "sem endereço descrito") : null,
    marcada ? el("code", {}, `${Number(rascunho.lat).toFixed(6)}, ${Number(rascunho.lng).toFixed(6)}`) : null,
    marcada
      ? el("button.ghost.small", { type: "button", dataset: { acao: "limpar-loja" } }, "Limpar ponto")
      : el("span", {}, "Sem o ponto da loja, as faixas ficam guardadas mas não entram na conta.")
  );
}

function linhaFaixa(faixa, indice) {
  return el("div.faixa", { dataset: { indice: String(indice) } },
    el("input", { type: "number", step: "0.5", min: "0.5", value: String(faixa.km), dataset: { campo: "km", indice: String(indice) }, "aria-label": "Raio em km" }),
    el("input", { type: "number", step: "0.5", min: "0", value: String(faixa.fee), dataset: { campo: "fee", indice: String(indice) }, "aria-label": "Taxa em reais" }),
    el("input", { type: "number", step: "1", min: "0", value: String(faixa.min), dataset: { campo: "min", indice: String(indice) }, "aria-label": "Pedido mínimo" }),
    el("button.ghost.small", { type: "button", dataset: { acao: "remover-faixa", indice: String(indice) }, "aria-label": "Remover faixa" }, "×")
  );
}

export function desenharEntrega() {
  const alvo = $("#entrega-painel");
  if (!alvo) return;
  if (!rascunho) rascunho = clonar();

  const temMapa = rascunho.lng != null;

  render(alvo,
    el("div.entrega-grid", {},
      el("section.panel", {},
        el("h2", {}, "Onde fica a loja"),
        cartaoDaLoja(),
        el("div.modo-marcar", {},
          el("span.rotulo", {}, "Estou na loja agora"),
          el("p.small", {}, "Usa o GPS deste aparelho. Exige https ou localhost — na rede interna por http o navegador recusa."),
          el("button.secondary.wide", { type: "button", dataset: { acao: "usar-gps" } }, "◉ Usar minha localização")
        ),
        el("div.modo-marcar", {},
          el("span.rotulo", {}, "Colar coordenada"),
          el("p.small", {}, "No Google Maps, clique com o botão direito no ponto da loja e escolha a primeira opção do menu."),
          el("div.coord-row", {},
            el("input", { id: "coord-colada", placeholder: "-22.8975, -43.1875", autocomplete: "off" }),
            el("button.secondary", { type: "button", dataset: { acao: "usar-coordenada" } }, "Usar")
          )
        ),
        el("div.modo-marcar", {},
          el("span.rotulo", {}, "Buscar pelo endereço"),
          el("input", { id: "busca-loja", placeholder: "Rua, numero, bairro", autocomplete: "off" }),
          el("div.sugestoes", { id: "sugestoes-loja" })
        ),
        temMapa
          ? el("img.mapa-loja", { src: `${apiEntrega.urlMapa()}?v=${Date.now()}`, alt: "Mapa da regiao da loja", loading: "lazy",
              onerror: evento => evento.target.remove() })
          : null
      ),

      el("section.panel", {},
        el("h2", {}, "Faixas de raio"),
        el("p.small", {}, "A distância é medida em linha reta a partir da loja. O cliente paga a taxa da primeira faixa que alcança; endereço além da última é recusado."),
        el("div.faixa-head", {},
          el("span", {}, "Até (km)"), el("span", {}, "Taxa (R$)"), el("span", {}, "Mínimo (R$)"), el("span", {})
        ),
        el("div.faixas", { id: "lista-faixas" },
          ...rascunho.zones.map(linhaFaixa),
          rascunho.zones.length ? null : el("p.faint", {}, "Nenhuma faixa criada.")
        ),
        el("button.secondary.wide", { type: "button", dataset: { acao: "adicionar-faixa" } }, "+ Adicionar faixa"),
        el("div.panel-divider", {},
          el("button.primary.wide", { type: "button", dataset: { acao: "salvar-entrega" } }, "Salvar area de entrega"),
          el("p.small.faint", {}, "As faixas são ordenadas por distância ao salvar.")
        )
      )
    )
  );
}

async function buscarLoja(termo) {
  clearTimeout(timerBusca);
  const alvo = $("#sugestoes-loja");
  if (!alvo) return;

  if (termo.trim().length < 3) return render(alvo);

  timerBusca = setTimeout(async () => {
    try {
      const { resultados } = await apiPublica.buscarEndereco(termo.trim());
      render(alvo, ...resultados.map(item =>
        el("button.sugestao", {
          type: "button",
          dataset: { acao: "escolher-loja", lng: String(item.lng), lat: String(item.lat), texto: `${item.nome}${item.detalhe ? `, ${item.detalhe}` : ""}` }
        },
          el("strong", {}, item.nome),
          el("span", {}, item.detalhe || "")
        )
      ));
    } catch {
      render(alvo, el("p.small.faint", {}, "Busca de endereço indisponível. Use o GPS ou cole a coordenada."));
    }
  }, 350);
}

function definirLoja(lng, lat, endereco) {
  rascunho.lng = lng;
  rascunho.lat = lat;
  if (endereco) rascunho.endereco = endereco;
  desenharEntrega();
}

export function ligarEntrega() {
  const alvo = $("#entrega-painel");
  if (!alvo) return;

  delegar(alvo, "click", "[data-acao='usar-gps']", (_e, botao) => {
    if (!navigator.geolocation) return toast("Este aparelho não tem GPS disponível.");
    botao.disabled = true;
    botao.textContent = "Localizando...";
    navigator.geolocation.getCurrentPosition(
      posicao => definirLoja(posicao.coords.longitude, posicao.coords.latitude, rascunho.endereco || "Ponto marcado pelo GPS"),
      () => {
        botao.disabled = false;
        botao.textContent = "◉ Usar minha localização";
        toast("Não foi possível usar o GPS. Em http o navegador bloqueia — use https, localhost ou cole a coordenada.");
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });

  delegar(alvo, "click", "[data-acao='usar-coordenada']", () => {
    const bruto = $("#coord-colada")?.value.trim() || "";
    const partes = bruto.split(/[,\s]+/).map(Number).filter(Number.isFinite);
    if (partes.length !== 2) return toast("Cole no formato -22.8975, -43.1875");

    let [primeiro, segundo] = partes;
    /* O Google Maps copia "lat, lng". Se vier trocado, corrigimos: nenhuma
     * latitude brasileira passa de -34, e nenhuma longitude fica acima de -34. */
    let [lat, lng] = dentroDoBrasil(primeiro, segundo) ? [primeiro, segundo] : [segundo, primeiro];
    if (!dentroDoBrasil(lat, lng)) return toast("Essa coordenada não parece estar no Brasil.");

    definirLoja(lng, lat, rascunho.endereco || "Coordenada colada");
  });

  delegar(alvo, "click", "[data-acao='limpar-loja']", () => {
    rascunho.lng = null;
    rascunho.lat = null;
    rascunho.endereco = "";
    desenharEntrega();
  });

  delegar(alvo, "input", "#busca-loja", (_e, campo) => buscarLoja(campo.value));
  delegar(alvo, "click", "[data-acao='escolher-loja']", (_e, botao) =>
    definirLoja(Number(botao.dataset.lng), Number(botao.dataset.lat), botao.dataset.texto));

  delegar(alvo, "click", "[data-acao='adicionar-faixa']", () => {
    const ultima = rascunho.zones[rascunho.zones.length - 1];
    rascunho.zones.push({ km: (ultima?.km || 0) + 2, fee: ultima?.fee ?? 5, min: ultima?.min ?? 0 });
    desenharEntrega();
  });

  delegar(alvo, "click", "[data-acao='remover-faixa']", (_e, botao) => {
    rascunho.zones.splice(Number(botao.dataset.indice), 1);
    desenharEntrega();
  });

  delegar(alvo, "change", "[data-campo]", (_e, campo) => {
    const faixa = rascunho.zones[Number(campo.dataset.indice)];
    if (faixa) faixa[campo.dataset.campo] = paraNumero(campo.value);
  });

  delegar(alvo, "click", "[data-acao='salvar-entrega']", async (_e, botao) => {
    botao.disabled = true;
    try {
      await apiEntrega.salvar({
        endereco: rascunho.endereco,
        lng: rascunho.lng,
        lat: rascunho.lat,
        zones: rascunho.zones.filter(zona => zona.km > 0)
      });
      await carregar("entrega");
      rascunho = clonar();
      desenharEntrega();
      toast("Area de entrega salva.");
    } catch (erro) {
      toastFalha(erro);
    } finally {
      botao.disabled = false;
    }
  });
}

/* Chamado quando o SSE avisa que a entrega mudou em outro aparelho. */
export function recarregarRascunhoEntrega() {
  rascunho = clonar();
}
