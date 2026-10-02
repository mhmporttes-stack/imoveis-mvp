// Manual do CRM — serviço (SOMENTE SERVIDOR). Toda dependência externa é
// injetada (db, createAlerts, isOwner) para testar com banco simulado.
// Rotas/Server Components usam lib/manual.js (que injeta Supabase real).
import {
  CONTENT_STATUS, MANUAL_ROLES, ManualError, buildVisibleManual, buildVisibleNews, canSeeContent, canTransition,
  cleanText, newsHref, normalizeAudiences, normalizeSlug, requiresApprover, rolesForAudiences, searchVisibleManual
} from "./manual-core.mjs";
import { assertManualContentAllowed } from "./manual-guard.mjs";
import { MANUAL_SEED_STRUCTURE } from "./manual-seed-structure.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = { topic: "manual_topics", section: "manual_sections", news: "manual_news" };

// Alerta da novidade: audiência EXPLÍCITA (todos ou lista de papéis), nunca
// por hierarquia/online (regra T-28). Guard roda sobre o texto montado.
export function buildNewsAlertPlan(news, versionNumber = 1) {
  const roles = rolesForAudiences(news.audiences);
  if (!roles.length) throw new ManualError("Audiência inválida.");
  const audience = roles.length === MANUAL_ROLES.length ? { type: "all" } : { type: "role", roles };
  const title = String(news.title || "").trim().slice(0, 100);
  const excerpt = String(news.body || "").replace(/\s+/g, " ").trim();
  const body = (excerpt.length > 240 ? `${excerpt.slice(0, 237)}...` : excerpt) || title;
  const link = newsHref(news.slug);
  const dedupeKey = `manual_news:${news.id}:v${versionNumber}`;
  assertManualContentAllowed(title, body, link, dedupeKey);
  return {
    dedupeKey,
    definition: { id: null, key: "manual_news", audience, kind: news.requires_ack ? "important" : "informative", enabled: true },
    buildRow: (recipientId) => ({
      definition_id: null,
      recipient_id: recipientId,
      kind: news.requires_ack ? "important" : "informative",
      title,
      body,
      context: { link, news_id: news.id },
      dedupe_key: dedupeKey
    })
  };
}

