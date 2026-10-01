// Reconhece o nome de um corretor falado ("Eduardo", "a Bruna") entre os
// corretores da equipe. Sem acento/caixa; casa pelo primeiro nome. Se houver
// dois corretores com o mesmo primeiro nome, não adivinha (devolve null).
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s'-]/g, "")
    .trim();
}

export function makeBrokerMatcher(list = []) {
  const entries = list.filter((item) => item?.name).map((item) => ({ id: item.id || "", name: item.name, key: normalize(item.name) }));
  return {
    names: entries.map((entry) => entry.name),
    match(text) {
      const value = normalize(text).replace(/^(o|a|do|da|de)\s+/, "");
      if (!value) return null;
      const exact = entries.filter((entry) => entry.key === value);
      if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };
      if (exact.length > 1) return null;
      const starts = entries.filter((entry) => entry.key.startsWith(value) || value.startsWith(entry.key));
      return starts.length === 1 ? { id: starts[0].id, name: starts[0].name } : null;
    }
  };
}
