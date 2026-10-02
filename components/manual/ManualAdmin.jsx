"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, History, Megaphone, Pencil, Plus, ShieldCheck, Sparkles } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field, { inputClasses } from "@/components/ui/Field";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import ManualAdminNews from "@/components/manual/ManualAdminNews";
import { AudienceChecks, BeforeAfter, StatusPill, audienceText, formatDateTime, useManualApi } from "@/components/manual/manual-admin-parts";
import { approvalState, moveId } from "@/lib/manual-ui-core.mjs";

const bySort = (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.title).localeCompare(String(b.title), "pt-BR");

// Administração do Manual: edição rápida, fila de aprovação, novidades, versões e leituras.
export default function ManualAdmin({ initial, isOwner = false, ownerViewingAsOther = false }) {
  const api = useManualApi();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState("content");
  const [busy, setBusy] = useState("");
  const [notify, toastElement] = useToast();
  const [confirmAction, confirmElement] = useConfirm();
  const approval = approvalState({ isOwner, ownerViewingAsOther });

  const reload = useCallback(async () => {
    setData(await api("GET", "/api/admin/manual/admin"));
  }, [api]);

  // Executa uma ação, recarrega e avisa; erros viram aviso (422 = mensagem padrão).
  const run = useCallback(async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      await reload();
      if (success) notify(success);
      return result;
    } catch (error) {
      notify(error.message || "Não foi possível concluir.", "danger");
      return null;
    } finally {
      setBusy("");
    }
  }, [reload, notify]);

  const topics = useMemo(() => [...data.topics].sort(bySort), [data.topics]);
  const pendingTopics = topics.filter((t) => t.status === "pending");
  const pendingSections = data.sections.filter((s) => s.status === "pending");
  const pendingNews = data.news.filter((n) => n.status === "pending");
  const queueCount = pendingTopics.length + pendingSections.length + pendingNews.length + data.pendingVersions.length;
  const ctx = { api, run, busy, notify, confirmAction, approval, data, isOwner };

  async function seed() {
    const ok = await confirmAction({ title: "Carregar a estrutura inicial?", description: "Cria os tópicos e subtópicos base, todos aguardando aprovação. Pode repetir sem duplicar.", confirmLabel: "Carregar" });
    if (!ok) return;
    await run("seed", () => api("POST", "/api/admin/manual/admin/seed"), "Estrutura inicial carregada.");
  }

  return (
    <section className="container-page space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-1.5">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-navy [text-wrap:balance]">Gerenciar o Manual</h1>
          <p className="text-[15px] text-ink-2">Edite os textos, acompanhe o que aguarda aprovação e publique novidades.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href="/admin/manual" variant="secondary" size="sm"><BookOpen className="h-4 w-4" aria-hidden="true" /> Ver como equipe</Button>
          {isOwner ? <Button variant="secondary" size="sm" loading={busy === "seed"} onClick={seed}><Sparkles className="h-4 w-4" aria-hidden="true" /> Carregar estrutura inicial</Button> : null}
        </div>
      </header>

      {!approval.buttons ? (
        <p className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft px-3 py-2 text-sm text-navy" role="note">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
          <span>{approval.notice}</span>
        </p>
      ) : null}

      <nav aria-label="Áreas da administração" className="flex gap-1 overflow-x-auto border-b border-line">
        {[{ key: "content", label: "Conteúdo", Icon: BookOpen }, { key: "queue", label: "Aprovação", Icon: ShieldCheck, count: queueCount }, { key: "news", label: "Novidades", Icon: Megaphone }].map(({ key, label, Icon, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={cx(
              "-mb-px inline-flex min-h-touch shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm sm:gap-2 sm:px-3 font-semibold transition-colors duration-150 ease-out-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none",
              tab === key ? "border-brand text-navy" : "border-transparent text-muted hover:text-navy"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
            {count ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-2xs font-semibold text-white">{count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "content" ? <ContentTab ctx={ctx} topics={topics} /> : null}
      {tab === "queue" ? <QueueTab ctx={ctx} topics={topics} pendingTopics={pendingTopics} pendingSections={pendingSections} pendingNews={pendingNews} /> : null}
      {tab === "news" ? <ManualAdminNews ctx={ctx} /> : null}
      {toastElement}
      {confirmElement}
    </section>
  );
}

// ---------- Conteúdo ----------
function ContentTab({ ctx, topics }) {
  const { api, run } = ctx;
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });

  async function create(event) {
    event.preventDefault();
    const ok = await run("new-topic", () => api("POST", "/api/admin/manual/admin/topics", { title: draft.title, description: draft.description, sort_order: (topics.length + 1) * 10 }), "Tópico criado como rascunho.");
    if (ok) { setCreating(false); setDraft({ title: "", description: "" }); }
  }

  async function moveTopic(id, delta) {
    const ids = moveId(topics.map((t) => t.id), id, delta);
    await run(`move-${id}`, () => api("POST", "/api/admin/manual/admin/reorder", { kind: "topic", ids }));
  }

  return (
    <div className="space-y-4">
      {topics.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title="Nenhum tópico ainda" description={ctx.isOwner ? "Use “Carregar estrutura inicial” ou crie o primeiro tópico." : "Crie o primeiro tópico ou peça ao Matheus para carregar a estrutura inicial."} /></Card>
      ) : (
        topics.map((topic, index) => (
          <TopicCard key={topic.id} ctx={ctx} topic={topic} first={index === 0} last={index === topics.length - 1} onMove={moveTopic} />
        ))
      )}
      {creating ? (
        <Card as="form" onSubmit={create} className="space-y-3">
          <Field label="Título do tópico" required><input className={inputClasses} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} /></Field>
          <Field label="Descrição curta"><input className={inputClasses} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={400} /></Field>
          <div className="flex gap-2">
            <Button type="submit" loading={ctx.busy === "new-topic"} disabled={!draft.title.trim()}>Criar tópico</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button>
          </div>
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Novo tópico</Button>
      )}
    </div>
  );
}

function TopicCard({ ctx, topic, first, last, onMove }) {
  const { api, run, busy, approval, data } = ctx;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: topic.title, description: topic.description || "", audiences: topic.audiences || ["all"] });
  const [adding, setAdding] = useState(false);
  const [sectionDraft, setSectionDraft] = useState({ title: "", body: "" });
  const sections = useMemo(() => data.sections.filter((s) => s.topic_id === topic.id).sort(bySort), [data.sections, topic.id]);

  const setStatus = (status, cascade = false) =>
    run(`topic-${topic.id}-${status}`, () => api("PATCH", `/api/admin/manual/admin/topics/${topic.id}`, { status, cascade }), "Status atualizado.");

  async function save(event) {
    event.preventDefault();
    const ok = await run(`save-${topic.id}`, () => api("PATCH", `/api/admin/manual/admin/topics/${topic.id}`, form), "Tópico salvo.");
    if (ok) setEditing(false);
  }

  async function addSection(event) {
    event.preventDefault();
    const ok = await run(`add-${topic.id}`, () => api("POST", "/api/admin/manual/admin/sections", { topic_id: topic.id, title: sectionDraft.title, body: sectionDraft.body, sort_order: (sections.length + 1) * 10 }), "Subtópico criado como rascunho.");
    if (ok) { setAdding(false); setSectionDraft({ title: "", body: "" }); }
  }

  async function moveSection(id, delta) {
    const ids = moveId(sections.map((s) => s.id), id, delta);
    await run(`move-${id}`, () => api("POST", "/api/admin/manual/admin/reorder", { kind: "section", ids }));
  }

  return (
    <Card padding="sm" className="space-y-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MoveButtons first={first} last={last} onMove={(d) => onMove(topic.id, d)} disabled={Boolean(busy)} label={topic.title} />
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-touch min-w-[9rem] flex-1 rounded-control px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <span className="block truncate text-base font-semibold text-navy">{topic.title}</span>
          <span className="block text-xs text-muted">{sections.length} {sections.length === 1 ? "subtópico" : "subtópicos"} · Quem vê: {audienceText(topic.audiences)}</span>
        </button>
        <StatusPill status={topic.status} />
      </div>

      {open ? (
        <div className="space-y-4 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(!editing)}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar tópico</Button>
            <StatusActions kind="topic" status={topic.status} approval={approval} busy={busy} onSet={setStatus} cascade />
          </div>
          {editing ? (
            <form onSubmit={save} className="space-y-3 rounded-control bg-mist/70 p-3">
              <Field label="Título" required><input className={inputClasses} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} /></Field>
              <Field label="Descrição curta"><input className={inputClasses} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={400} /></Field>
              <AudienceChecks name={`aud-${topic.id}`} value={form.audiences} onChange={(audiences) => setForm({ ...form, audiences })} />
              <div className="flex gap-2"><Button type="submit" size="sm" loading={busy === `save-${topic.id}`}>Salvar</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button></div>
            </form>
          ) : null}

          <ul className="space-y-2">
            {sections.map((section, index) => (
              <SectionRow key={section.id} ctx={ctx} section={section} first={index === 0} last={index === sections.length - 1} onMove={moveSection} />
            ))}
          </ul>
          {adding ? (
            <form onSubmit={addSection} className="space-y-3 rounded-control bg-mist/70 p-3">
              <Field label="Título do subtópico" required><input className={inputClasses} value={sectionDraft.title} onChange={(e) => setSectionDraft({ ...sectionDraft, title: e.target.value })} maxLength={160} /></Field>
              <Field label="Texto" hint="Parágrafos separados por linha em branco. Listas com “- ” no início da linha."><textarea className={cx(inputClasses, "!min-h-32 py-2")} value={sectionDraft.body} onChange={(e) => setSectionDraft({ ...sectionDraft, body: e.target.value })} /></Field>
              <div className="flex gap-2"><Button type="submit" size="sm" loading={busy === `add-${topic.id}`} disabled={!sectionDraft.title.trim()}>Criar subtópico</Button><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button></div>
            </form>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Novo subtópico</Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function SectionRow({ ctx, section, first, last, onMove }) {
  const { api, run, busy, approval } = ctx;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: section.title, body: section.body || "", audiences: section.audiences || ["all"] });
  const [versions, setVersions] = useState(null);

  const setStatus = (status) => run(`section-${section.id}-${status}`, () => api("PATCH", `/api/admin/manual/admin/sections/${section.id}`, { status }), "Status atualizado.");

  async function save(event) {
    event.preventDefault();
    const result = await run(`save-${section.id}`, () => api("PATCH", `/api/admin/manual/admin/sections/${section.id}`, form), null);
    if (!result) return;
    setEditing(false);
    ctx.notify(result.proposedVersion ? "Alteração enviada como versão proposta. Aguarda aprovação." : "Subtópico salvo.");
  }

  async function loadVersions() {
    if (versions) { setVersions(null); return; }
    try { setVersions((await api("GET", `/api/admin/manual/admin/sections/${section.id}/versions`)).versions); }
    catch (error) { ctx.notify(error.message, "danger"); }
  }

  return (
    <li className="rounded-control border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MoveButtons first={first} last={last} onMove={(d) => onMove(section.id, d)} disabled={Boolean(busy)} label={section.title} />
        <span className="min-w-[8rem] flex-1 text-sm font-semibold text-navy">{section.title}</span>
        <StatusPill status={section.status} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing(!editing)}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</Button>
        <Button size="sm" variant="ghost" onClick={loadVersions}><History className="h-4 w-4" aria-hidden="true" /> Versões</Button>
        <StatusActions kind="section" status={section.status} approval={approval} busy={busy} onSet={setStatus} />
      </div>
      {section.status === "published" && editing ? <p className="mt-2 text-xs text-muted">Este texto já está publicado: a alteração vira uma versão proposta e só entra no ar depois de aprovada.</p> : null}
      {editing ? (
        <form onSubmit={save} className="mt-3 space-y-3 rounded-control bg-mist/70 p-3">
          <Field label="Título" required><input className={inputClasses} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={160} /></Field>
          <Field label="Texto" hint="Parágrafos separados por linha em branco. Listas com “- ” no início da linha."><textarea className={cx(inputClasses, "!min-h-40 py-2")} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <AudienceChecks name={`aud-${section.id}`} value={form.audiences} onChange={(audiences) => setForm({ ...form, audiences })} />
          <div className="flex gap-2"><Button type="submit" size="sm" loading={busy === `save-${section.id}`}>Salvar</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button></div>
        </form>
      ) : null}
      {versions ? <VersionList versions={versions} /> : null}
    </li>
  );
}

function VersionList({ versions }) {
  if (!versions.length) return <p className="mt-3 text-sm text-muted">Nenhuma versão registrada.</p>;
  return (
    <ol className="mt-3 space-y-2">
      {versions.map((v) => (
        <li key={v.id} className="rounded-control border border-line bg-mist/50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-semibold text-navy">Versão {v.version}</span>
            <span>{formatDateTime(v.created_at)}</span>
            {v.approved_at ? <Badge tone="success" dot>Aprovada em {formatDateTime(v.approved_at)}</Badge> : <Badge tone="warning" dot>Aguardando aprovação</Badge>}
          </div>
          <BeforeAfter before={v.body_before} after={v.body_after} />
        </li>
      ))}
    </ol>
  );
}

function MoveButtons({ first, last, onMove, disabled, label }) {
  const base = "inline-flex h-9 w-9 items-center justify-center rounded-control text-muted transition-colors duration-150 ease-out-ui hover:bg-navy/[0.06] hover:text-navy disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
  return (
    <span className="inline-flex shrink-0">
      <button type="button" className={base} disabled={first || disabled} onClick={() => onMove(-1)} aria-label={`Subir ${label}`}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" className={base} disabled={last || disabled} onClick={() => onMove(1)} aria-label={`Descer ${label}`}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
    </span>
  );
}

// Botões de fluxo. Publicar só aparece para o dono; os demais veem o aviso no topo.
function StatusActions({ kind, status, approval, busy, onSet, cascade = false }) {
  const prefix = `${kind}-`;
  const loading = (to) => busy.includes(prefix) && busy.endsWith(`-${to}`);
  return (
    <>
      {status === "draft" ? <Button size="sm" variant="secondary" loading={loading("pending")} onClick={() => onSet("pending")}>Enviar para aprovação</Button> : null}
      {status === "pending" ? <Button size="sm" variant="ghost" loading={loading("draft")} onClick={() => onSet("draft")}>Voltar a rascunho</Button> : null}
      {status === "pending" && approval.buttons ? <Button size="sm" loading={loading("published")} onClick={() => onSet("published")}>Publicar</Button> : null}
      {status === "pending" && approval.buttons && cascade ? <Button size="sm" variant="secondary" onClick={() => onSet("published", true)}>Publicar tópico com suas seções</Button> : null}
      {status === "published" ? <Button size="sm" variant="ghost" loading={loading("pending")} onClick={() => onSet("pending")}>Tirar do ar</Button> : null}
    </>
  );
}

// ---------- Fila de aprovação ----------
function QueueTab({ ctx, topics, pendingTopics, pendingSections, pendingNews }) {
  const { api, run, busy, approval, data } = ctx;
  const topicName = (id) => topics.find((t) => t.id === id)?.title || "";
  const sectionById = (id) => data.sections.find((s) => s.id === id);
  const [versionDetail, setVersionDetail] = useState({});

  async function showVersion(v) {
    if (versionDetail[v.id]) { setVersionDetail((cur) => ({ ...cur, [v.id]: null })); return; }
    try {
      const { versions } = await api("GET", `/api/admin/manual/admin/sections/${v.section_id}/versions`);
      setVersionDetail((cur) => ({ ...cur, [v.id]: versions.find((x) => x.id === v.id) || null }));
    } catch (error) { ctx.notify(error.message, "danger"); }
  }

  const nothing = !pendingTopics.length && !pendingSections.length && !pendingNews.length && !data.pendingVersions.length;
  if (nothing) return <Card><EmptyState icon={ShieldCheck} title="Nada aguardando aprovação" description="Quando alguém enviar um texto ou novidade para aprovação, ele aparece aqui." /></Card>;

  const row = "flex flex-wrap items-center gap-2 rounded-control border border-line bg-white p-3";
  return (
    <div className="space-y-6">
      {pendingTopics.length ? (
        <QueueGroup title="Tópicos">
          {pendingTopics.map((t) => (
            <li key={t.id} className={row}>
              <span className="min-w-0 flex-1 text-sm font-semibold text-navy">{t.title}</span>
              <StatusPill status="pending" />
              {approval.buttons ? (
                <>
                  <Button size="sm" loading={busy === `topic-${t.id}-published`} onClick={() => run(`topic-${t.id}-published`, () => api("PATCH", `/api/admin/manual/admin/topics/${t.id}`, { status: "published", cascade: true }), "Tópico publicado com suas seções.")}>Publicar com suas seções</Button>
                  <Button size="sm" variant="secondary" onClick={() => run(`topic-${t.id}-published`, () => api("PATCH", `/api/admin/manual/admin/topics/${t.id}`, { status: "published" }), "Tópico publicado.")}>Só o tópico</Button>
                </>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => run(`topic-${t.id}-draft`, () => api("PATCH", `/api/admin/manual/admin/topics/${t.id}`, { status: "draft" }), "Voltou a rascunho.")}>Voltar a rascunho</Button>
            </li>
          ))}
        </QueueGroup>
      ) : null}

      {pendingSections.length ? (
        <QueueGroup title="Subtópicos">
          {pendingSections.map((s) => (
            <li key={s.id} className={row}>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-navy">{s.title}</span><span className="block text-xs text-muted">{topicName(s.topic_id)}</span></span>
              <StatusPill status="pending" />
              {approval.buttons ? <Button size="sm" loading={busy === `section-${s.id}-published`} onClick={() => run(`section-${s.id}-published`, () => api("PATCH", `/api/admin/manual/admin/sections/${s.id}`, { status: "published" }), "Subtópico publicado.")}>Publicar</Button> : null}
              <Button size="sm" variant="ghost" onClick={() => run(`section-${s.id}-draft`, () => api("PATCH", `/api/admin/manual/admin/sections/${s.id}`, { status: "draft" }), "Voltou a rascunho.")}>Voltar a rascunho</Button>
            </li>
          ))}
        </QueueGroup>
      ) : null}

      {data.pendingVersions.length ? (
        <QueueGroup title="Alterações propostas em textos publicados">
          {data.pendingVersions.map((v) => {
            const section = sectionById(v.section_id);
            const detail = versionDetail[v.id];
            return (
              <li key={v.id} className={cx(row, "block")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-navy">{section?.title || "Subtópico"}</span><span className="block text-xs text-muted">Versão {v.version} · {formatDateTime(v.created_at)}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => showVersion(v)}>Ver antes e depois</Button>
                  {approval.buttons ? <Button size="sm" loading={busy === `ver-${v.id}`} onClick={() => run(`ver-${v.id}`, () => api("POST", `/api/admin/manual/admin/versions/${v.id}/approve`), "Versão aprovada e publicada.")}>Aprovar</Button> : null}
                </div>
                {detail ? <BeforeAfter before={section?.body} after={detail.body_after} /> : null}
              </li>
            );
          })}
        </QueueGroup>
      ) : null}

      {pendingNews.length ? (
        <QueueGroup title="Novidades">
          {pendingNews.map((n) => (
            <li key={n.id} className={row}>
              <span className="min-w-0 flex-1 text-sm font-semibold text-navy">{n.title}</span>
              {n.important ? <Badge tone="warning">Importante</Badge> : null}
              <StatusPill status="pending" />
              {approval.buttons ? <Button size="sm" loading={busy === `news-${n.id}-published`} onClick={() => run(`news-${n.id}-published`, () => api("PATCH", `/api/admin/manual/admin/news/${n.id}`, { status: "published" }), "Novidade publicada.")}>Publicar</Button> : null}
              <Button size="sm" variant="ghost" onClick={() => run(`news-${n.id}-discarded`, () => api("PATCH", `/api/admin/manual/admin/news/${n.id}`, { status: "discarded" }), "Novidade descartada.")}>Descartar</Button>
            </li>
          ))}
        </QueueGroup>
      ) : null}

    </div>
  );
}

function QueueGroup({ title, children }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-navy">{title}</h2>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}
