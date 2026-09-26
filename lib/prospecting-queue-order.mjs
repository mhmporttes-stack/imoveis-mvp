// Ordem da fila de Prospecção: contato SEM NOME vai para o final (regra do dono, 2026-09-26).
// Sem nome = nome vazio, texto genérico ("Sem nome", "Cliente", "Contato"...), só números/símbolos
// (o telefone ou um "." digitado no lugar do nome) ou uma letra solta. Apelidos curtos ("Lu", "Jo")
// são nomes de verdade e continuam na ordem normal.

const GENERIC_NAMES = new Set([
  "sem nome", "sem nome cadastrado", "semnome", "sn", "nome", "cliente", "contato", "lead",
  "desconhecido", "desconhecida", "unknown", "nao informado", "nao identificado", "whatsapp", "n a", "na"
]);

const COMBINING_MARKS = /[̀-ͯ]/g;

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isNamelessContactName(name) {
  const normalized = normalizeName(name);
  if (!normalized) return true; // vazio ou só pontuação ("." , "-")
  if (!/[a-z]/.test(normalized)) return true; // só números (telefone no lugar do nome)
  if (GENERIC_NAMES.has(normalized)) return true;
  return normalized.replace(/[^a-z]/g, "").length < 2; // uma letra solta
}

// Mantém a ordem original dentro de cada grupo: primeiro quem tem nome, depois quem não tem.
export function moveNamelessToEnd(items, getName = (item) => item?.name) {
  const named = [];
  const nameless = [];
  for (const item of items || []) (isNamelessContactName(getName(item)) ? nameless : named).push(item);
  return named.concat(nameless);
}
