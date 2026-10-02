"use client";

import { useMemo, useState } from "react";
import { Eye, Megaphone, Pencil, Plus } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field, { inputClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import { AudienceChecks, BeforeAfter, StatusPill, audienceText, formatDateTime } from "@/components/manual/manual-admin-parts";

const EMPTY = { title: "", body: "", audiences: ["all"], important: false, requires_ack: false, badge_until: "", suggested_section_id: "", suggested_body: "" };

const toDateInput = (value) => (value ? String(value).slice(0, 10) : "");

// Novidades: rascunho -> aguardando -> publicado/descartado, com sugestão de alteração do Manual.
export default function ManualAdminNews({ ctx }) {
  const { data, api, run, busy, approval } = ctx;
  const news = useMemo(() => [...data.news].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)), [data.news]);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [reads, setReads] = useState({});

  const sectionLabel = useMemo(() => {
    const topicName = new Map(data.topics.map((t) => [t.id, t.title]));
    return (s) => `${topicName.get(s.topic_id) || "Tópico"} › ${s.title}`;
  }, [data.topics]);
  const publishedSections = data.sections.filter((s) => s.status === "published");
  const target = data.sections.find((s) => s.id === form.suggested_section_id);

  function startNew() { setForm(EMPTY); setEditingId("new"); }
  function startEdit(item) {
    setForm({
      title: item.title || "", body: item.body || "", audiences: item.audiences || ["all"], important: Boolean(item.important),
      requires_ack: Boolean(item.requires_ack), badge_until: toDateInput(item.badge_until),
      suggested_section_id: item.suggested_section_id || "", suggested_body: item.suggested_body || ""
    });
    setEditingId(item.id);
  }

  async function save(event) {
    event.preventDefault();
    const payload = { ...form, badge_until: form.badge_until || null, suggested_section_id: form.suggested_section_id || null, suggested_body: form.suggested_section_id ? form.suggested_body : null };
    const isNew = editingId === "new";
    const ok = await run("news-save", () => (isNew ? api("POST", "/api/admin/manual/admin/news", payload) : api("PATCH", `/api/admin/manual/admin/news/${editingId}`, payload)), isNew ? "Novidade criada como rascunho." : "Novidade salva.");
    if (ok) setEditingId("");
  }

  const setStatus = (item, status, ok) => run(`news-${item.id}-${status}`, () => api("PATCH", `/api/admin/manual/admin/news/${item.id}`, { status }), ok);

  async function toggleReads(item) {
    if (reads[item.id]) { setReads((cur) => ({ ...cur, [item.id]: null })); return; }
    try {
      const result = await api("GET", `/api/admin/manual/admin/news/${item.id}/reads`);
      setReads((cur) => ({ ...cur, [item.id]: result.reads }));
    } catch (error) { ctx.notify(error.message, "danger"); }
  }

  return (
    <div className="space-y-4">
      {editingId ? (
        <Card as="form" onSubmit={save} className="space-y-4">
          <h2 className="text-base font-semibold text-navy">{editingId === "new" ? "Nova novidade" : "Editar novidade"}</h2>
          <Field label="Título" required><input className={inputClasses} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={160} /></Field>
          <Field label="Texto"><textarea className={cx(inputClasses, "!min-h-28 py-2")} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <AudienceChecks name="news-aud" value={form.audiences} onChange={(audiences) => setForm({ ...form, audiences })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line bg-white px-3 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-[#1769D1]" checked={form.important} onChange={(e) => setForm({ ...form, important: e.target.checked })} />
              Novidade importante
            </label>
            <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line bg-white px-3 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-[#1769D1]" checked={form.requires_ack} onChange={(e) => setForm({ ...form, requires_ack: e.target.checked })} />
              Exigir confirmação “Li e entendi”
            </label>
          </div>
          <Field label="Selo “Novo” até" hint="Em branco: 7 dias a partir da publicação."><input type="date" className={cx(inputClasses, "sm:max-w-48")} value={form.badge_until} onChange={(e) => setForm({ ...form, badge_until: e.target.value })} /></Field>

          <div className="space-y-3 rounded-control bg-mist/70 p-3">
            <p className="text-sm font-semibold text-navy">Sugerir alteração do Manual (opcional)</p>
            <Field label="Subtópico a alterar">
              <select className={inputClasses} value={form.suggested_section_id} onChange={(e) => setForm({ ...form, suggested_section_id: e.target.value, suggested_body: e.target.value ? (data.sections.find((s) => s.id === e.target.value)?.body || "") : "" })}>
                <option value="">Nenhum</option>
                {publishedSections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
              </select>
            </Field>
            {form.suggested_section_id ? (
              <>
                <Field label="Texto novo do subtópico"><textarea className={cx(inputClasses, "!min-h-32 py-2")} value={form.suggested_body} onChange={(e) => setForm({ ...form, suggested_body: e.target.value })} /></Field>
                <div><p className="text-xs font-semibold text-muted">Pré-visualização</p><BeforeAfter before={target?.body} after={form.suggested_body} /></div>
              </>
            ) : null}
          </div>

          <div className="flex gap-2"><Button type="submit" loading={busy === "news-save"} disabled={!form.title.trim()}>Salvar</Button><Button variant="ghost" onClick={() => setEditingId("")}>Cancelar</Button></div>
        </Card>
      ) : (
        <Button variant="secondary" onClick={startNew}><Plus className="h-4 w-4" aria-hidden="true" /> Nova novidade</Button>
      )}

      {news.length === 0 ? (
        <Card><EmptyState icon={Megaphone} title="Nenhuma novidade ainda" description="Crie uma novidade para avisar a equipe do que mudou no CRM." /></Card>
      ) : (
        <ul className="space-y-2">
          {news.map((item) => {
            const editable = item.status === "draft" || item.status === "pending";
            const list = reads[item.id];
            return (
              <li key={item.id} className="rounded-card border border-line bg-white p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-navy">{item.title}</span><span className="block text-xs text-muted">Quem vê: {audienceText(item.audiences)}{item.published_at ? ` · Publicada em ${formatDateTime(item.published_at)}` : ""}</span></span>
                  {item.important ? <Badge tone="warning">Importante</Badge> : null}
                  {item.requires_ack ? <Badge tone="info">Exige confirmação</Badge> : null}
                  <StatusPill status={item.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {editable ? <Button size="sm" variant="secondary" onClick={() => startEdit(item)}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</Button> : null}
                  {item.status === "draft" ? <Button size="sm" variant="secondary" loading={busy === `news-${item.id}-pending`} onClick={() => setStatus(item, "pending", "Enviada para aprovação.")}>Enviar para aprovação</Button> : null}
                  {item.status === "pending" ? <Button size="sm" variant="ghost" onClick={() => setStatus(item, "draft", "Voltou a rascunho.")}>Voltar a rascunho</Button> : null}
                  {item.status === "pending" && approval.buttons ? <Button size="sm" loading={busy === `news-${item.id}-published`} onClick={() => setStatus(item, "published", "Novidade publicada.")}>Publicar</Button> : null}
                  {editable ? <Button size="sm" variant="danger-ghost" onClick={() => setStatus(item, "discarded", "Novidade descartada.")}>Descartar</Button> : null}
                  {item.status === "discarded" ? <Button size="sm" variant="ghost" onClick={() => setStatus(item, "draft", "Voltou a rascunho.")}>Reabrir como rascunho</Button> : null}
                  {item.status === "published" ? <Button size="sm" variant="ghost" onClick={() => toggleReads(item)}><Eye className="h-4 w-4" aria-hidden="true" /> Leituras</Button> : null}
                </div>
                {list ? (
                  list.length ? (
                    <ul className="mt-3 divide-y divide-line rounded-control border border-line text-sm">
                      {list.map((r) => <li key={r.user_id} className="flex items-center justify-between gap-3 px-3 py-2"><span className="font-medium text-navy">{r.name || "Usuário"}</span><span className="text-xs text-muted">{formatDateTime(r.read_at)}</span></li>)}
                    </ul>
                  ) : <p className="mt-3 text-sm text-muted">Ninguém confirmou a leitura ainda.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