export function createManualService(deps) {
  const { createAlerts, isOwner } = deps;
  const db = { from: (table) => deps.db.from(table) }; // lazy: o cliente real so nasce na 1a chamada
  const clock = deps.now || (() => new Date());
  const viewerOf = deps.viewerOf || ((auth) => (auth?.profile ? { id: auth.profile.id, role: auth.profile.role } : null));

  const unwrap = ({ data, error }) => {
    if (error) {
      if (error.code === "23505") throw new ManualError("Já existe um item com este identificador.", 409);
      throw error;
    }
    return data;
  };
  const viewer = (auth) => {
    const v = viewerOf(auth);
    if (!v?.id || !v?.role) throw new ManualError("Acesso negado.", 403);
    return v;
  };
  const admin = (auth) => {
    const v = viewer(auth);
    if (v.role !== "admin") throw new ManualError("Apenas o administrador geral.", 403);
    return v;
  };
  const approver = (auth) => {
    const v = admin(auth);
    if (!isOwner(auth)) throw new ManualError("Apenas o administrador principal pode aprovar e publicar.", 403);
    return v;
  };
  const uuid = (id) => {
    if (!UUID.test(String(id || ""))) throw new ManualError("Identificador inválido.", 404);
    return String(id);
  };
  const nowIso = () => clock().toISOString();
  const getRow = async (table, id) => unwrap(await db.from(table).select("*").eq("id", uuid(id)).maybeSingle());
  const mustGet = async (table, id, label) => {
    const row = await getRow(table, id);
    if (!row) throw new ManualError(`${label} não encontrado.`, 404);
    return row;
  };

  // ---------- leitura (equipe) ----------
  async function getVisibleManual(auth) {
    const v = viewer(auth);
    const [topics, sections] = await Promise.all([
      db.from("manual_topics").select("*").eq("status", CONTENT_STATUS.PUBLISHED).then(unwrap),
      db.from("manual_sections").select("*").eq("status", CONTENT_STATUS.PUBLISHED).then(unwrap)
    ]);
    return { topics: buildVisibleManual({ topics: topics || [], sections: sections || [] }, v, clock().getTime()) };
  }

  async function searchManual(auth, query) {
    const q = String(query || "").trim().slice(0, 80);
    if (q.length < 2) return { results: [] };
    const { topics } = await getVisibleManual(auth);
    return { results: searchVisibleManual(topics, q) };
  }

  async function listVisibleNews(auth) {
    const v = viewer(auth);
    const [news, reads] = await Promise.all([
      db.from("manual_news").select("*").eq("status", CONTENT_STATUS.PUBLISHED).then(unwrap),
      db.from("manual_news_reads").select("news_id").eq("user_id", v.id).then(unwrap)
    ]);
    const readIds = new Set((reads || []).map((r) => r.news_id));
    return { news: buildVisibleNews(news || [], v, readIds, clock().getTime()) };
  }

  async function markNewsRead(auth, id) {
    const v = viewer(auth);
    const news = UUID.test(String(id || "")) ? await getRow("manual_news", id) : null;
    // Invisível ao perfil = mesma resposta de inexistente (não revela existência).
    if (!news || news.status !== CONTENT_STATUS.PUBLISHED || !canSeeContent(v, news.audiences)) {
      throw new ManualError("Novidade não encontrada.", 404);
    }
    unwrap(await db.from("manual_news_reads").upsert(
      { news_id: news.id, user_id: v.id, read_at: nowIso() }, { onConflict: "news_id,user_id", ignoreDuplicates: true }
    ));
    return { read: true };
  }

  // ---------- administração ----------
  async function adminOverview(auth) {
    admin(auth);
    const [topics, sections, news, pendingVersions] = await Promise.all([
      db.from("manual_topics").select("*").then(unwrap),
      db.from("manual_sections").select("*").then(unwrap),
      db.from("manual_news").select("*").then(unwrap),
      db.from("manual_section_versions").select("id, section_id, version, created_at, created_by, news_id, approved_at").then(unwrap)
    ]);
    return { topics: topics || [], sections: sections || [], news: news || [], pendingVersions: (pendingVersions || []).filter((r) => !r.approved_at) };
  }

  async function createTopic(auth, input = {}) {
    const v = admin(auth);
    const row = {
      slug: normalizeSlug(input.slug || input.title),
      title: cleanText(input.title, { max: 120, required: true, field: "Título" }),
      description: cleanText(input.description, { max: 400 }),
      icon: cleanText(input.icon, { max: 40 }),
      sort_order: Number.isInteger(input.sort_order) ? input.sort_order : 0,
      audiences: normalizeAudiences(input.audiences || ["all"]),
      status: CONTENT_STATUS.DRAFT,
      updated_by: v.id,
      updated_at: nowIso()
    };
    assertManualContentAllowed(row);
    return unwrap(await db.from("manual_topics").insert(row).select("*").single());
  }

  async function updateTopic(auth, id, patch = {}) {
    const v = admin(auth);
    await mustGet("manual_topics", id, "Tópico");
    const next = { updated_by: v.id, updated_at: nowIso() };
    if ("title" in patch) next.title = cleanText(patch.title, { max: 120, required: true, field: "Título" });
    if ("description" in patch) next.description = cleanText(patch.description, { max: 400 });
    if ("icon" in patch) next.icon = cleanText(patch.icon, { max: 40 });
    if ("sort_order" in patch && Number.isInteger(patch.sort_order)) next.sort_order = patch.sort_order;
    if ("audiences" in patch) next.audiences = normalizeAudiences(patch.audiences);
    assertManualContentAllowed(next);
    return unwrap(await db.from("manual_topics").update(next).eq("id", id).select("*").maybeSingle());
  }

  async function createSection(auth, input = {}) {
    admin(auth);
    const topic = await mustGet("manual_topics", input.topic_id, "Tópico");
    const row = {
      topic_id: topic.id,
      slug: normalizeSlug(input.slug || input.title),
      title: cleanText(input.title, { max: 160, required: true, field: "Título" }),
      body: cleanText(input.body, { max: 50000 }),
      sort_order: Number.isInteger(input.sort_order) ? input.sort_order : 0,
      audiences: normalizeAudiences(input.audiences || ["all"]),
      status: CONTENT_STATUS.DRAFT,
      last_updated_at: nowIso()
    };
    assertManualContentAllowed(row);
    return unwrap(await db.from("manual_sections").insert(row).select("*").single());
  }

  async function nextVersion(sectionId) {
    const rows = unwrap(await db.from("manual_section_versions").select("version").eq("section_id", sectionId)) || [];
    return rows.reduce((max, r) => Math.max(max, r.version), 0) + 1;
  }

  // Seção publicada nunca muda de corpo "por baixo": a edição vira versão
  // proposta (aprovada só pelo dono). Rascunho/pendente edita direto.
  async function updateSection(auth, id, patch = {}) {
    const v = admin(auth);
    const section = await mustGet("manual_sections", id, "Seção");
    const next = {};
    if ("title" in patch) next.title = cleanText(patch.title, { max: 160, required: true, field: "Título" });
    if ("sort_order" in patch && Number.isInteger(patch.sort_order)) next.sort_order = patch.sort_order;
    if ("audiences" in patch) next.audiences = normalizeAudiences(patch.audiences);
    let proposed = null;
    const body = "body" in patch ? cleanText(patch.body, { max: 50000 }) : null;
    assertManualContentAllowed(next, body);
    if (body !== null && body !== section.body) {
      if (section.status === CONTENT_STATUS.PUBLISHED) {
        proposed = unwrap(await db.from("manual_section_versions").insert({
          section_id: section.id, version: await nextVersion(section.id), body_before: section.body, body_after: body,
          created_at: nowIso(), created_by: v.id
        }).select("*").single());
      } else {
        next.body = body;
      }
    }
    if (next.body !== undefined) next.last_updated_at = nowIso(); // só mudança de corpo marca "atualizado"
    const updated = Object.keys(next).length
      ? unwrap(await db.from("manual_sections").update(next).eq("id", id).select("*").maybeSingle())
      : section;
    return { section: updated, proposedVersion: proposed };
  }

  async function approveVersion(auth, versionId) {
    const v = approver(auth);
    const version = await mustGet("manual_section_versions", versionId, "Versão");
    if (version.approved_at) throw new ManualError("Esta versão já foi aprovada.", 409);
    const section = await mustGet("manual_sections", version.section_id, "Seção");
    assertManualContentAllowed(section.title, section.slug, version.body_after);
    const at = nowIso();
    unwrap(await db.from("manual_section_versions").update({ body_before: section.body, approved_by: v.id, approved_at: at }).eq("id", version.id));
    unwrap(await db.from("manual_sections").update({ body: version.body_after, published_version_id: version.id, last_updated_at: at }).eq("id", section.id));
    return { approved: true, sectionId: section.id };
  }

  async function listVersions(auth, sectionId) {
    admin(auth);
    await mustGet("manual_sections", sectionId, "Seção");
    const rows = unwrap(await db.from("manual_section_versions").select("*").eq("section_id", sectionId)) || [];
    return { versions: rows.sort((a, b) => b.version - a.version) };
  }

  async function createNews(auth, input = {}) {
    admin(auth);
    const row = await normalizeNewsInput(input, {});
    row.status = CONTENT_STATUS.DRAFT;
    row.created_at = nowIso();
    return unwrap(await db.from("manual_news").insert(row).select("*").single());
  }

  async function normalizeNewsInput(input, base) {
    const has = (k) => k in input;
    const row = {};
    if (has("title") || !base.id) row.title = cleanText(input.title, { max: 160, required: true, field: "Título" });
    if (has("slug") || !base.id) row.slug = normalizeSlug(input.slug || input.title || base.slug);
    if (has("body")) row.body = cleanText(input.body, { max: 8000 });
    if (has("audiences") || !base.id) row.audiences = normalizeAudiences(input.audiences || ["all"]);
    if (has("important")) row.important = Boolean(input.important);
    if (has("requires_ack")) row.requires_ack = Boolean(input.requires_ack);
    if (has("badge_until")) row.badge_until = input.badge_until ? new Date(input.badge_until).toISOString() : null;
    if (has("suggested_body")) row.suggested_body = input.suggested_body ? cleanText(input.suggested_body, { max: 50000 }) : null;
    if (has("suggested_section_id")) {
      if (input.suggested_section_id) await mustGet("manual_sections", input.suggested_section_id, "Seção");
      row.suggested_section_id = input.suggested_section_id || null;
    }
    assertManualContentAllowed(row);
    return row;
  }

  async function updateNews(auth, id, patch = {}) {
    admin(auth);
    const news = await mustGet("manual_news", id, "Novidade");
    if (![CONTENT_STATUS.DRAFT, CONTENT_STATUS.PENDING].includes(news.status)) throw new ManualError("Esta novidade não pode mais ser editada.", 409);
    const row = await normalizeNewsInput(patch, news);
    if (!Object.keys(row).length) return news;
    return unwrap(await db.from("manual_news").update(row).eq("id", id).select("*").maybeSingle());
  }

  async function listNewsReads(auth, newsId) {
    admin(auth);
    await mustGet("manual_news", newsId, "Novidade");
    const reads = unwrap(await db.from("manual_news_reads").select("*").eq("news_id", newsId)) || [];
    const ids = reads.map((r) => r.user_id);
    const users = ids.length ? unwrap(await db.from("admin_users").select("id, name, role").in("id", ids)) || [] : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      reads: reads
        .map((r) => ({ user_id: r.user_id, name: byId.get(r.user_id)?.name || "", role: byId.get(r.user_id)?.role || "", read_at: r.read_at }))
        .sort((a, b) => new Date(a.read_at) - new Date(b.read_at))
    };
  }

  async function reorder(auth, kind, ids) {
    admin(auth);
    if (!["topic", "section"].includes(kind) || !Array.isArray(ids) || ids.length > 200) throw new ManualError("Pedido inválido.");
    for (let i = 0; i < ids.length; i += 1) {
      unwrap(await db.from(TABLE[kind]).update({ sort_order: (i + 1) * 10 }).eq("id", uuid(ids[i])));
    }
    return { reordered: ids.length };
  }

  // ---------- fluxo de status ----------
  async function setStatus(auth, kind, id, to, opts = {}) {
    if (!TABLE[kind]) throw new ManualError("Pedido inválido.");
    const target = Object.values(CONTENT_STATUS).includes(to) ? to : null;
    if (!target) throw new ManualError("Status inválido.");
    const v = requiresApprover(kind, target) ? approver(auth) : admin(auth);
    const row = await mustGet(TABLE[kind], id, "Item");
    if (!canTransition(kind, row.status, target)) throw new ManualError("Esta mudança de status não é permitida.", 409);
    assertManualContentAllowed(row);

    if (kind === "news" && target === CONTENT_STATUS.PUBLISHED) return publishNews(row, v);
    if (kind === "section" && target === CONTENT_STATUS.PUBLISHED) return { section: await publishSection(row, v) };
    unwrap(await db.from(TABLE[kind]).update(kind === "topic" ? { status: target, updated_by: v.id, updated_at: nowIso() } : { status: target }).eq("id", row.id));
    let cascaded = 0;
    if (kind === "topic" && target === CONTENT_STATUS.PUBLISHED && opts.cascade) cascaded = await cascadeSections(row.id, v);
    return { id: row.id, status: target, cascaded };
  }

  async function publishSection(section, v) {
    if (!String(section.body || "").trim()) throw new ManualError("Escreva o conteúdo antes de publicar.", 422);
    assertManualContentAllowed(section);
    const at = nowIso();
    let versionId = section.published_version_id;
    if (!versionId) {
      const version = unwrap(await db.from("manual_section_versions").insert({
        section_id: section.id, version: await nextVersion(section.id), body_before: "", body_after: section.body,
        created_at: at, created_by: v.id, approved_by: v.id, approved_at: at
      }).select("*").single());
      versionId = version.id;
    }
    return unwrap(await db.from("manual_sections").update({ status: CONTENT_STATUS.PUBLISHED, published_version_id: versionId, last_updated_at: at }).eq("id", section.id).select("*").maybeSingle());
  }

  async function cascadeSections(topicId, v) {
    const sections = unwrap(await db.from("manual_sections").select("*").eq("topic_id", topicId).eq("status", CONTENT_STATUS.PENDING)) || [];
    let count = 0;
    for (const section of sections) {
      if (!String(section.body || "").trim()) continue;
      await publishSection(section, v);
      count += 1;
    }
    return count;
  }

  async function publishNews(news, v) {
    assertManualContentAllowed(news);
    let section = null;
    if (news.suggested_section_id && news.suggested_body) {
      section = await mustGet("manual_sections", news.suggested_section_id, "Seção");
      assertManualContentAllowed(section.title, section.slug, news.suggested_body);
    }
    const versionNumber = section ? await nextVersion(section.id) : 1;
    const plan = buildNewsAlertPlan(news, versionNumber); // guard ANTES de qualquer escrita
    const at = nowIso();
    const marked = unwrap(await db.from("manual_news").update({
      status: CONTENT_STATUS.PUBLISHED, published_at: at, published_by: v.id, alert_dedupe_key: plan.dedupeKey,
      badge_until: news.badge_until || new Date(clock().getTime() + 7 * 86400000).toISOString()
    }).eq("id", news.id).eq("status", CONTENT_STATUS.PENDING).select("*").maybeSingle());
    if (!marked) throw new ManualError("Esta novidade já foi publicada.", 409);
    try {
      let version = null;
      if (section) {
        version = unwrap(await db.from("manual_section_versions").insert({
          section_id: section.id, version: versionNumber, body_before: section.body, body_after: news.suggested_body,
          created_at: at, created_by: v.id, approved_by: v.id, approved_at: at, news_id: news.id
        }).select("*").single());
        unwrap(await db.from("manual_sections").update({ body: news.suggested_body, published_version_id: version.id, last_updated_at: at }).eq("id", section.id));
      }
      await createAlerts(plan.definition, plan.buildRow);
      return { news: marked, versionId: version?.id || null, alertKey: plan.dedupeKey };
    } catch (error) {
      await db.from("manual_news").update({ status: CONTENT_STATUS.PENDING, published_at: null, published_by: null, alert_dedupe_key: null }).eq("id", news.id);
      throw error;
    }
  }

  // ---------- carga da estrutura inicial (idempotente; tudo "pending") ----------
  async function seedStructure(auth) {
    approver(auth);
    return loadManualSeeds(db);
  }

  return {
    getVisibleManual, searchManual, listVisibleNews, markNewsRead, adminOverview, createTopic, updateTopic, createSection,
    updateSection, approveVersion, listVersions, createNews, updateNews, listNewsReads, reorder, setStatus, seedStructure
  };
}

