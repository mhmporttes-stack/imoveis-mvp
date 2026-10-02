// Aviso discreto "o Chat abriu, mas o contato não pôde ser salvo" (regra do dono, 2026-10-02).
// O botão WhatsApp do card abre o Chat na hora e registra o contato EM PARALELO; se esse
// registro falhar, a página já pode ser a do Chat — por isso o aviso passa por um evento +
// sessionStorage (cobre os dois casos: Chat já aberto ou ainda abrindo). Código de navegador,
// sem "server-only".

export const CONTACT_WARNING_EVENT = "crm:whatsapp-contact-warning";
const KEY = "crm:whatsapp-contact-warning";
const MAX_AGE_MS = 2 * 60 * 1000;

export function flagContactNotSaved(clientName = "") {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ name: String(clientName || ""), at: Date.now() }));
  } catch {
    // sessionStorage indisponível (modo privado/bloqueado): o evento abaixo ainda avisa quem está na tela.
  }
  try {
    window.dispatchEvent(new CustomEvent(CONTACT_WARNING_EVENT, { detail: { name: String(clientName || "") } }));
  } catch {
    // sem window (nunca no uso real).
  }
}

// Lê e consome o aviso pendente (uma vez). null = nada a mostrar ou já velho demais.
export function takeContactNotSavedWarning() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const value = JSON.parse(raw);
    if (!value || Date.now() - Number(value.at || 0) > MAX_AGE_MS) return null;
    return { name: String(value.name || "") };
  } catch {
    return null;
  }
}

export function contactWarningMessage(name = "") {
  const who = String(name || "").trim();
  return `O Chat foi aberto, mas o contato${who ? ` de ${who}` : ""} não pôde ser salvo/sincronizado. Tente registrar de novo pelo card se for preciso.`;
}
