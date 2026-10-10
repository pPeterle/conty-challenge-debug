// Remove espaços nas pontas e caracteres invisíveis (zero-width, BOM) que o
// provedor às vezes reenvia junto com a chave no retry.
const INVISIBLE = /[​-‍⁠﻿]/g;

export function normalizeKey(key: string): string {
  return key.replace(INVISIBLE, "").trim().toLowerCase();
}
