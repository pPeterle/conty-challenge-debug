// Remove espaços nas pontas e caracteres invisíveis (zero-width, word joiner, BOM) que o
// provedor às vezes reenvia junto com a chave no retry.
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

export function normalizeKey(key: string): string {
  return key.replace(INVISIBLE, "").trim().toLowerCase();
}
