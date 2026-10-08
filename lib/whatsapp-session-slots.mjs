// Puro (sem banco, sem "server-only") — DOIS números de WhatsApp individual por corretor
// (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-08): "Número 1" e "Número 2", cada um com a própria
// sessão Baileys, presos ao corretor.
//
// Compatibilidade (migração sem queda): o Número 1 usa EXATAMENTE as chaves de antes — id da sessão
// no microsserviço = id do corretor (/sessions/<userId>/...), session_key da conversa = id do corretor,
// whatsapp_messages.session_user_id = id do corretor. O Número 2 usa o id de sessão "<userId>:2" no
// microsserviço (que trata o id como texto opaco, sem nenhuma mudança lá) e, no banco, a mesma
// session_key/session_user_id do corretor + a coluna session_slot = 2.

export const MAX_WHATSAPP_SLOTS = 2;
export const WHATSAPP_SLOTS = [1, 2];
const SLOT_LABEL_MAX = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valor vindo de requisição/linha -> 1 | 2. Vazio/ausente = 1 (tudo que existia antes é o Número 1).
// Qualquer outro valor = null (o chamador recusa).
export function normalizeSlot(value) {
  if (value === undefined || value === null || value === "") return 1;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_WHATSAPP_SLOTS ? n : null;
}

// Id da sessão no microsserviço. Número 1 = o próprio id do corretor (inalterado).
export function buildSessionId(userId, slot = 1) {
  const clean = String(userId || "").trim();
  if (!clean) return "";
  return normalizeSlot(slot) === 2 ? `${clean}:2` : clean;
}

// "<uuid>" -> { userId, slot: 1 }; "<uuid>:2" -> { userId, slot: 2 }; qualquer outra coisa -> null.
export function parseSessionId(value) {
  const raw = String(value || "").trim();
  const match = /^([0-9a-f-]{36})(?::(\d))?$/i.exec(raw);
  if (!match || !UUID.test(match[1])) return null;
  const slot = match[2] === undefined ? 1 : normalizeSlot(match[2]);
  if (slot === null || (match[2] !== undefined && slot === 1)) return null; // "<uuid>:1" não existe: o Número 1 é o id puro
  return { userId: match[1], slot };
}

// Chave usada nos alertas (dedupe da Central): Número 1 = id do corretor (chaves antigas intactas);
// Número 2 = "<id>#2" (o "#" impede que um LIKE "wa_disc:<id>:%" do Número 1 pegue o Número 2).
export function alertSubjectKey(userId, slot = 1) {
  return normalizeSlot(slot) === 2 ? `${userId}#2` : String(userId || "");
}

// Chave "Usar para disparo": NULL = padrão do número (ligado no 1, desligado no 2).
export function isSlotDispatchEnabled(row) {
  if (!row) return false;
  if (row.dispatch_enabled === true || row.dispatch_enabled === false) return row.dispatch_enabled;
  return (normalizeSlot(row.slot) || 1) === 1;
}

export function sanitizeSlotLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, SLOT_LABEL_MAX);
}

// "Número 2" | "Número 2 · Trabalho"
export function slotDisplayName(slot, label = "") {
  const clean = sanitizeSlotLabel(label);
  const base = `Número ${normalizeSlot(slot) || 1}`;
  return clean ? `${base} · ${clean}` : base;
}

// Linhas de whatsapp_individual_sessions de UM corretor -> status "do corretor" (para quem só pergunta
// "o WhatsApp dele está conectado?": Prospecção, Meta Diária manual, selo do cabeçalho...). Conectado se
// QUALQUER número estiver conectado; senão o status do Número 1 (ou do 2, se só ele existir). Sem
// linha nenhuma = null (nunca configurou). Com só o Número 1 (todo mundo hoje) = exatamente o de antes.
export function aggregateSessionStatus(rows = []) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return null;
  if (list.some((row) => row.status === "connected")) return "connected";
  const first = list.find((row) => (normalizeSlot(row.slot) || 1) === 1) || list[0];
  return first.status || null;
}

// Linha que representa o corretor quando a tela mostra UMA só (conectada primeiro; depois o Número 1).
export function representativeSessionRow(rows = []) {
  const list = (rows || []).filter(Boolean).sort((a, b) => (normalizeSlot(a.slot) || 1) - (normalizeSlot(b.slot) || 1));
  return list.find((row) => row.status === "connected") || list[0] || null;
}

// Agrupa linhas de vários corretores: Map(userId -> linhas ordenadas por número).
export function groupSessionRowsByUser(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row?.user_id) continue;
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push(row);
  }
  for (const list of map.values()) list.sort((a, b) => (normalizeSlot(a.slot) || 1) - (normalizeSlot(b.slot) || 1));
  return map;
}

// Números que a automação da Meta Diária pode usar agora: conectados E com "Usar para disparo" ligado.
export function dispatchSlots(rows = []) {
  return (rows || [])
    .filter((row) => row && row.status === "connected" && isSlotDispatchEnabled(row))
    .map((row) => normalizeSlot(row.slot) || 1)
    .sort((a, b) => a - b);
}

// Status "de disparo" do corretor: 'connected' se há ao menos um número apto; senão o status agregado
// (ou 'disconnected' quando há número conectado mas nenhum com a chave de disparo ligada).
export function dispatchSessionStatus(rows = []) {
  if (dispatchSlots(rows).length) return "connected";
  const aggregated = aggregateSessionStatus(rows);
  return aggregated === "connected" ? "disconnected" : aggregated;
}

// Por qual número sai o próximo envio automático (REGRA OFICIAL — dono, 2026-10-08): com os dois aptos,
// meio a meio — vai pelo que enviou MENOS hoje; empate = alterna (o que não enviou por último; sem
// histórico, o Número 1). Um só apto = ele (se o outro caiu, tudo vai pelo que ficou). Nenhum = null.
// O total do dia e a cadência continuam os do corretor (a divisão nunca aumenta o volume).
export function pickDispatchSlot({ candidates = [], sentTodayBySlot = {}, lastSlot = null } = {}) {
  const slots = [...new Set((candidates || []).map((slot) => normalizeSlot(slot)).filter(Boolean))].sort((a, b) => a - b);
  if (!slots.length) return null;
  if (slots.length === 1) return slots[0];
  const sent = (slot) => Number(sentTodayBySlot?.[slot]) || 0;
  const min = Math.min(...slots.map(sent));
  const tied = slots.filter((slot) => sent(slot) === min);
  if (tied.length === 1) return tied[0];
  const last = lastSlot === null || lastSlot === undefined || lastSlot === "" ? null : normalizeSlot(lastSlot);
  const notLast = tied.filter((slot) => slot !== last);
  return (last && notLast.length ? notLast : tied)[0];
}

// Filtro do Chat por número: "slot1"/"slot2" -> 1/2 (qualquer outro valor -> null).
export function slotFromChatFilter(filter) {
  if (filter === "slot1") return 1;
  if (filter === "slot2") return 2;
  return null;
}
