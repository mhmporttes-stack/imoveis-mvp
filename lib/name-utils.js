const LOWERCASE_PARTICLES = new Set(["da", "das", "de", "do", "dos", "e"]);

export function normalizePersonName(value) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  return cleaned
    .split(" ")
    .map((part, index) => normalizeNamePart(part, index))
    .join(" ");
}

function normalizeNamePart(part, index) {
  const lower = part.toLocaleLowerCase("pt-BR");
  if (index > 0 && LOWERCASE_PARTICLES.has(lower)) return lower;

  return lower
    .split("-")
    .map((chunk) => normalizeApostropheName(chunk))
    .join("-");
}

function normalizeApostropheName(part) {
  return part
    .split("'")
    .map(capitalize)
    .join("'");
}

function capitalize(value) {
  if (!value) return "";
  return `${value.charAt(0).toLocaleUpperCase("pt-BR")}${value.slice(1)}`;
}
