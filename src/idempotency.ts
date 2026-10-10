// Remove caracteres de formatação Unicode (categoria Cf: zero-width, word joiner,
// soft hyphen, marcas de direção, BOM) e espaços nas pontas, que o provedor às
// vezes reenvia junto com a chave no retry.
const FORMAT_CHARS = /\p{Cf}/gu;

export function normalizeKey(key: string): string {
  return key.replace(FORMAT_CHARS, "").trim().toLowerCase();
}
