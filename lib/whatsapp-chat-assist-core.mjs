// Melhorias do Chat do WhatsApp (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-30, WA-37). Regras PURAS
// (testes: tests/whatsapp-chat-assist-core.test.mjs). Servidor: lib/whatsapp-chat.js, lib/ai-chat-assist.js,
// lib/whatsapp-service-stall.js; tela: components/WhatsappChat.jsx, components/WhatsappChatShortcuts.jsx.

const firstName = (value) => String(value || "").trim().split(/\s+/)[0] || "";

// (3) Variáveis dos atalhos: mesma escrita em [colchetes] dos atalhos do Marketplace (MKT-2f) — [nome] = 1º nome do cliente,
// [empreendimento] = imóvel da última simulação, [corretor] = 1º nome de quem envia ([anúncio] só existe no Marketplace).
// No WhatsApp o atalho SAI direto, então variável conhecida sem valor some (nunca "[nome]" ao cliente); outros [colchetes]
// ficam como estão.
export const SHORTCUT_VARIABLES = Object.freeze(["[nome]", "[empreendimento]", "[corretor]"]);
const plainKey = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export function hasShortcutVariables(text) {
  return /\[(nome|empreendimento|corretor|anuncio|anúncio)\]/i.test(String(text || ""));
}
export function fillShortcutVariables(text, { clientName = "", development = "", brokerName = "" } = {}) {
  const values = { nome: firstName(clientName), empreendimento: String(development || "").trim(), corretor: firstName(brokerName), anuncio: "" };
  return String(text || "")
    .replace(/\[([^\[\]]{1,20})\]/g, (match, key) => (plainKey(key) in values ? values[plainKey(key)] : match))
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// (3) "Pacote da equipe": atalho com team_manager_id só aparece para o próprio gestor, os corretores dele
// (admin_users.manager_id), os associados desses corretores e o administrador geral. Sem team_manager_id = todos (como sempre).
// viewer: { generalAdmin, profileId, managerId, linkedBrokerManagerId }
export function shortcutVisibleToViewer(row, viewer = null) {
  const team = row?.team_manager_id || null;
  if (!team) return true;
  if (!viewer) return false;
  if (viewer.generalAdmin) return true;
  return [viewer.profileId, viewer.managerId, viewer.linkedBrokerManagerId].filter(Boolean).includes(team);
}

// (1) "Sem resposta" (ex-"Aguardando nós"): quem espera há mais tempo primeiro.
export function sortWaitingOldestFirst(rows = []) {
  const at = (row) => new Date(row?.lastMessageAt || row?.last_message_at || 0).getTime() || 0;
  return [...rows].sort((a, b) => at(a) - at(b));
}

// (2) "Me lembre": horário escolhido -> ISO. Fuso de São Paulo (UTC-3, sem horário de verão desde 2019).
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
function spDayStartUtc(nowMs, addDays = 0) {
  const sp = new Date(nowMs - SP_OFFSET_MS);
  return Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + addDays) + SP_OFFSET_MS;
}
export const REMINDER_CHOICES = Object.freeze(["in_1h", "today_18", "tomorrow_9", "custom"]);
export function reminderScheduledAt(choice, { now = Date.now(), custom = "" } = {}) {
  let at = null;
  if (choice === "in_1h") at = now + 60 * 60 * 1000;
  else if (choice === "today_18") at = spDayStartUtc(now) + 18 * 3600000;
  else if (choice === "tomorrow_9") at = spDayStartUtc(now, 1) + 9 * 3600000;
  else if (choice === "custom") {
    // datetime-local ("2026-10-30T15:00") = horário de São Paulo.
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(custom || ""));
    if (match) at = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) + SP_OFFSET_MS;
  }
  if (!Number.isFinite(at) || at <= now) return null;
  return new Date(at).toISOString();
}
export function reminderTitle(contactName = "") {
  return `Retornar no Chat: ${String(contactName || "").trim() || "contato"}`.slice(0, 160);
}

// (6) Falha de COMUNICAÇÃO com o serviço do WhatsApp individual (Railway fora / sem resposta) — diferente de recusa do
// WhatsApp ao destinatário. Base: lib/whatsapp-individual.js (callService) e erros do fetch do Node.
const SERVICE_COMM_PATTERN = /falha ao comunicar com o servi[cç]o|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|UND_ERR|operation was aborted|TimeoutError|timed out/i;
export function isServiceCommError(message) {
  return SERVICE_COMM_PATTERN.test(String(message || ""));
}
export const SERVICE_UNREACHABLE_KEY_PREFIX = "wa_svc_unreachable:";
// Uma queda = uma hora cheia de São Paulo (várias falhas na mesma hora = um aviso só; UNIQUE da Central).
export function serviceUnreachableDedupeKey(now = Date.now()) {
  const sp = new Date(now - SP_OFFSET_MS).toISOString().slice(0, 13);
  return `${SERVICE_UNREACHABLE_KEY_PREFIX}${sp}`;
}

// (4) "Sugerir resposta": rascunho para o corretor revisar. NUNCA enviado automaticamente.
export const REPLY_SUGGESTION_INSTRUCTIONS = `Você ajuda um corretor da equipe do Matheus Machado Corretor de Imóveis (Minha Casa Minha Vida, primeiro imóvel, Marília/SP) a responder um cliente no WhatsApp.
Escreva SOMENTE o texto da próxima mensagem do corretor para o cliente, em português do Brasil, curto (até 3 frases), cordial e natural, sem markdown, sem assinatura e sem aspas.
Regras obrigatórias:
- Nunca prometa aprovação de financiamento, crédito, subsídio, valor de parcela, entrada ou taxa. Não invente números nem condições.
- Não invente informação que não está na conversa; se faltar dado, faça uma pergunta simples.
- Se citar a empresa, use exatamente "Matheus Machado Corretor de Imóveis".`;

const FORBIDDEN_PROMISE = /(aprova(d[oa]|ção)\s+(garantid|cert)|garant\w*\s+(a\s+)?(sua\s+)?aprova|com certeza (vai|será) aprovad|crédito garantido|parcela garantida)/i;
export function sanitizeReplySuggestion(text) {
  const clean = String(text || "").replace(/^["'“”]+|["'“”]+$/g, "").replace(/Matheus Machado Im[óo]veis/gi, "Matheus Machado Corretor de Imóveis").trim();
  if (!clean || FORBIDDEN_PROMISE.test(clean)) return "";
  return clean.slice(0, 1000);
}

// Cliente "Não contactar" / telefone bloqueado: sem sugestão de IA.
export function replySuggestionBlocked({ clientStatus = "", phoneDoNotContact = false, isGroup = false } = {}) {
  return isGroup || phoneDoNotContact || clientStatus === "do_not_contact";
}
