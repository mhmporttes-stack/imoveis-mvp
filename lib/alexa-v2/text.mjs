// Auxiliares de frase curta e natural em português (voz). Sem dependências.

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

export function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

// Só o primeiro nome, só letras (sem número, e-mail ou símbolo).
export function firstNameOf(value) {
  const name = String(value || "").trim().split(/\s+/)[0] || "";
  return name.replace(/[^\p{L}'-]/gu, "").slice(0, 20);
}

export function percentText(value) {
  return `${Math.round(Number(value) || 0)} por cento`;
}

// "10 horas", "1 hora", "10 e 30".
export function spokenTime(hours, minutes) {
  if (minutes === 0) return hours === 1 ? "1 hora" : `${hours} horas`;
  return `${hours} e ${String(minutes).padStart(2, "0")}`;
}

export const PAGE_SIZE = 5;

// Fatia uma lista de nomes em páginas de 5. Devolve o texto e se há mais.
export function pageOfNames(names, page = 0, size = PAGE_SIZE) {
  const clean = names.filter(Boolean);
  const start = page * size;
  const slice = clean.slice(start, start + size);
  const remaining = Math.max(0, clean.length - (start + slice.length));
  return { slice, remaining, total: clean.length, hasMore: remaining > 0 };
}

export function namesSentence(names, page = 0) {
  const { slice, remaining } = pageOfNames(names, page);
  if (!slice.length) return "";
  return `${joinNames(slice)}${remaining > 0 ? `, e mais ${remaining}` : ""}.`;
}
