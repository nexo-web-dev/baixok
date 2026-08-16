/* Ajustes da casa em chave/valor.
 *
 * Guarda o que estava cravado como constante no app.js e por isso so mudava com
 * deploy: o endereco publicado do cardapio (MENU_URL, usado nos QR codes das
 * mesas), o WhatsApp da entrega e a taxa de servico do salao. */
import { todos as consultar, alteradas } from "../db/postgres.js";

const PADROES = {
  /* Dominio fixo da loja — nao e um placeholder generico porque este sistema
   * e feito sob medida pra esta casa, nao um produto multi-cliente. Continua
   * editavel na aba Mesas se o dominio um dia mudar. */
  menu_url: "https://baixo-k.squareweb.app/index.html",
  whatsapp_entrega: "",
  taxa_servico_mesa: "0.1",
  nome_loja: "Baixo K",
  endereco_loja: "",
  /* Mesmo valor que o recibo ja usava fixo (68mm de area impressa numa bobina
   * de 80mm) — quem nunca mexer neste ajuste no continua exatamente como
   * estava. */
  largura_papel_cozinha: "68"
};

export const ajustesRepo = {
  async todos() {
    const linhas = await consultar("SELECT chave, valor FROM ajustes");
    const guardado = Object.fromEntries(linhas.map(linha => [linha.chave, linha.valor]));
    const mesclado = { ...PADROES, ...guardado };
    /* Vazio gravado por engano (um "Salvar" antigo com o campo em branco, por
     * exemplo) nao pode vencer o padrao — sem isso o dominio fixo da loja
     * nunca apareceria pra quem ja tinha essa linha em branco no banco. */
    if (!mesclado.menu_url) mesclado.menu_url = PADROES.menu_url;
    return mesclado;
  },

  async ler(chave) {
    return (await this.todos())[chave];
  },

  async lerNumero(chave) {
    const numero = Number(await this.ler(chave));
    return Number.isFinite(numero) ? numero : Number(PADROES[chave]);
  },

  async gravar(chave, valor) {
    await alteradas(`
      INSERT INTO ajustes (chave, valor) VALUES (?, ?)
      ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor
    `, [chave, String(valor)]);
  },

  async gravarVarios(mapa) {
    for (const [chave, valor] of Object.entries(mapa)) {
      if (chave in PADROES) await this.gravar(chave, valor);
    }
    return this.todos();
  }
};
