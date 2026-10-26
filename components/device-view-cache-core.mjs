// Regras puras do cache das telas guardado NO APARELHO (dono, 2026-10-26: "Sim, quero que guarde"). Sem navegador aqui:
// chave por conta, validade, montagem do registro e filtro de campos sensíveis — testadas em
// tests/device-view-cache.test.mjs. A gravação/leitura (IndexedDB) fica em components/device-view-cache.js.
//
// - Um registro só no aparelho, de UMA conta: chave = id do usuário REAL + id do perfil EFETIVO (lib/chat-viewer-key.mjs).
// - "Alterar conta" (real ≠ efetivo) NUNCA vai para o disco: fica só na memória da aba, como antes.
// - Validade de 24 h por item (o que for mais velho é descartado); versão do formato (SCHEMA) — outra versão = apaga.
// - Só o que a lista mostra: CPF, PIS, documentos, arquivos, mídia, tokens e endereços de arquivo nunca são guardados.

export const DEVICE_CACHE_SCHEMA = 1;
export const DEVICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Relógio do aparelho adiantado/atrasado: item "do futuro" além disso é tratado como inválido.
export const DEVICE_CACHE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const DEVICE_CACHE_MAX_DETAILS = 8;
export const DEVICE_CACHE_MAX_MESSAGES = 60;
export const DEVICE_CACHE_MAX_CHARS = 2_500_000;
const MAX_STRING_CHARS = 20_000;

export function parseViewerKey(key) {
  const text = typeof key === "string" ? key : "";
  const parts = text.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { realId: parts[0], effectiveId: parts[1] };
}

// Só a conta própria (fora de "Alterar conta") vai para o disco.
export function canPersistViewerKey(key) {
  const parsed = parseViewerKey(key);
  return Boolean(parsed && parsed.realId === parsed.effectiveId);
}

export function isFreshStamp(at, now = Date.now()) {
  const stamp = Number(at);
  if (!Number.isFinite(stamp) || stamp <= 0) return false;
  if (stamp > now + DEVICE_CACHE_CLOCK_SKEW_MS) return false;
  return now - stamp <= DEVICE_CACHE_TTL_MS;
}

// O que fazer com o registro guardado ao abrir com a conta `key`:
// "use" = é desta conta e está no formato atual; "ignore" = nada guardado; "wipe" = de outra pessoa, de "Alterar conta"
// (nunca deveria estar no disco) ou de outra versão — apagar tudo.
export function snapshotDecision(snapshot, key) {
  if (!snapshot || typeof snapshot !== "object") return "ignore";
  if (snapshot.schema !== DEVICE_CACHE_SCHEMA) return "wipe";
  if (!canPersistViewerKey(snapshot.key)) return "wipe";
  if (!canPersistViewerKey(key)) {
    // Abrindo em "Alterar conta": o registro é do próprio admin real — fica guardado, mas não é usado aqui.
    const current = parseViewerKey(key);
    return current && parseViewerKey(snapshot.key).realId === current.realId ? "ignore" : "wipe";
  }
  return snapshot.key === key ? "use" : "wipe";
}

// ---------- filtro de campos sensíveis ----------

const SENSITIVE_KEY = /cpf|cnpj|^rg$|^pis$|^nis$|ctps|^cnh$|password|senha|secret|token|birth_?date|date_?of_?birth|nascimento|base64|pdf_?data|signed_?url|^payload$|^raw$/i;
// Documento/arquivo: contagem (número/sim-não) fica; lista, objeto ou texto sai.
const DOCUMENT_KEY = /^(documents?|documentos?|files?|arquivos?|anexos?)$/i;
// Campos de mídia: dentro deles, nome de arquivo sai e endereço só fica se for uma rota do próprio CRM.
const MEDIA_KEY = /^(media|attachments?|photos?|images?|thumbnails?|avatars?|pictures?|files?)$/i;
const URL_KEY = /(^url$|^src$|^href$|url$|_url$)/i;
const MEDIA_NAME_KEY = /^(name|file_?name|media_?name|filename|path|bucket|storage_?path)$/i;