export async function loadManualSeeds(db, structure = MANUAL_SEED_STRUCTURE) {
  assertManualContentAllowed(structure);
  const take = ({ data, error }) => { if (error) throw error; return data; };
  const topics = take(await db.from("manual_topics").select("*")) || [];
  const topicBySlug = new Map(topics.map((t) => [t.slug, t]));
  let topicsCreated = 0;
  let sectionsCreated = 0;
  for (const [topicIndex, def] of structure.entries()) {
    let topic = topicBySlug.get(def.slug);
    if (!topic) {
      topic = take(await db.from("manual_topics").insert({
        slug: def.slug, title: def.title, description: def.description || "", icon: def.icon || "", sort_order: (topicIndex + 1) * 10,
        audiences: def.audiences || ["all"], status: "pending"
      }).select("*").single());
      topicsCreated += 1;
    }
    const existing = take(await db.from("manual_sections").select("slug").eq("topic_id", topic.id)) || [];
    const have = new Set(existing.map((s) => s.slug));
    for (const [index, section] of def.sections.entries()) {
      if (have.has(section.slug)) continue;
      take(await db.from("manual_sections").insert({
        topic_id: topic.id, slug: section.slug, title: section.title, body: "", sort_order: (index + 1) * 10,
        audiences: section.audiences || ["all"], status: "pending"
      }));
      sectionsCreated += 1;
    }
  }
  return { topicsCreated, sectionsCreated };
}
