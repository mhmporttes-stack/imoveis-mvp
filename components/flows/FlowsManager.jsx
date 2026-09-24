"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Copy, Loader2, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { buildFlowFromTemplate, listFlowTemplates } from "@/components/flows/flow-templates";
import { triggerSummary } from "@/components/flows/flow-ui";

const STATUS = {
  active: { label: "Ativo", className: "bg-emerald-100 text-emerald-800" },
  paused: { label: "Pausado", className: "bg-amber-100 text-amber-800" },
  draft: { label: "Rascunho", className: "bg-slate-100 text-slate-700" }
};

const KIND_LABELS = {
  send: "Enviou mensagem",
  reply: "Cliente respondeu",
  action: "Executou ação",
  condition: "Avaliou condição",
  delay: "Entrou em espera",
  timeout: "Prazo sem resposta",
  handoff: "Passou para atendente",
  end: "Fluxo terminou",
  skipped: "Não iniciou",
  error: "Erro"
};

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function FlowsManager({ initialFlows }) {
  const router = useRouter();
  const [flows, setFlows] = useState(initialFlows);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [activityFor, setActivityFor] = useState(null);

  async function request(url, options, fallback) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || fallback);
    return data;
  }

  async function reload() {
    const data = await request("/api/admin/whatsapp-flows", { cache: "no-store" }, "Não foi possível recarregar.");
    setFlows(data.flows);
  }

  async function create(templateKey) {
    setError("");
    setBusyId("new");
    try {
      const template = buildFlowFromTemplate(templateKey);
      const data = await request("/api/admin/whatsapp-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(template)
      }, "Não foi possível criar o fluxo.");
      router.push(`/admin/automacoes/fluxos/${data.flow.id}`);
    } catch (createError) {
      setError(createError.message);
      setBusyId("");
    }
  }

  async function act(flow, action) {
    setError("");
    setBusyId(flow.id);
    try {
      if (action === "duplicate") {
        await request(`/api/admin/whatsapp-flows/${flow.id}/duplicate`, { method: "POST" }, "Não foi possível duplicar.");
      } else if (action === "toggle") {
        await request(`/api/admin/whatsapp-flows/${flow.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: flow.status === "active" ? "paused" : "active" })
        }, "Não foi possível alterar o status.");
      } else if (action === "delete") {
        if (!window.confirm(`Excluir o fluxo "${flow.name}"? As conversas em andamento nele também são encerradas. Isso não pode ser desfeito.`)) return;
        await request(`/api/admin/whatsapp-flows/${flow.id}`, { method: "DELETE" }, "Não foi possível excluir.");
      }
      await reload();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId("");
    }
  }

  async function openActivity(flow) {
    setActivityFor({ flow, loading: true, logs: [], sessions: [] });
    try {
      const data = await request(`/api/admin/whatsapp-flows/${flow.id}/activity`, { cache: "no-store" }, "Não foi possível carregar a atividade.");
      setActivityFor({ flow, loading: false, ...data });
    } catch (activityError) {
      setActivityFor({ flow, loading: false, logs: [], sessions: [], error: activityError.message });
    }
  }

  return (
    <section className="container-page space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-black text-navy">Fluxos do WhatsApp</h2>
          <p className="mt-1 text-sm font-semibold text-muted">
            Monte conversas automáticas com botões, listas, perguntas, condições e esperas — como no ManyChat. O cliente escreve, o fluxo responde e, quando fizer sentido, passa para uma pessoa no Chat.
          </p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="premium-button-primary"><Plus className="h-5 w-5" />Novo fluxo</button>
      </div>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {flows.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-line bg-white p-10 text-center">
          <p className="text-lg font-black text-navy">Nenhum fluxo ainda</p>
          <p className="mt-1 text-sm font-semibold text-muted">Comece por um modelo pronto (boas-vindas, fora do horário, qualificação) e ajuste os textos.</p>
          <button type="button" onClick={() => setCreating(true)} className="premium-button-primary mt-4"><Plus className="h-5 w-5" />Criar o primeiro fluxo</button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {flows.map((flow) => {
            const status = STATUS[flow.status] || STATUS.draft;
            const busy = busyId === flow.id;
            return (
              <article key={flow.id} className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/automacoes/fluxos/${flow.id}`} className="block truncate text-lg font-black text-navy hover:text-brand">{flow.name}</Link>
                    <p className="mt-0.5 truncate text-sm font-semibold text-muted">{triggerSummary(flow.publishedTrigger || flow.trigger)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${status.className}`}>{status.label}</span>
                    {flow.hasUnpublishedChanges ? <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-black text-blue-700">Alterações não publicadas</span> : null}
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Blocos" value={flow.nodeCount} />
                  <Stat label="Disparos" value={flow.triggeredCount} />
                  <Stat label="Em andamento" value={flow.liveSessions} />
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={`/admin/automacoes/fluxos/${flow.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-xs font-black text-white"><Pencil className="h-3.5 w-3.5" />Editar</Link>
                  {flow.publishedVersion !== null ? (
                    <button type="button" disabled={busy} onClick={() => act(flow, "toggle")} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-black text-navy hover:bg-mist">
                      {flow.status === "active" ? <><Pause className="h-3.5 w-3.5" />Pausar</> : <><Play className="h-3.5 w-3.5" />Retomar</>}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => openActivity(flow)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-black text-navy hover:bg-mist"><Activity className="h-3.5 w-3.5" />Atividade</button>
                  <button type="button" disabled={busy} onClick={() => act(flow, "duplicate")} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-black text-navy hover:bg-mist"><Copy className="h-3.5 w-3.5" />Duplicar</button>
                  <button type="button" disabled={busy} onClick={() => act(flow, "delete")} className="inline-flex items-center gap-1.5 rounded-full border border-red-200 px-4 py-2 text-xs font-black text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Excluir</button>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin self-center text-muted" /> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="px-2 text-xs font-semibold text-muted">
        Se um cliente casar com um fluxo e também com uma "Resposta automática por palavra-chave" (aba WhatsApp Master), o fluxo tem prioridade e a resposta por palavra-chave não é enviada.
      </p>

      {creating ? (
        <Modal title="Novo fluxo" onClose={() => setCreating(false)}>
          <div className="grid gap-2">
            {listFlowTemplates().map((template) => (
              <button key={template.key} type="button" disabled={busyId === "new"} onClick={() => create(template.key)} className="rounded-2xl border border-line p-4 text-left transition hover:border-brand hover:bg-brand/5">
                <p className="text-base font-black text-navy">{template.title}</p>
                <p className="mt-0.5 text-sm font-semibold text-muted">{template.description}</p>
              </button>
            ))}
          </div>
          {busyId === "new" ? <p className="mt-3 flex items-center gap-2 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" />Criando…</p> : null}
        </Modal>
      ) : null}

      {activityFor ? (
        <Modal title={`Atividade — ${activityFor.flow.name}`} onClose={() => setActivityFor(null)} wide>
          {activityFor.loading ? <p className="flex items-center gap-2 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</p> : null}
          {activityFor.error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{activityFor.error}</p> : null}
          {!activityFor.loading && !activityFor.error ? (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-wide text-muted">Últimas conversas</p>
                {activityFor.sessions.length ? (
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {activityFor.sessions.map((session) => (
                      <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                        <span className="font-black text-navy">{session.contact_phone}</span>
                        <span className="rounded-full bg-mist px-2 py-0.5 text-[11px] font-black text-navy">{{ active: "Em andamento", waiting: "Aguardando", completed: "Concluída", handoff: "Passou para atendente", expired: "Expirada", failed: "Falhou" }[session.status] || session.status}</span>
                        {session.end_reason ? <span className="text-xs font-semibold text-muted">{session.end_reason.replaceAll("_", " ")}</span> : null}
                        {session.error ? <span className="text-xs font-bold text-red-600">{session.error}</span> : null}
                        <span className="ml-auto text-xs font-semibold text-muted">{DATE_FORMATTER.format(new Date(session.started_at))}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm font-semibold text-muted">Nenhuma conversa passou por este fluxo ainda.</p>}
              </div>
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-wide text-muted">Passos recentes</p>
                {activityFor.logs.length ? (
                  <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                    {activityFor.logs.map((log) => (
                      <li key={log.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-xs">
                        <span className="font-black text-navy">{KIND_LABELS[log.kind] || log.kind}</span>
                        <span className="text-muted">{log.contact_phone}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold text-slate">{log.detail?.preview || log.detail?.text || log.detail?.message || log.detail?.reason || ""}</span>
                        <span className="text-muted">{DATE_FORMATTER.format(new Date(log.created_at))}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm font-semibold text-muted">Sem registros.</p>}
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-mist px-2 py-2">
      <dd className="text-xl font-black text-navy">{value ?? 0}</dd>
      <dt className="text-[11px] font-bold text-muted">{label}</dt>
    </div>
  );
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`max-h-[88dvh] w-full overflow-y-auto rounded-[28px] border border-line bg-white p-6 shadow-soft ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xl font-black text-navy">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-2 text-muted hover:bg-mist"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
