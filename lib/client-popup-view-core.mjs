// Janelinha de cliente novo (CLI-16, dono 2026-10-24) — parte da TELA, pura e sem dependências (vai para o navegador).
// Regras de quais clientes viram janelinha: lib/client-popup-core.mjs (servidor). Testes: tests/client-popup-core.test.mjs.

export const CLIENT_POPUP_MAX_VISIBLE = 3; // empilhados no máximo 3; o resto vira "+N"
export const CLIENT_POPUP_SEEN_TTL_MS = 24 * 60 * 60 * 1000; // "visto" guardado por 24 h (a janela de leitura é 12 h)
export const CLIENT_POPUP_SEEN_MAX = 300;
export const CLIENT_POPUP_STORAGE_PREFIX = "mm_client_popup_seen:";

export const CLIENT_POPUP_KIND = Object.freeze({ NEW: "new", TRANSFER: "transfer", MESSENGER: "messenger" });
export const CLIENT_POPUP_LABEL = Object.freeze({ new: "Cliente novo", transfer: "Transferido", messenger: "Messenger" });

function ms(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : NaN;
}

// Junta o que chegou com o que já está na tela: sem repetir, sem o que já foi visto, mais novo primeiro.
export function mergeClientPopups(current = [], incoming = [], seenKeys = new Set()) {
  const byKey = new Map();
  for (const item of [...current, ...incoming]) {
    if (!item?.key || seenKeys.has(item.key)) continue;
    byKey.set(item.key, { ...byKey.get(item.key), ...item });
  }
  return [...byKey.values()].sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0));
}

// O que aparece agora: até 3 (mais novo em cima) + quantos ficam no "+N". Tela cheia do Henry aberta: nada (fila).
export function visibleClientPopups(items = [], { henryOpen = false, max = CLIENT_POPUP_MAX_VISIBLE } = {}) {
  if (henryOpen) return { visible: [], extra: 0 };
  return { visible: items.slice(0, max), extra: Math.max(0, items.length - max) };
}

// Saída sozinha (REGRA OFICIAL — dono, 2026-10-29: "essas notificações têm que sumir sozinhas e ficar apenas no ícone de
// notificações"). Cada janelinha fica ~7 s NA TELA e some como "vista" neste aparelho (não volta no próximo ciclo nem ao
// recarregar); o aviso do sino (crm_notifications) não é tocado e continua lá até ser lido. O tempo só corre com a
// janelinha visível e sem pausa (mouse/toque/foco em cima, aba oculta, tela cheia do Henry).
export const CLIENT_POPUP_AUTO_DISMISS_MS = 7 * 1000;
export const CLIENT_POPUP_TICK_MS = 250;

// Avança o tempo de tela das janelinhas visíveis. elapsed = Map(key -> ms já exibido). Devolve o novo mapa (só com as
// visíveis — a que saiu da tela esquece o tempo) e as que venceram.
export function advanceClientPopupTimers(elapsed = new Map(), visibleKeys = [], deltaMs = 0, { paused = false, duration = CLIENT_POPUP_AUTO_DISMISS_MS } = {}) {
  const step = paused || !Number.isFinite(deltaMs) ? 0 : Math.max(0, deltaMs);
  const next = new Map();
  const expired = [];
  for (const key of visibleKeys) {
    if (!key) continue;
    const total = (elapsed.get(key) || 0) + step;
    if (total >= duration) expired.push(key);
    else next.set(key, total);
  }
  return { elapsed: next, expired };
}

// Excedentes (além das 3 da tela) vão só para o sino: viram "vistas" na hora, sem nunca virar janelinha depois. Com a
// tela cheia do Henry aberta nada é descartado (a fila espera a cena fechar, regra de 2026-10-23).
export function overflowClientPopupKeys(items = [], { henryOpen = false, max = CLIENT_POPUP_MAX_VISIBLE } = {}) {
  if (henryOpen) return [];
  return items.slice(max).map((item) => item?.key).filter(Boolean);
}

// "Visto" (guardado no aparelho): { key: quando }. Lê tolerando lixo e descarta o que passou de 24 h.
export function parseClientPopupSeen(raw, now = Date.now()) {
  let data = null;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    data = null;
  }
  const seen = new Map();
  if (!data || typeof data !== "object" || Array.isArray(data)) return seen;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "number" && now - value < CLIENT_POPUP_SEEN_TTL_MS) seen.set(key, value);
  }
  return seen;
}

export function addClientPopupSeen(seen = new Map(), keys = [], now = Date.now()) {
  const next = new Map(seen);
  for (const key of keys) if (key) next.set(key, now);
  const entries = [...next.entries()].sort((a, b) => b[1] - a[1]).slice(0, CLIENT_POPUP_SEEN_MAX);
  return new Map(entries);
}

export function serializeClientPopupSeen(seen = new Map()) {
  return JSON.stringify(Object.fromEntries(seen));
}

export const clientPopupStorageKey = (userId) => `${CLIENT_POPUP_STORAGE_PREFIX}${userId || "anon"}`;

// "agora" · "há 5 min" · "há 2 h" · "há 1 dia".
export function clientPopupAge(at, now = Date.now()) {
  const time = ms(at);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

// Segunda linha: de quem veio a transferência, ou a origem do cadastro.
export function clientPopupDetail(item) {
  if (item?.kind === CLIENT_POPUP_KIND.TRANSFER) return item.fromName ? `Transferido de ${item.fromName}` : "Transferido para você";
  return item?.origin || "";
}
