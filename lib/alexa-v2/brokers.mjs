import { BROKER_ALIASES } from "./broker-aliases.mjs";

// Reconhece o corretor falado ("Eduardo", "a Izabela Silvério", "Kathleen")
// pelo catálogo central: primeiro nome, nome completo, primeiro+último nome e
// apelidos de BROKER_ALIASES. Sem acento/caixa. Nome ambíguo (dois corretores
// com a mesma chave) NÃO é adivinhado: devolve null.
export function normalizeName(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ARTICLE = /^(o|a|os|as|do|da|de|dos|das|pro|pra|pelo|pela)\s+/;

export function brokerKeys(item, aliasMap = BROKER_ALIASES) {
  const fullName = normalizeName(item.fullName || item.name);
  const parts = fullName.split(" ").filter(Boolean);
  const first = parts[0] || normalizeName(item.name);
  const keys = new Set([fullName, first, normalizeName(item.name)]);
  if (parts.length > 1) keys.add(`${parts[0]} ${parts[parts.length - 1]}`);
  for (const alias of aliasMap[first] || []) keys.add(normalizeName(alias));
  for (const alias of item.aliases || []) keys.add(normalizeName(alias));
  keys.delete("");
  return [...keys];
}

export function makeBrokerMatcher(list = [], aliasMap = BROKER_ALIASES) {
  const entries = list
    .filter((item) => item?.name || item?.fullName)
    .map((item) => ({ id: item.id || "", name: item.name || String(item.fullName).split(" ")[0], gender: item.gender || "", keys: brokerKeys(item, aliasMap) }));

  const unique = (found) => (found.length === 1 ? { id: found[0].id, name: found[0].name, gender: found[0].gender } : null);

  return {
    names: entries.map((entry) => entry.name),
    entries,
    byId(id) {
      return id ? unique(entries.filter((entry) => entry.id === id)) : null;
    },
    match(text) {
      const value = normalizeName(text).replace(ARTICLE, "");
      if (!value) return null;
      const exact = entries.filter((entry) => entry.keys.includes(value));
      if (exact.length) return unique(exact);
      if (value.length < 2) return null;
      // "izabela silverio souza" (chave "izabela") ou "izab" (começo de chave); nunca "eduarda" -> "edu".
      const prefix = entries.filter((entry) => entry.keys.some((key) => key.startsWith(value) || value.startsWith(`${key} `)));
      return unique(prefix);
    }
  };
}
