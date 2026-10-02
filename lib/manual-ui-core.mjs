// Núcleo PURO da interface do Manual do CRM (sem React, sem servidor): texto
// seguro, âncoras, datas, regras de exibição e debounce lógico. Testável com
// node --test. O componente cliente importa só este arquivo e manual-core.mjs.

export const STATUS_LABELS = Object.freeze({
  draft: "Rascunho",
  pending: "Aguardando aprovação",
  published: "Publicado",
  discarded: "Descartado"
});

export const AUDIENCE_OPTIONS = Object.freeze([
  { value: "all", label: "Todos" },
  { value: "broker", label: "Corretor" },
  { value: "manager", label: "Gestora" },
  { value: "admin", label: "Admin" }
]);

export const OWNER_ONLY_NOTICE = "Somente o Matheus aprova e publica";
export const CONTENT_NOT_ALLOWED = "Conteúdo não permitido — revise o texto";

export function statusLabel(status) {
  return STATUS_LABELS[status] || "—";
}

// ---------- texto seguro ----------
// Converte o corpo em blocos simples. NUNCA gera HTML: o React escapa cada
// string como texto. Suporta parágrafos, "## subtítulo", listas "- " e "1. ".
export function parseSafeText(body) {
  const lines = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushParagraph(); flushList(); continue; }
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: "h", text: heading[1].trim() }); continue; }
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\d{1,2}[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((bullet || numbered)[1].trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

// ---------- âncoras ----------
export function parseAnchor(hash) {
  const clean = String(hash || "").replace(/^#/, "");
  if (!clean) return { topic: "", section: "" };
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* mantém o bruto */ }
  const [topic = "", section = ""] = decoded.split("/");
  return { topic, section };
}

// Decide o que abrir ao carregar. Só abre o que existe (conteúdo invisível ao
// perfil nem chega aqui). ?novidade= tem prioridade sobre o hash.
export function resolveOpening({ hash = "", novidade = "", topics = [], news = [] } = {}) {
  if (novidade) {
    const item = news.find((n) => n.slug === novidade);
    if (item) return { view: "news", topicSlug: "", sectionSlug: "", newsSlug: item.slug };
  }
  const { topic, section } = parseAnchor(hash);
  const found = topics.find((t) => t.slug === topic);
  if (found) {
    const sec = found.sections.find((s) => s.slug === section);
    return { view: "topic", topicSlug: found.slug, sectionSlug: sec ? sec.slug : "", newsSlug: "" };
  }
  return { view: "home", topicSlug: "", sectionSlug: "", newsSlug: "" };
}

export function sectionDomId(topicSlug, sectionSlug) {
  return sectionSlug ? `manual-${topicSlug}-${sectionSlug}` : `manual-${topicSlug}`;
}

// ---------- datas e selos ----------
export function formatUpdatedDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(date);
}

export function updatedLabel(value) {
  const text = formatUpdatedDate(value);
  return text ? `Última atualização: ${text}` : "";
}

export function showNewBadge(item) {
  return item?.isNew === true;
}

export function showAckButton(news) {
  return Boolean(news?.requires_ack) && !news?.read;
}

// ---------- aprovação (só o dono) ----------
export function canShowApprovalButtons({ isOwner } = {}) {
  return isOwner === true;
}

// { buttons, notice }: notice é o texto discreto exibido no lugar/ao lado.
export function approvalState({ isOwner = false, ownerViewingAsOther = false } = {}) {
  if (isOwner) return { buttons: true, notice: "" };
  if (ownerViewingAsOther) {
    return { buttons: false, notice: "Você está em outra conta. Volte à sua própria conta para aprovar e publicar." };
  }
  return { buttons: false, notice: OWNER_ONLY_NOTICE };
}

// ---------- busca ----------
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_DEBOUNCE_MS = 300;

export function searchPlan(query) {
  const q = String(query ?? "").trim().slice(0, 80);
  return { q, run: q.length >= SEARCH_MIN_CHARS };
}

// Debounce com relógio injetável (testável sem esperar).
export function createDebouncer(fn, ms = SEARCH_DEBOUNCE_MS, timers = { set: setTimeout, clear: clearTimeout }) {
  let handle = null;
  const call = (...args) => {
    if (handle !== null) timers.clear(handle);
    handle = timers.set(() => { handle = null; fn(...args); }, ms);
  };
  call.cancel = () => { if (handle !== null) timers.clear(handle); handle = null; };
  return call;
}

// ---------- erros ----------
export function apiErrorMessage(status, serverMessage, fallback = "Não foi possível concluir. Tente novamente.") {
  if (status === 422) return CONTENT_NOT_ALLOWED;
  if (status === 403) return serverMessage || "Você não tem permissão para esta ação.";
  return serverMessage || fallback;
}

// Alvo ao subir/descer um item numa lista de ids (devolve a nova ordem).
export function moveId(ids, id, delta) {
  const list = [...ids];
  const from = list.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list;
}
