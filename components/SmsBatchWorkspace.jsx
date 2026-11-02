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
// Fluxo em duas mensagens: "Para enviar" (1ª) -> "Aguardando 2ª" (1ª enviada) -> "Enviados" (2ª enviada ou SAIR).
// A marcação fica numa fila no aparelho (localStorage): se o iOS fechar o app ou a internet cair, ela é concluída
// quando voltar. Regras e gravação: lib/sms-batch-core.mjs / lib/sms-batch.js (aqui só apresentação).
const AWAITING_KEY = "mm-sms-awaiting";
const QUEUE_KEY = "mm-sms-queue";
const UNDO_MS = 6000;
const MIN_AWAY_MS = 800;
// A saudação (Bom dia/Boa tarde/Boa noite) vem pronta do servidor: lista velha é refeita ao voltar ao app.
const STALE_MS = 10 * 60 * 1000;

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

const SendLink = ({ href, fallbackHref, label, onTap }) => (
  <>
    <a href={href} onClick={onTap} className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-accent-strong text-base font-extrabold text-on-accent active:brightness-95">
      <MessageSquareText className="h-5 w-5" aria-hidden="true" />
      {label}
    </a>
    <a href={fallbackHref} onClick={onTap} className="mt-1 flex min-h-12 items-center justify-center text-sm font-semibold text-accent-text">
      Não abriu o Mensagens? Tentar outro formato
    </a>
  </>
);

