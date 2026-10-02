// Manual do CRM — regras PURAS e seguras para o cliente (testes: tests/manual-core.test.mjs).
// NÃO importe aqui a guarda de conteúdo (SOMENTE servidor). Dados: lib/manual.js.

export const MANUAL_AUDIENCE = Object.freeze({ ALL: "all", BROKER: "broker", MANAGER: "manager", ADMIN: "admin" });
export const MANUAL_AUDIENCES = Object.values(MANUAL_AUDIENCE);
export const CONTENT_STATUS = Object.freeze({ DRAFT: "draft", PENDING: "pending", PUBLISHED: "published", DISCARDED: "discarded" });
export const NEW_BADGE_DAYS = 7;

export class ManualError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ManualError";
    this.status = status;
  }
}

// Níveis que cada papel EFETIVO enxerga (admin vê tudo).
const ROLE_LEVELS = Object.freeze({
  admin: MANUAL_AUDIENCES,
  manager: ["all", "broker", "manager"],
  broker: ["all", "broker"],
  associate: ["all", "broker"]
});
export const MANUAL_ROLES = Object.keys(ROLE_LEVELS);

export function canSeeContent(profile, audiences) {
  const levels = ROLE_LEVELS[profile?.role];
  if (!levels) return false;
  const list = Array.isArray(audiences) ? audiences : [];
  return list.some((audience) => levels.includes(audience));
}

// Papéis (explícitos) que recebem conteúdo com estas audiências.
export function rolesForAudiences(audiences) {
  return MANUAL_ROLES.filter((role) => canSeeContent({ role }, audiences));
}

export function normalizeAudiences(value) {
  const list = Array.isArray(value) ? value : [];
  const clean = [...new Set(list.map((item) => String(item)))];
  if (!clean.length || clean.some((item) => !MANUAL_AUDIENCES.includes(item))) {
    throw new ManualError("Audiência inválida.");
  }
  return clean;
}

export function normalizeSlug(value) {
  const slug = String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug || slug.length > 80) throw new ManualError("Identificador inválido.");
  return slug;
}

export function cleanText(value, { max = 20000, required = false, field = "Campo" } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new ManualError(`${field} é obrigatório.`);
  if (text.length > max) throw new ManualError(`${field} excede o tamanho permitido.`);
  return text;
}

// "Novo" é DERIVADO na leitura (nunca grava/sobrescreve): selo vigente
// (badge_until no futuro) ou atualizado há menos de 7 dias.
export function isNewItem(item, now = Date.now()) {
  if (!item) return false;
  const until = item.badge_until ? new Date(item.badge_until).getTime() : 0;
  if (until && until > now) return true;
  const stamp = item.last_updated_at || item.updated_at || item.published_at;
  const at = stamp ? new Date(stamp).getTime() : 0;
  return Boolean(at) && now - at < NEW_BADGE_DAYS * 86400000 && now >= at;
}

// Âncora estável para a ajuda contextual futura: /admin/manual#topico/subtopico
export function manualHref(topicSlug, sectionSlug) {
  const topic = String(topicSlug || "");
  if (!topic) return "/admin/manual";
  return `/admin/manual#${topic}${sectionSlug ? `/${sectionSlug}` : ""}`;
}

export function newsHref(slug) {
  return `/admin/manual?novidade=${encodeURIComponent(slug)}`;
}

// Transições (a autorização de QUEM aprova fica no servidor).
const TOPIC_TRANSITIONS = {
  draft: ["pending"],
  pending: ["draft", "published"],
  published: ["pending"]
};
const NEWS_TRANSITIONS = {
  draft: ["pending", "discarded"],
  pending: ["draft", "published", "discarded"],
  published: [],
  discarded: ["draft"]
};
export function canTransition(kind, from, to) {
  const table = kind === "news" ? NEWS_TRANSITIONS : TOPIC_TRANSITIONS;
  return Boolean(table[from]?.includes(to));
}
export function requiresApprover(kind, to) {
  return to === CONTENT_STATUS.PUBLISHED;
}

function stripAudience(row) {
  const { audiences: _a, status: _s, published_version_id: _v, ...rest } = row;
  return rest;
}

// Monta a árvore VISÍVEL: só published, só audiência do perfil, tópico
// invisível esconde todas as suas seções, e sem campo audiences/status.
export function buildVisibleManual({ topics = [], sections = [] }, profile, now = Date.now()) {
  const out = [];
  for (const topic of [...topics].sort(bySort)) {
    if (topic.status !== CONTENT_STATUS.PUBLISHED || !canSeeContent(profile, topic.audiences)) continue;
    const visible = sections
      .filter((s) => s.topic_id === topic.id && s.status === CONTENT_STATUS.PUBLISHED && canSeeContent(profile, s.audiences))
      .sort(bySort)
      .map((s) => ({
        slug: s.slug,
        title: s.title,
        body: s.body,
        sort_order: s.sort_order,
        last_updated_at: s.last_updated_at,
        isNew: isNewItem(s, now),
        href: manualHref(topic.slug, s.slug)
      }));
    if (!visible.length) continue;
    out.push({
      slug: topic.slug,
      title: topic.title,
      description: topic.description,
      icon: topic.icon,
      sort_order: topic.sort_order,
      updated_at: topic.updated_at,
      isNew: visible.some((s) => s.isNew),
      sections: visible
    });
  }
  return out;
}

function bySort(a, b) {
  return (a.sort_order || 0) - (b.sort_order || 0) || String(a.title).localeCompare(String(b.title), "pt-BR");
}

export function buildVisibleNews(news = [], profile, readIds = new Set(), now = Date.now()) {
  return news
    .filter((n) => n.status === CONTENT_STATUS.PUBLISHED && canSeeContent(profile, n.audiences))
    .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0))
    .map((n) => ({
      id: n.id,
      slug: n.slug,
      title: n.title,
      body: n.body,
      important: Boolean(n.important),
      requires_ack: Boolean(n.requires_ack),
      published_at: n.published_at,
      isNew: isNewItem({ badge_until: n.badge_until, published_at: n.published_at }, now),
      read: readIds.has(n.id)
    }));
}

function fold(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Busca PURA: só sobre conteúdo JÁ filtrado (saída de buildVisibleManual).
export function searchVisibleManual(visibleTopics = [], query) {
  const terms = fold(query).split(/\s+/).filter((t) => t.length >= 2);
  if (!terms.length) return [];
  const hits = [];
  for (const topic of visibleTopics) {
    for (const section of topic.sections) {
      const title = fold(section.title);
      const body = fold(section.body);
      if (!terms.every((t) => title.includes(t) || body.includes(t) || fold(topic.title).includes(t))) continue;
      const score = terms.reduce((sum, t) => sum + (title.includes(t) ? 3 : 0) + (body.includes(t) ? 1 : 0), 0);
      const at = body.indexOf(terms.find((t) => body.includes(t)) || "\u0000");
      const raw = String(section.body || "");
      const snippet = at >= 0 ? raw.slice(Math.max(0, at - 40), at + 120).trim() : raw.slice(0, 120).trim();
      hits.push({ topicSlug: topic.slug, topicTitle: topic.title, sectionSlug: section.slug, title: section.title, snippet, href: section.href, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 30).map(({ score: _s, ...hit }) => hit);
}