function isOwnRoute(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function cleanString(value) {
  if (value.length > MAX_STRING_CHARS) return undefined;
  if (/^data:/i.test(value.trim())) return undefined;
  return value;
}

function sanitizeValue(value, inMedia, depth) {
  if (depth > 12) return undefined;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return cleanString(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const clean = sanitizeValue(item, inMedia, depth + 1);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      if (DOCUMENT_KEY.test(key) && typeof item !== "number" && typeof item !== "boolean") continue;
      if (inMedia && MEDIA_NAME_KEY.test(key)) continue;
      if (URL_KEY.test(key) && typeof item === "string") {
        // Endereço de arquivo/página: só a rota do próprio CRM (que confere o login) — nunca link externo ou assinado.
        if (isOwnRoute(item) && !/[?&](token|signature|sig|x-amz|expires)=/i.test(item)) out[key] = item;
        continue;
      }
      if (key === "messages" && Array.isArray(item)) {
        const clean = sanitizeValue(item.slice(-DEVICE_CACHE_MAX_MESSAGES), inMedia, depth + 1);
        if (clean !== undefined) out[key] = clean;
        continue;
      }
      const clean = sanitizeValue(item, inMedia || MEDIA_KEY.test(key), depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return undefined; // função, símbolo, undefined
}

// Cópia limpa do que pode ir para o aparelho. Nunca altera o objeto recebido.
export function sanitizeForDevice(value) {
  const clean = sanitizeValue(value, false, 0);
  return clean === undefined ? null : clean;
}

// ---------- montagem do registro ----------

// entry = { view: { at, value } | null, details: [{ id, at, value }], data: [{ name, at, value }] } (memória da aba)
// previous = registro já gravado (mesma conta). A memória vence item a item; vencidos saem; limites aplicados.
export function buildSnapshot({ key, entry, previous = null, now = Date.now() }) {
  if (!canPersistViewerKey(key)) return null;
  const base = previous && snapshotDecision(previous, key) === "use" ? previous : null;

  const pickView = [entry?.view, base?.view].find((item) => item && isFreshStamp(item.at, now)) || null;

  const details = new Map();
  for (const item of [...(base?.details || []), ...(entry?.details || [])]) {
    if (item?.id && isFreshStamp(item.at, now)) details.set(item.id, item);
  }
  const data = new Map();
  for (const item of [...(base?.data || []), ...(entry?.data || [])]) {
    if (item?.name && isFreshStamp(item.at, now)) data.set(item.name, item);
  }

  const snapshot = {
    schema: DEVICE_CACHE_SCHEMA,
    key,
    savedAt: now,
    view: pickView ? { at: pickView.at, value: sanitizeForDevice(pickView.value) } : null,
    details: [...details.values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, DEVICE_CACHE_MAX_DETAILS)
      .map((item) => ({ id: item.id, at: item.at, value: sanitizeForDevice(item.value) })),
    data: [...data.values()]
      .sort((a, b) => b.at - a.at)
      .map((item) => ({ name: item.name, at: item.at, value: sanitizeForDevice(item.value) }))
  };
  return fitSnapshot(snapshot);
}

// Grande demais: tira primeiro as conversas abertas mais antigas, depois os dados mais antigos.
function fitSnapshot(snapshot) {
  const size = () => JSON.stringify(snapshot).length;
  while (size() > DEVICE_CACHE_MAX_CHARS && snapshot.details.length) snapshot.details.pop();
  while (size() > DEVICE_CACHE_MAX_CHARS && snapshot.data.length) snapshot.data.pop();
  if (size() > DEVICE_CACHE_MAX_CHARS) snapshot.view = null;
  return snapshot;
}

// O que pode ser usado agora de um registro da conta `key` (só itens dentro da validade).
export function usableSnapshot(snapshot, key, now = Date.now()) {
  if (snapshotDecision(snapshot, key) !== "use") return null;
  return {
    view: snapshot.view && isFreshStamp(snapshot.view.at, now) ? snapshot.view : null,
    details: (snapshot.details || []).filter((item) => item?.id && isFreshStamp(item.at, now)),
    data: (snapshot.data || []).filter((item) => item?.name && isFreshStamp(item.at, now))
  };
}
