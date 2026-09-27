// Nome "utilizável" para uma mensagem pessoal (Disparo). Puro, sem banco — usado tanto no sorteio automático da
// Base da Imobiliária quanto na seleção manual, para nunca mandar campanha com "Olá, !" ou um nome placeholder.
//
// REGRA OBRIGATÓRIA: contato sem nome de verdade nunca pode ser selecionado num sorteio de campanha. Nunca
// inventamos/preenchemos um nome — só filtramos quem não tem um usável.

const PLACEHOLDER_NAMES = new Set([
  "sem nome", "sem-nome", "semnome", "desconhecido", "desconhecida", "não informado", "nao informado",
  "n/a", "na", "cliente", "teste", "test", "cliente whatsapp", "usuario", "usuário", "anonimo", "anônimo"
]);

export function isUsableContactName(rawName) {
  const name = String(rawName ?? "").trim();
  if (!name) return false;
  if (name.length < 2) return false;
  const normalized = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (PLACEHOLDER_NAMES.has(normalized)) return false;
  // Só dígitos/pontuação (ex.: ".", "-", "0800", um telefone digitado no campo nome): sem nenhuma letra, não conta.
  if (!/\p{L}/u.test(name)) return false;
  return true;
}
