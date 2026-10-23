// CACHE NO SERVIDOR entre requisições (velocidade, etapa 3 — dono, 2026-10-22). Memória da instância (cada função da
// Vercel tem a sua), com prazo curto (TTL) e invalidação por etiqueta (tag) quando o próprio processo grava.
//
// Por que não unstable_cache/revalidateTag (Next 16): unstable_cache é stale-while-revalidate (depois do prazo ainda
// devolve o valor velho uma vez), serializa em JSON (Map/Date se perdem) e revalidateTag lança fora de uma requisição
// (cron em segundo plano, `after()`, renderização de página) — vários escritores destas tabelas rodam nesses contextos.
// Aqui o prazo é rígido: passou do TTL, lê de novo. Outra instância que gravou não avisa esta: por isso todo TTL é
// curto (≤ 30 s) e é ele o limite de atraso entre instâncias.
//
// Regras de segurança:
// - erro nunca fica guardado (a próxima chamada tenta de novo);
// - `keep(valor)` decide se o resultado pode ficar guardado (ex.: só autorização CONCEDIDA e verificada);
// - quem lê recebe uma CÓPIA (structuredClone): mexer no objeto devolvido nunca altera o que está guardado;
// - invalidar durante uma leitura em andamento descarta o resultado dela (não guarda dado anterior à gravação).

export const CACHE_TAGS = Object.freeze({
  ADMIN_USERS: "admin_users",
  TWO_FACTOR: "admin_two_factor",
  TAGS: "tags",
  PROPERTIES: "properties",
  SCORING_RULES: "scoring_rule_versions",
  crmSetting: (id) => `crm_settings:${id}`
});

export const MAX_TTL_MS = 30_000;

export function createServerCache({ now = () => Date.now(), clone = structuredClone, maxEntries = 2000 } = {}) {
  const entries = new Map();
  const generations = new Map();
  const stats = { hits: 0, misses: 0 };
  const generationOf = (tag) => generations.get(tag) || 0;

  function prune(nowMs) {
    if (entries.size < maxEntries) return;
    for (const [key, entry] of entries) if (entry.expiresAt <= nowMs) entries.delete(key);
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
  }

  async function memo(tag, key, ttlMs, loader, { keep = () => true } = {}) {
    const ttl = Math.min(Number(ttlMs) || 0, MAX_TTL_MS);
    if (ttl <= 0) return loader();
    const fullKey = `${tag}\u0000${key}`;
    const nowMs = now();
    let entry = entries.get(fullKey);
    if (entry && (entry.expiresAt <= nowMs || entry.generation !== generationOf(tag))) {
      entries.delete(fullKey);
      entry = null;
    }
    if (entry) {
      stats.hits += 1;
    } else {
      stats.misses += 1;
      prune(nowMs);
      const created = { tag, generation: generationOf(tag), expiresAt: nowMs + ttl, promise: null };
      created.promise = Promise.resolve()
        .then(loader)
        .then(
          (value) => {
            if (!keep(value) && entries.get(fullKey) === created) entries.delete(fullKey);
            return value;
          },
          (error) => {
            if (entries.get(fullKey) === created) entries.delete(fullKey);
            throw error;
          }
        );
      entries.set(fullKey, created);
      entry = created;
    }
    const value = await entry.promise;
    return value === undefined || value === null ? value : clone(value);
  }

  function invalidate(tag) {
    generations.set(tag, generationOf(tag) + 1);
    for (const [key, entry] of entries) if (entry.tag === tag) entries.delete(key);
  }

  function forget(tag, key) {
    entries.delete(`${tag}\u0000${key}`);
  }

  function clear() {
    for (const tag of new Set([...entries.values()].map((entry) => entry.tag))) invalidate(tag);
    entries.clear();
  }

  return { memo, invalidate, forget, clear, stats, size: () => entries.size };
}

// Uma instância por processo (globalThis: rotas diferentes do mesmo processo enxergam o mesmo cache e a mesma invalidação).
export const serverCache = (globalThis.__mmServerCache ??= createServerCache());

// Prazo do cache de um access token: nunca além do vencimento do próprio token (claim exp, só para ENCURTAR o prazo — a
// validade continua sendo conferida pelo Supabase Auth a cada vez que o cache vence).
export function tokenCacheTtlMs(accessToken, nowMs = Date.now(), maxMs = MAX_TTL_MS) {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split(".")[1] || "", "base64url").toString("utf8"));
    const expMs = Number(payload?.exp) * 1000;
    if (!Number.isFinite(expMs)) return 0;
    return Math.max(0, Math.min(maxMs, expMs - nowMs));
  } catch {
    return 0;
  }
}
