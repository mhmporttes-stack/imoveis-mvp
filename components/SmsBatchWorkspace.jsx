"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareText, Undo2, WifiOff } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field, { inputClasses } from "@/components/ui/Field";
import Kpi, { KpiGrid } from "@/components/ui/Kpi";
import Tabs from "@/components/ui/Tabs";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

// Lote de SMS (dono, 2026-11-02) — feito primeiro para o app no iPhone: um cartão por contato, um toque abre o app
// Mensagens (sms:) com número e texto prontos; ao VOLTAR ao app o envio é marcado sozinho, com "Desfazer" curto.
// A marcação fica numa fila no aparelho (localStorage): se o iOS fechar o app ou a internet cair, ela é concluída
// quando voltar. Regra de elegibilidade e gravação: lib/sms-batch-core.mjs / lib/sms-batch.js (aqui só apresentação).
const AWAITING_KEY = "mm-sms-awaiting";
const QUEUE_KEY = "mm-sms-queue";
const UNDO_MS = 6000;
const MIN_AWAY_MS = 800;

const readJson = (key, fallback) => {
  try {
    return JSON.parse(window.localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    if (value === null || (Array.isArray(value) && !value.length)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem armazenamento (modo privado): o fluxo segue, só não retoma depois de fechar o app.
  }
};

const percent = (value) => (value === null || value === undefined ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const timeLabel = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayLabel = (key) => key.split("-").reverse().slice(0, 2).join("/");

async function call(method, body) {
  const response = await fetch("/api/admin/lote-sms", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || "Não foi possível concluir."), { status: response.status });
  return payload;
}

export default function SmsBatchWorkspace({ initial = null, initialError = "" }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError);
  const [tab, setTab] = useState("send");
  const [undo, setUndo] = useState(null);
  const [offlineCount, setOfflineCount] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [draft, setDraft] = useState({ template: initial?.settings?.template || "", limit: String(initial?.settings?.limit || 50) });
  const [savingSettings, setSavingSettings] = useState(false);
  const [notify, toastElement] = useToast();
  const [confirmAction, confirmElement] = useConfirm();
  const flushing = useRef(false);
  const undoTimer = useRef(null);

  const reload = useCallback(async () => {
    try {
      const next = await call("GET");
      setData(next);
      setError("");
    } catch (loadError) {
      if (!data) setError(loadError.message);
    }
  }, [data]);

  useEffect(() => {
    if (!initial && !initialError) reload();
    // Só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fila de envios a marcar (sobrevive a app fechado e internet caída).
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let queue = readJson(QUEUE_KEY, []);
      while (queue.length) {
        const entry = queue[0];
        try {
          const result = await call("POST", { action: "sent", contactId: entry.id });
          queue = queue.slice(1);
          writeJson(QUEUE_KEY, queue);
          setData((current) => {
            if (!current) return current;
            const moved = current.items.find((item) => item.id === entry.id);
            return {
              ...current,
              items: current.items.filter((item) => item.id !== entry.id),
              progress: { ...current.progress, sentToday: current.progress.sentToday + 1, remaining: Math.max(0, current.progress.remaining - 1) },
              recent: moved && result.sendId ? [{ id: result.sendId, name: moved.name, phoneMasked: moved.phoneMasked, sentAt: result.sentAt }, ...current.recent] : current.recent
            };
          });
          if (result.sendId) {
            clearTimeout(undoTimer.current);
            setUndo({ sendId: result.sendId, id: entry.id, name: entry.name });
            undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
          }
        } catch (sendError) {
          if (sendError.status) {
            // O servidor recusou (ex.: contato já não está disponível): descarta e avisa.
            queue = queue.slice(1);
            writeJson(QUEUE_KEY, queue);
            notify(`${entry.name || "Contato"}: ${sendError.message}`, "danger");
          } else {
            break; // sem internet: tenta de novo quando voltar
          }
        }
      }
      setOfflineCount(readJson(QUEUE_KEY, []).length);
    } finally {
      flushing.current = false;
    }
  }, [notify]);

  // Voltou ao app depois de abrir o Mensagens: o SMS que estava aguardando vira "enviado".
  const resume = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    const awaiting = readJson(AWAITING_KEY, null);
    if (awaiting && Date.now() - awaiting.at > MIN_AWAY_MS) {
      writeJson(AWAITING_KEY, null);
      writeJson(QUEUE_KEY, [...readJson(QUEUE_KEY, []), { id: awaiting.id, name: awaiting.name }]);
    }
    if (readJson(QUEUE_KEY, []).length) {
      setOfflineCount(readJson(QUEUE_KEY, []).length);
      flush();
    }
  }, [flush]);

  useEffect(() => {
    resume(); // app reaberto com um envio pendente
    const onOnline = () => {
      flush();
      reload();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", onOnline);
      clearTimeout(undoTimer.current);
    };
  }, [resume, flush, reload]);

  const onTapSend = (item) => writeJson(AWAITING_KEY, { id: item.id, name: item.firstName || item.name, at: Date.now() });

  const undoLast = async () => {
    const current = undo;
    if (!current) return;
    clearTimeout(undoTimer.current);
    setUndo(null);
    try {
      await call("POST", { action: "undo", sendId: current.sendId });
      notify("Envio desfeito: o contato voltou para a lista.");
      reload();
    } catch (undoError) {
      notify(undoError.message, "danger");
    }
  };

  const optOut = async (entry) => {
    const ok = await confirmAction({
      title: "Respondeu SAIR?",
      description: `${entry.name || entry.phoneMasked} vai para "Não contactar" e não recebe mais contato nosso, em nenhum canal.`,
      confirmLabel: "Sim, respondeu SAIR",
      tone: "danger"
    });
    if (!ok) return;
    setBusyId(entry.id);
    try {
      await call("POST", { action: "opt-out", sendId: entry.id });
      setData((current) => ({ ...current, recent: current.recent.filter((row) => row.id !== entry.id) }));
      notify("Marcado como Não contactar.");
    } catch (optError) {
      notify(optError.message, "danger");
    } finally {
      setBusyId("");
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const saved = await call("POST", { action: "settings", template: draft.template, limit: Number(draft.limit) });
      notify("Texto e limite salvos.");
      setDraft({ template: saved.template, limit: String(saved.limit) });
      await reload();
    } catch (saveError) {
      notify(saveError.message, "danger");
    } finally {
      setSavingSettings(false);
    }
  };

  if (error && !data) {
    return <EmptyState tone="danger" title="Não foi possível abrir o Lote de SMS" description={error} action={<Button onClick={reload}>Tentar de novo</Button>} />;
  }
  if (!data) return <p className="p-6 text-center text-sm text-muted">Carregando…</p>;

  const { progress, metrics, items, recent } = data;
  const progressPercent = progress.limit ? Math.min(100, Math.round((progress.sentToday / progress.limit) * 100)) : 0;

  return (
    <div className="space-y-4 pb-32">
      <p className="rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-[13px] leading-5 text-warning">{data.notice}</p>

      <KpiGrid label="Resultados do Lote de SMS">
        <Kpi label="Enviados" value={metrics.total.sent} hint={`${progress.sentToday} hoje`} />
        <Kpi label="Cliques no link" value={metrics.total.clicks} hint={`${metrics.byDay[0]?.clicks || 0} hoje`} />
        <Kpi label="Cadastros" value={metrics.total.signups} hint={`${metrics.byDay[0]?.signups || 0} hoje`} tone="accent" />
        <Kpi label="Taxa" value={percent(metrics.total.rate)} hint="cadastros ÷ enviados" />
      </KpiGrid>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm font-bold text-ink">
          <span>{progress.sentToday} de {progress.limit} hoje</span>
          <span className="text-xs font-semibold text-muted">{progress.remaining} para enviar</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-neutral-soft" role="progressbar" aria-valuemin={0} aria-valuemax={progress.limit} aria-valuenow={progress.sentToday} aria-label="SMS enviados hoje">
          <div className="h-full rounded-full bg-accent-strong transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {offlineCount ? (
        <p className="flex items-center gap-2 rounded-control border border-info-line bg-info-soft px-3 py-2 text-sm text-info" role="status">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          {offlineCount} envio(s) serão marcados quando a internet voltar.
        </p>
      ) : null}

      <Tabs
        label="Seções do Lote de SMS"
        value={tab}
        onChange={setTab}
        options={[
          { value: "send", label: `Para enviar (${items.length})` },
          { value: "sent", label: `Enviados (${recent.length})` },
          { value: "results", label: "Resultados e texto" }
        ]}
      />

      {tab === "send" ? (
        items.length ? (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <Card padding="md">
                  <p className="text-lg font-extrabold leading-tight text-ink">{item.name || "Sem nome"}</p>
                  <p className="mt-0.5 text-base tabular-nums text-muted">{item.phoneMasked}</p>
                  <a
                    href={item.href}
                    onClick={() => onTapSend(item)}
                    className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-accent-strong text-base font-extrabold text-on-accent active:brightness-95"
                  >
                    <MessageSquareText className="h-5 w-5" aria-hidden="true" />
                    Enviar SMS
                  </a>
                  <a href={item.fallbackHref} onClick={() => onTapSend(item)} className="mt-1 flex min-h-12 items-center justify-center text-sm font-semibold text-accent-text">
                    Não abriu o Mensagens? Tentar outro formato
                  </a>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={MessageSquareText}
            title={progress.remaining ? "Nenhum contato disponível agora" : "Meta de hoje concluída"}
            description={progress.remaining ? "Todos os contatos da base já tiveram alguma tentativa de contato." : "Amanhã a lista libera mais contatos."}
          />
        )
      ) : null}

      {tab === "sent" ? (
        recent.length ? (
          <ul className="space-y-3">
            {recent.map((entry) => (
              <li key={entry.id}>
                <Card padding="md">
                  <p className="text-base font-extrabold leading-tight text-ink">{entry.name || "Sem nome"}</p>
                  <p className="mt-0.5 text-sm text-muted">{entry.phoneMasked} · enviado {timeLabel(entry.sentAt)}</p>
                  <Button variant="danger-ghost" size="lg" block className="mt-2" loading={busyId === entry.id} onClick={() => optOut(entry)}>
                    Respondeu SAIR
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhum envio nos últimos 7 dias" description="Os SMS enviados aparecem aqui para você marcar quem respondeu SAIR." />
        )
      ) : null}

      {tab === "results" ? (
        <div className="space-y-4">
          <Card title="Por dia" note="últimos 14 dias">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-muted">
                <tr><th className="py-1 font-semibold">Dia</th><th className="py-1 font-semibold">Enviados</th><th className="py-1 font-semibold">Cliques</th><th className="py-1 font-semibold">Cadastros</th><th className="py-1 font-semibold">Taxa</th></tr>
              </thead>
              <tbody>
                {metrics.byDay.map((row) => (
                  <tr key={row.day} className="border-t border-line">
                    <td className="py-2">{dayLabel(row.day)}</td><td>{row.sent}</td><td>{row.clicks}</td><td>{row.signups}</td><td>{percent(row.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Texto e limite do dia">
            <div className="space-y-3">
              <Field label="Texto do SMS" hint={'Use [nome] e [link]. Precisa trazer o aviso "responda SAIR". Máx. 300 caracteres.'}>
                <textarea className={inputClasses} rows={6} value={draft.template} maxLength={300} onChange={(event) => setDraft({ ...draft, template: event.target.value })} />
              </Field>
              <Field label="Contatos por dia">
                <input className={inputClasses} inputMode="numeric" value={draft.limit} onChange={(event) => setDraft({ ...draft, limit: event.target.value.replace(/\D/g, "") })} />
              </Field>
              <Button size="lg" block loading={savingSettings} onClick={saveSettings}>Salvar</Button>
              <p className="break-all text-xs text-muted">Link do cadastro: {data.link}</p>
            </div>
          </Card>
        </div>
      ) : null}

      {undo ? (
        <div className="fixed inset-x-0 z-[55] flex justify-center px-4 bottom-[calc(5rem+max(env(safe-area-inset-bottom),var(--admin-bottom-nav-space)))]">
          <div className="flex w-full max-w-md items-center justify-between gap-3 rounded-control bg-navy px-4 py-2 text-sm text-white shadow-float" role="status">
            <span className="min-w-0 truncate">SMS para {undo.name || "o contato"} marcado como enviado</span>
            <button type="button" onClick={undoLast} className="flex min-h-12 shrink-0 items-center gap-1 px-2 font-extrabold underline">
              <Undo2 className="h-4 w-4" aria-hidden="true" /> Desfazer
            </button>
          </div>
        </div>
      ) : null}
      {toastElement}
      {confirmElement}
    </div>
  );
}
