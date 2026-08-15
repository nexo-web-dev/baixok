/* Modo mesa: o cardapio aberto pelo QR code fixo da mesa.
 *
 * A comanda vem do servidor, que devolve so a mesa pedida — quem esta na mesa 7
 * nao consegue ver o que a mesa 4 consumiu. No sistema antigo os itens de TODAS
 * as mesas vinham juntos no estado publico e ficavam no localStorage do
 * celular de cada cliente. */
import { el, render, $, mostrar, $$ } from "../../utils/dom.js";
import { reais } from "../../utils/formato.js";
import { apiPublica } from "../../services/api.js";
import { marcarProporcaoImagem } from "../../utils/fotos.js";

export function mesaDaUrl() {
  const parametros = new URLSearchParams(location.search);
  let bruto = parametros.get("mesa");

  if (!bruto && location.hash) {
    const hash = location.hash.replace(/^#\/?/, "");
    bruto = new URLSearchParams(hash.includes("?") ? hash.split("?").pop() : hash).get("mesa");
  }

  const numero = Number(bruto);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

export const sessaoMesa = { n: null, aberta: null, comanda: null };

export function iniciarModoMesa(numero) {
  sessaoMesa.n = numero;
  document.body.dataset.mode = "mesa";
  document.body.classList.add("table-mode");

  const botaoEnviar = $("#send-order");
  if (botaoEnviar) botaoEnviar.textContent = "Enviar para a cozinha";

  const campoNome = $("#customer-name");
  if (campoNome) campoNome.placeholder = "Nome de quem está pedindo (opcional)";

  const tituloMenu = $("#menu-title");
  if (tituloMenu) tituloMenu.textContent = "Escolha o que vai para a mesa";

  const subtituloMenu = $("#menu-subtitle");
  if (subtituloMenu) {
    subtituloMenu.textContent = "Toque em + para enviar itens para a cozinha. A conta fecha com o garçom no final.";
  }

  for (const seletor of ["#phone-label", "#payment-label", "#service-mode", "#pickup-banner"]) {
    $(seletor)?.classList.add("mesa-hidden-field");
  }
}

export function mostrarVista(vista) {
  if (!sessaoMesa.n) return;
  const bloqueada = vista === "blocked";

  mostrar($("#table-blocked"), bloqueada);
  mostrar($("#table-comanda"), vista === "comanda");
  for (const node of $$(".shop-layout, .hero, .mobile-cart, .nexo-footer")) {
    mostrar(node, vista === "inicio");
  }
  const botaoCarrinho = $("#open-cart");
  if (botaoCarrinho) {
    const quantidade = Number($("#cart-count")?.textContent || 0);
    mostrar(botaoCarrinho, vista === "inicio" && quantidade > 0);
  }
  for (const aba of $$(".table-tab")) {
    aba.classList.toggle("active", aba.dataset.view === vista);
    aba.setAttribute("aria-selected", String(aba.dataset.view === vista));
  }

  if (bloqueada) document.body.classList.remove("cart-open");
  if (vista !== "inicio") window.scrollTo({ top: 0 });
}

export async function atualizarMesa() {
  if (!sessaoMesa.n) return;

  let comanda = null;
  try {
    comanda = await apiPublica.mesa(sessaoMesa.n);
  } catch {
    comanda = null;   // mesa inexistente ou servidor fora
  }
  sessaoMesa.comanda = comanda;
  const statusMesa = comanda?.status || "";
  const aberta = statusMesa === "aberta" || comanda?.aberta === true;
  const podePedir = Boolean(comanda) && statusMesa !== "fechando";

  mostrar($("#table-bar"), true);
  $("#table-bar-title").textContent = `Mesa nº ${sessaoMesa.n}`;
  $("#table-bar-status").textContent = aberta
    ? "Comanda aberta"
    : comanda ? "Comanda fechada" : "Mesa não encontrada";
  if (!aberta && statusMesa === "livre") {
    $("#table-bar-status").textContent = "Pronta para pedir";
  }
  mostrar($("#table-nav"), podePedir);

  if (!podePedir) {
    const fechando = statusMesa === "fechando";
    $("#blocked-title").textContent = fechando ? "Conta já fechada" : "Comanda fechada";
    $("#blocked-text").textContent = comanda
      ? fechando
        ? "A conta desta mesa já foi fechada no balcão. Para pedir de novo, chame o garçom."
        : "Chame o atendente para abrir a mesa e liberar os pedidos por aqui."
      : "Não encontramos essa mesa. Confira o QR code ou chame o atendente.";
    sessaoMesa.aberta = false;
    mostrarVista("blocked");
    return;
  }

  /* A mesa acabou de ser aberta com o cliente na tela de bloqueio. O aviso do
   * servidor destrava a tela sozinho — antes ele precisava recarregar a pagina,
   * e ler o QR antes de o atendente abrir a mesa e o caso comum no salao. */
  if (sessaoMesa.aberta !== podePedir) {
    sessaoMesa.aberta = podePedir;
    mostrarVista(comanda.items.length ? "comanda" : "inicio");
  }
  desenharComanda(comanda);
}

function desenharComanda(comanda) {
  const itens = comanda?.items || [];
  const quantidade = itens.reduce((soma, item) => soma + item.qty, 0);

  const contador = $("#comanda-count");
  if (contador) {
    contador.textContent = String(quantidade);
    mostrar(contador, quantidade > 0);
  }

  mostrar($("#comanda-empty"), itens.length === 0);
  mostrar($("#comanda-body"), itens.length > 0);

  const titulo = $("#comanda-title");
  if (titulo) titulo.textContent = `Mesa ${comanda.n}`;

  render($("#comanda-items"), ...itens.map(item =>
    el("div.comanda-item-line", {},
      item.image
        ? el("span.fit-media.comanda-thumb", {},
            el("img.fit-media-bg", {
              src: item.image,
              alt: "",
              loading: "lazy",
              decoding: "async",
              "aria-hidden": "true"
            }),
            el("img.fit-media-main", {
              onload: marcarProporcaoImagem,
              src: item.image,
              alt: item.name || "Produto",
              loading: "lazy",
              decoding: "async",
              onerror: evento => evento.target.closest(".fit-media")?.replaceWith(el("div.comanda-thumb.no-photo", {}, "Sem foto"))
            })
          )
        : el("div.comanda-thumb.no-photo", {}, "Sem foto"),
      el("div", {},
        el("strong", {}, `${item.qty}x ${item.name}`),
        item.gift ? el("span.gift-tag", {}, "Brinde · Leve e ganhe") : el("span", {}, `${reais(item.price)} cada`)
      ),
      el("strong", {}, item.gift ? "Grátis" : reais(item.price * item.qty))
    )
  ));

  /* A taxa de servico vem calculada do servidor. Era a constante SERVICE_FEE
   * dentro do app.js, portanto editavel por qualquer cliente no devtools. */
  const conta = comanda.conta || { subtotal: 0, servico: 0, total: 0, percentualServico: 0 };
  render($("#comanda-totals"),
    el("div.comanda-line", {}, el("span", {}, "Consumo"), el("span", {}, reais(conta.subtotal))),
    el("div.comanda-line", {},
      el("span", {}, `Serviço (${Math.round(conta.percentualServico * 100)}%)`),
      el("span", {}, reais(conta.servico))
    ),
    el("div.comanda-line.total", {}, el("span", {}, "Total da comanda"), el("span", {}, reais(conta.total)))
  );
}