export default function SmsBatchWorkspace({ initial = null, initialError = "" }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError);
  const [tab, setTab] = useState("send");
  const [undo, setUndo] = useState(null);
  const [offlineCount, setOfflineCount] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [draft, setDraft] = useState({ template: initial?.settings?.template || "", template2: initial?.settings?.template2 || "", limit: String(initial?.settings?.limit || 50) });
  const [savingSettings, setSavingSettings] = useState(false);
  const [notify, toastElement] = useToast();
  const [confirmAction, confirmElement] = useConfirm();
  const flushing = useRef(false);
  const undoTimer = useRef(null);
  const loadedAt = useRef(Date.now());

  const reload = useCallback(async () => {
    try {
      const next = await call("GET");
      loadedAt.current = Date.now();
      setData(next);
      setError("");
    } catch (loadError) {
      setData((current) => {
        if (!current) setError(loadError.message);
        return current;
      });
    }
  }, []);

  useEffect(() => {
    if (!initial && !initialError) reload();
    // Só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fila de envios a marcar (sobrevive a app fechado e internet caída). kind 1 = 1ª mensagem (id do contato);
  // kind 2 = 2ª mensagem (id do envio da 1ª).
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let queue = readJson(QUEUE_KEY, []);
      while (queue.length) {
        const entry = queue[0];
        const second = entry.kind === 2;
        try {
          const result = await call("POST", second ? { action: "sent-2", sendId: entry.id } : { action: "sent", contactId: entry.id });
          queue = queue.slice(1);
          writeJson(QUEUE_KEY, queue);
          setData((current) => {
            if (!current) return current;
            if (second) {
              const moved = current.awaiting.find((item) => item.id === entry.id);
              return {
                ...current,
                awaiting: current.awaiting.filter((item) => item.id !== entry.id),
                done: moved ? [{ ...moved, state: "complete", secondAt: result.sentAt || new Date().toISOString() }, ...current.done] : current.done,
                metrics: { ...current.metrics, total: { ...current.metrics.total, sent2: current.metrics.total.sent2 + 1 } }
              };
            }
            return {
              ...current,
              items: current.items.filter((item) => item.id !== entry.id),
              progress: { ...current.progress, sentToday: current.progress.sentToday + 1, remaining: Math.max(0, current.progress.remaining - 1) },
              metrics: { ...current.metrics, total: { ...current.metrics.total, sent: current.metrics.total.sent + 1 } }
            };
          });
          if (result.sendId) {
            clearTimeout(undoTimer.current);
            setUndo({ sendId: result.sendId, name: entry.name, second });
            undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
          }
          // A 1ª enviada entra em "Aguardando 2ª": busca a lista pronta (com o texto da 2ª) em segundo plano.
          if (!second && result.sendId) reload();
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
  }, [notify, reload]);

  // Voltou ao app depois de abrir o Mensagens: o SMS que estava aguardando vira "enviado".
  const resume = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    const awaiting = readJson(AWAITING_KEY, null);
    if (awaiting && Date.now() - awaiting.at > MIN_AWAY_MS) {
      writeJson(AWAITING_KEY, null);
      writeJson(QUEUE_KEY, [...readJson(QUEUE_KEY, []), { id: awaiting.id, name: awaiting.name, kind: awaiting.kind || 1 }]);
    }
    if (readJson(QUEUE_KEY, []).length) {
      setOfflineCount(readJson(QUEUE_KEY, []).length);
      flush();
    } else if (Date.now() - loadedAt.current > STALE_MS) {
      reload();
    }
  }, [flush, reload]);

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

  const onTapSend = (item, kind) => writeJson(AWAITING_KEY, { id: item.id, name: item.firstName || item.name, kind, at: Date.now() });

  const undoLast = async () => {
    const current = undo;
    if (!current) return;
    clearTimeout(undoTimer.current);
    setUndo(null);
    try {
      await call("POST", { action: "undo", sendId: current.sendId });
      notify(current.second ? "Envio da 2ª mensagem desfeito." : "Envio desfeito: o contato voltou para a lista.");
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
      setData((current) => ({
        ...current,
        awaiting: current.awaiting.filter((row) => row.id !== entry.id),
        done: current.done.map((row) => (row.id === entry.id ? { ...row, state: "opt_out" } : row))
      }));
      notify("Marcado como Não contactar.");
      reload();
    } catch (optError) {
      notify(optError.message, "danger");
    } finally {
      setBusyId("");
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const saved = await call("POST", { action: "settings", template: draft.template, template2: draft.template2, limit: Number(draft.limit) });
      notify("Textos e limite salvos.");
      setDraft({ template: saved.template, template2: saved.template2, limit: String(saved.limit) });
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

  const { progress, metrics, items, awaiting, done } = data;
  const progressPercent = progress.limit ? Math.min(100, Math.round((progress.sentToday / progress.limit) * 100)) : 0;

  return (
    <div className="space-y-4 pb-32">
      <p className="rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-[13px] leading-5 text-warning">{data.notice}</p>

      <KpiGrid label="Resultados do Lote de SMS">
        <Kpi label="Enviados" value={metrics.total.sent + metrics.total.sent2} hint={`1ª: ${metrics.total.sent} · 2ª: ${metrics.total.sent2}`} />
        <Kpi label="Cliques no link" value={metrics.total.clicks} hint={`${metrics.byDay[0]?.clicks || 0} hoje`} />
        <Kpi label="Cadastros" value={metrics.total.signups} hint={`${metrics.byDay[0]?.signups || 0} hoje`} tone="accent" />
        <Kpi label="Taxa" value={percent(metrics.total.rate)} hint="cadastros ÷ 1ª enviada" />
      </KpiGrid>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm font-bold text-ink">
          <span>{progress.sentToday} de {progress.limit} hoje</span>
          <span className="text-xs font-semibold text-muted">{progress.remaining} para enviar</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-neutral-soft" role="progressbar" aria-valuemin={0} aria-valuemax={progress.limit} aria-valuenow={progress.sentToday} aria-label="1ª mensagem enviada hoje">
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
          { value: "second", label: `Aguardando 2ª (${awaiting.length})` },
          { value: "sent", label: `Enviados (${done.length})` },
          { value: "results", label: "Resultados e textos" }
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
                  <SendLink href={item.href} fallbackHref={item.fallbackHref} label="Enviar SMS" onTap={() => onTapSend(item, 1)} />
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

      {tab === "second" ? (
        awaiting.length ? (
          <ul className="space-y-3">
            {awaiting.map((entry) => (
              <li key={entry.id}>
                <Card padding="md">
                  <p className="text-lg font-extrabold leading-tight text-ink">{entry.name || "Sem nome"}</p>
                  <p className="mt-0.5 text-sm text-muted">{entry.phoneMasked} · 1ª enviada {timeLabel(entry.sentAt)}</p>
                  <SendLink href={entry.href} fallbackHref={entry.fallbackHref} label="Enviar 2ª mensagem" onTap={() => onTapSend(entry, 2)} />
                  <Button variant="danger-ghost" size="lg" block className="mt-1" loading={busyId === entry.id} onClick={() => optOut(entry)}>
                    Respondeu SAIR
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhum contato aguardando a 2ª mensagem" description="Depois de enviar a 1ª mensagem, o contato aparece aqui para receber a 2ª." />
        )
      ) : null}

      {tab === "sent" ? (
        done.length ? (
          <ul className="space-y-3">
            {done.map((entry) => (
              <li key={entry.id}>
                <Card padding="md">
                  <p className="text-base font-extrabold leading-tight text-ink">{entry.name || "Sem nome"}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {entry.phoneMasked} · {entry.state === "opt_out" ? "respondeu SAIR (Não contactar)" : `2ª enviada ${timeLabel(entry.secondAt)}`}
                  </p>
                  {entry.state === "complete" ? (
                    <Button variant="danger-ghost" size="lg" block className="mt-2" loading={busyId === entry.id} onClick={() => optOut(entry)}>
                      Respondeu SAIR
                    </Button>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhum envio concluído ainda" description="Quem já recebeu as duas mensagens, ou respondeu SAIR, aparece aqui." />
        )
      ) : null}

      {tab === "results" ? (
        <div className="space-y-4">
          <Card title="Por dia" note="últimos 14 dias">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-muted">
                <tr><th className="py-1 font-semibold">Dia</th><th className="py-1 font-semibold">1ª</th><th className="py-1 font-semibold">2ª</th><th className="py-1 font-semibold">Cliques</th><th className="py-1 font-semibold">Cadastros</th><th className="py-1 font-semibold">Taxa</th></tr>
              </thead>
              <tbody>
                {metrics.byDay.map((row) => (
                  <tr key={row.day} className="border-t border-line">
                    <td className="py-2">{dayLabel(row.day)}</td><td>{row.sent}</td><td>{row.sent2}</td><td>{row.clicks}</td><td>{row.signups}</td><td>{percent(row.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Textos e limite do dia">
            <div className="space-y-3">
              <Field label="1ª mensagem" hint="Use [Saudação] (Bom dia/Boa tarde/Boa noite), [nome] e [link]. Máx. 600 caracteres.">
                <textarea className={inputClasses} rows={9} value={draft.template} maxLength={600} onChange={(event) => setDraft({ ...draft, template: event.target.value })} />
              </Field>
              <Field label="2ª mensagem" hint={'Precisa trazer o aviso "responda SAIR". Máx. 600 caracteres.'}>
                <textarea className={inputClasses} rows={7} value={draft.template2} maxLength={600} onChange={(event) => setDraft({ ...draft, template2: event.target.value })} />
              </Field>
              <Field label="Contatos por dia (1ª mensagem)">
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
            <span className="min-w-0 truncate">{undo.second ? "2ª mensagem" : "SMS"} para {undo.name || "o contato"} marcado como enviado</span>
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
