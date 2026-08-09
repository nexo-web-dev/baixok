const TERMOS_COM_ESTOQUE = [
  "drink",
  "drinks",
  "bebida",
  "bebidas",
  "refri",
  "refrigerante",
  "suco",
  "agua",
  "agua mineral",
  "coca",
  "guarana",
  "cerveja"
];

const normalizar = valor => String(valor || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase()
  .trim();

export function controlaEstoqueCategoria(categoria) {
  const valor = normalizar(categoria);
  return TERMOS_COM_ESTOQUE.some(termo => valor.includes(termo));
}
