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
// Dois perfis de tela (data.scope): "broker" = lote do corretor (50/dia reservados só para ele, números dele, resultados dele);
// "team" = admin geral/gestor (lote da equipe, textos e limite editáveis, cartão por corretor e filtro por corretor).
const AWAITING_KEY = "mm-sms-awaiting";
const TOGETHER_KEY = "mm-sms-together";
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

// PRO-18e: o corretor só usa o Lote no Wi-Fi da imobiliária (o servidor responde 403 com este código).
const OFFICE_ONLY_CODE = "SMS_BATCH_OFFICE_ONLY";
const WHATSAPP_REQUIRED_CODE = "SMS_BATCH_WHATSAPP_REQUIRED";

// Período dos resultados (dono, 2026-11-02): "Tudo" é o padrão de sempre; os atalhos e as datas são validados no servidor.
const PERIOD_OPTIONS = [
  { value: "all", label: "Tudo" },
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7", label: "Últimos 7 dias" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "custom", label: "Personalizado" }
];
// Contagem na hora ao marcar um envio: só se o envio cai no que a tela mostra (período com hoje e lote próprio/todos).
function bumpMetrics(current, add) {
  const { metrics, period, scope, lot } = current;
  if ((scope !== "broker" && lot && lot !== "team") || (period && !period.includesToday)) return metrics;
  return { ...metrics, total: { ...metrics.total, sent: metrics.total.sent + (add.sent || 0), sent2: metrics.total.sent2 + (add.sent2 || 0), contacted: (metrics.total.contacted ?? metrics.total.sent) + (add.sent || 0) } };
}
const resultsQuery = ({ broker, preset, from, to, resultsOnly = false }) => {
  const params = new URLSearchParams();
  if (resultsOnly) params.set("resultsOnly", "1");
  if (broker) params.set("broker", broker);
  if (preset && preset !== "all") {
    params.set("preset", preset);
    if (preset === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};

// A leitura da lista tem tempo máximo: se o servidor demorar, a tela mostra o aviso com "Tentar de novo" em vez de ficar
// carregando para sempre. Gravações (POST) nunca são interrompidas daqui.
// (45 s: quando há telefones a checar no WhatsApp, o servidor espaça as consultas e pode levar ~25 s por rodada.)
const LOAD_TIMEOUT_MS = 45000;
// Checagem de WhatsApp em andamento: a tela pede a próxima rodada sozinha, no máximo isto de vezes seguidas.
const MAX_AUTO_CHECKS = 30;

async function call(method, body, query = "") {
  // GET: 45 s; gravação (POST): 15 s — um pedido que o iOS deixou pendurado ao ir para o segundo plano não trava a fila.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), method === "GET" ? LOAD_TIMEOUT_MS : 15000);
  let response;
  try {
    response = await fetch(`/api/admin/lote-sms${query}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      keepalive: method === "POST", // a gravação termina mesmo se o app for para o segundo plano (abrindo o Mensagens)
      signal: controller.signal
    });
  } catch (fetchError) {
    if (fetchError?.name === "AbortError") throw new Error("A lista demorou para carregar. Toque em \"Tentar de novo\".");
    throw fetchError;
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || "Não foi possível concluir."), { status: response.status, code: payload.code || "" });
  return payload;
}

// iPhone entende `sms:<n>&body=`; Android só entende `sms:<n>?body=`. O formato certo vira o botão principal conforme o
// aparelho (decidido depois de montar, para não divergir do HTML do servidor); o outro fica no link de reserva.
const useIsAndroid = () => {
  const [android, setAndroid] = useState(false);
  useEffect(() => {
    try {
      setAndroid(/android/i.test(navigator.userAgent || ""));
    } catch {}
  }, []);
  return android;
};

const androidSmsHref = (href) => (typeof href === "string" && href.startsWith("sms:") ? href.replace("&body=", "?body=") : href);

const SendLink = ({ href, fallbackHref, label, onTap }) => {
  const android = useIsAndroid();
  const main = android && fallbackHref ? fallbackHref : href;
  const other = android && fallbackHref ? href : fallbackHref;
  return (
    <>
      <a href={main} onClick={onTap} className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-accent-strong text-base font-extrabold text-on-accent active:brightness-95">
        <MessageSquareText className="h-5 w-5" aria-hidden="true" />
        {label}
      </a>
      <a href={other} onClick={onTap} className="mt-1 flex min-h-12 items-center justify-center text-sm font-semibold text-accent-text">
        Não abriu o Mensagens? Tentar outro formato
      </a>
    </>
  );
};

export default function SmsBatchWorkspace({ initial = null, initialError = "" }) {
  const android = useIsAndroid();
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError);
  const [tab, setTab] = useState("send");
  const [undo, setUndo] = useState(null);
  const [offlineCount, setOfflineCount] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [draft, setDraft] = useState({ template: initial?.settings?.template || "", template2: initial?.settings?.template2 || "", templateBroker: initial?.settings?.templateBroker || "", limit: String(initial?.settings?.limit || 50) });
  const [brokerFilter, setBrokerFilter] = useState("");
  const [preset, setPreset] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [officeBlocked, setOfficeBlocked] = useState(false);
  const [needsWhatsapp, setNeedsWhatsapp] = useState(false);
  const [resultsBusy, setResultsBusy] = useState(false);
  const [brokerPickerOpen, setBrokerPickerOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  // Cartão some na hora ao tocar em "Enviar" (volume mais rápido); volta se o SMS não chegou a ser aberto.
  const [hiddenIds, setHiddenIds] = useState([]);
  const [openedIds, setOpenedIds] = useState([]);
  // Enviar as 2 mensagens juntas, num SMS só (ligado por padrão; guardado neste aparelho).
  const [together, setTogether] = useState(true);
  useEffect(() => {
    setTogether(readJson(TOGETHER_KEY, true) !== false);
  }, []);
  const [notify, toastElement] = useToast();
  const [confirmAction, confirmElement] = useConfirm();
  const flushing = useRef(0);
  const undoTimer = useRef(null);
  const loadedAt = useRef(Date.now());
  const autoChecks = useRef(0);

  const brokerFilterRef = useRef("");
  const periodRef = useRef({ preset: "today", from: "", to: "" });
  const reload = useCallback(async () => {
    try {
      const next = await call("GET", null, resultsQuery({ broker: brokerFilterRef.current, ...periodRef.current }));
      loadedAt.current = Date.now();
      setData(next);
      setError("");
      setOfficeBlocked(false);
      setNeedsWhatsapp(false);
    } catch (loadError) {
      if (loadError.code === OFFICE_ONLY_CODE || loadError.code === WHATSAPP_REQUIRED_CODE) {
        setNeedsWhatsapp(loadError.code === WHATSAPP_REQUIRED_CODE);
        // Saiu do Wi-Fi da imobiliária: nada de dados de contato na tela (a fila de envios já feitos continua gravando).
        setData(null);
        setError("");
        setOfficeBlocked(true);
        return;
      }
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

  // Checagem de WhatsApp (só consulta; nada é enviado): enquanto o servidor ainda tem telefones a checar, pede a rodada
  // seguinte sozinho. Para se uma rodada não avançar (nada checado) ou depois de MAX_AUTO_CHECKS.
  useEffect(() => {
    const wa = data?.whatsapp;
    if (wa?.state === "checking" && wa.checked > 0 && autoChecks.current < MAX_AUTO_CHECKS) {
      autoChecks.current += 1;
      const timer = setTimeout(reload, 400);
      return () => clearTimeout(timer);
    }
    autoChecks.current = 0;
    return undefined;
  }, [data?.loadedAt, data?.whatsapp, reload]);

  // Fila de envios a marcar (sobrevive a app fechado e internet caída). kind 1 = 1ª mensagem (id do contato);
  // kind 2 = 2ª mensagem (id do envio da 1ª).
  const flush = useCallback(async () => {
    // Rodada anterior pendurada há mais de 20 s (o iOS suspendeu o app no meio): libera e recomeça.
    if (flushing.current && Date.now() - flushing.current < 20000) return;
    flushing.current = Date.now();
    try {
      let stalled = false;
      let queue = readJson(QUEUE_KEY, []);
      const sameEntry = (a, b) => a.id === b.id && (a.kind || 1) === (b.kind || 1);
      // Um envio da fila: "done" (gravado), "discard" (recusado pelo servidor) ou "offline" (sem internet: fica na fila).
      const processEntry = async (entry) => {
        const second = entry.kind === 2;
        try {
          const result = await call("POST", second ? { action: "sent-2", sendId: entry.id } : { action: "sent", contactId: entry.id });
          // Enviadas juntas: a 2ª também é marcada como enviada, no mesmo passo (se falhar, o cartão segue em "Aguardando 2ª").
          let result2 = null;
          if (!second && entry.both && result.sendId) {
            try {
              result2 = await call("POST", { action: "sent-2", sendId: result.sendId });
            } catch {
              result2 = null;
            }
          }
          setData((current) => {
            if (!current) return current;
            const optimistic = !second ? current.awaiting.find((row) => row.contactId === entry.id) : null;
            const sentItem = !second ? (current.items.find((item) => item.id === entry.id) || optimistic) : null;
            if (second) {
              const moved = current.awaiting.find((item) => item.id === entry.id);
              return {
                ...current,
                awaiting: current.awaiting.filter((item) => item.id !== entry.id),
                done: moved ? [{ ...moved, state: "complete", secondAt: result.sentAt || new Date().toISOString() }, ...current.done] : current.done,
                metrics: bumpMetrics(current, { sent2: 1 })
              };
            }
            return {
              ...current,
              // 1ª enviada: o cartão já entra em "Aguardando 2ª" (com a 2ª pronta), sem esperar a lista recarregar.
              done: sentItem && result.sendId && result2 ? [{ id: result.sendId, name: sentItem.name, phoneMasked: sentItem.phoneMasked, sentAt: new Date().toISOString(), secondAt: new Date().toISOString(), state: "complete" }, ...current.done] : current.done,
              awaiting: result2
                ? current.awaiting.filter((row) => row.contactId !== entry.id)
                : sentItem && result.sendId
                ? (current.awaiting.some((row) => row.contactId === entry.id)
                  ? current.awaiting.map((row) => (row.contactId === entry.id ? { ...row, id: result.sendId, pending: false } : row))
                  : [...current.awaiting, { id: result.sendId, contactId: entry.id, name: sentItem.name, phoneMasked: sentItem.phoneMasked, sentAt: new Date().toISOString(), state: "awaiting", href: sentItem.secondHref, fallbackHref: sentItem.secondFallbackHref, resendHref: sentItem.href }])
                : current.awaiting,
              items: current.items.filter((item) => item.id !== entry.id),
              progress: { ...current.progress, sentToday: current.progress.sentToday + 1, remaining: Math.max(0, current.progress.remaining - 1) },
              metrics: bumpMetrics(current, { sent: 1, sent2: result2 ? 1 : 0 })
            };
          });
          // A 1ª enviada já entrou em "Aguardando 2ª" localmente (sem recarregar a lista).
          return "done";
        } catch (sendError) {
          if (sendError.status === 409) {
            // Já gravado/indisponível (ex.: o mesmo toque entrou duas vezes): o contato sai da lista, sem alarme e sem voltar.
            setData((current) => (current ? { ...current, items: current.items.filter((item) => item.id !== entry.id), awaiting: current.awaiting.filter((row) => row.contactId !== entry.id) } : current));
            return "discard";
          }
          if (sendError.status) {
            // O servidor recusou (ex.: contato já não está disponível): descarta e avisa.
            setHiddenIds((current) => current.filter((id) => id !== `${second ? 2 : 1}:${entry.id}`));
            notify(`${entry.name || "Contato"}: ${sendError.message}`, "danger");
            return "discard";
          }
          return "offline"; // sem internet: tenta de novo quando voltar
        }
      };
      // Vários ao mesmo tempo (3 por vez): a fila esvazia bem mais rápido do que um por um.
      while (queue.length) {
        const batch = queue.slice(0, 3);
        const outcomes = await Promise.all(batch.map(processEntry));
        // Relê a fila: toques novos entram enquanto esta rodada grava (nada se perde).
        queue = readJson(QUEUE_KEY, []).filter((entry) => !batch.some((item, index) => sameEntry(item, entry) && outcomes[index] !== "offline"));
        writeJson(QUEUE_KEY, queue);
        if (outcomes.includes("offline")) {
          stalled = true;
          break;
        }
      }
      setOfflineCount(readJson(QUEUE_KEY, []).length);
      // Toque que entrou no último instante da rodada: roda de novo (menos quando parou por falta de internet).
      if (!stalled && readJson(QUEUE_KEY, []).length) setTimeout(() => flush(), 300);
    } finally {
      flushing.current = 0;
    }
  }, [notify, reload]);

  // Voltou ao app depois de abrir o Mensagens: o SMS que estava aguardando vira "enviado".
  const resume = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    const awaiting = readJson(AWAITING_KEY, null);
    if (awaiting && Date.now() - awaiting.at <= MIN_AWAY_MS) {
      setHiddenIds((current) => current.filter((id) => id !== `${awaiting.kind || 1}:${awaiting.id}`));
    }
    if (awaiting && Date.now() - awaiting.at > MIN_AWAY_MS) {
      writeJson(AWAITING_KEY, null);
      writeJson(QUEUE_KEY, [...readJson(QUEUE_KEY, []), { id: awaiting.id, name: awaiting.name, kind: awaiting.kind || 1, both: Boolean(awaiting.both) }]);
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

  const loadMore = async () => {
    setBusyId("more");
    try {
      await call("POST", { action: "more" });
      await reload();
      setTab("send");
    } catch (moreError) {
      notify(moreError.message, "danger");
    } finally {
      setBusyId("");
    }
  };

  const resetList = async () => {
    const ok = await confirmAction({
      title: "Zerar a lista?",
      description: `Os ${items.length} contatos desta lista serão marcados como já enviados (1ª e 2ª mensagem) e entram 50 novos. Nenhuma mensagem é enviada agora.`,
      confirmLabel: "Sim, já enviei estes",
      tone: "danger"
    });
    if (!ok) return;
    setBusyId("reset");
    try {
      const result = await call("POST", { action: "reset-list" });
      await reload();
      notify(`${result.marked} contato(s) marcados como enviados. Lista nova carregada.`);
    } catch (resetError) {
      notify(resetError.message, "danger");
    } finally {
      setBusyId("");
    }
  };

  const confirmSecond = (entry) => {
    // Some na hora (a gravação segue em segundo plano, na fila): dá para ir direto para o próximo.
    setHiddenIds((current) => [...current, `2:${entry.id}`]);
    // Cartão ainda sem gravação da 1ª (pending): grava a 1ª e a 2ª juntas, pelo contato.
    writeJson(QUEUE_KEY, [...readJson(QUEUE_KEY, []), entry.pending && entry.contactId ? { id: entry.contactId, name: entry.name, kind: 1, both: true } : { id: entry.id, name: entry.name, kind: 2 }]);
    setOfflineCount(readJson(QUEUE_KEY, []).length);
    flush();
  };

  const onTapSend = (item, kind) => {
    // 2ª mensagem: o toque em "Enviar 2ª mensagem" já grava como enviada e o cartão sai (retornos: aba Enviados).
    if (kind === 2) {
      confirmSecond(item);
      return;
    }
    // 1ª: grava NA HORA do toque (fila + envio imediato com keepalive), sem esperar a volta do Mensagens.
    const queued = readJson(QUEUE_KEY, []);
    if (!queued.some((row) => row.id === item.id && (row.kind || 1) === kind)) {
      writeJson(QUEUE_KEY, [...queued, { id: item.id, name: item.firstName || item.name, kind, both: together }]);
    }
    setOfflineCount(readJson(QUEUE_KEY, []).length);
    setHiddenIds((current) => [...current, `${kind}:${item.id}`]);
    // Modo separado: o cartão já entra em "Aguardando 2ª" no toque (com a 2ª pronta). Os botões de retorno liberam quando a
    // gravação devolver o id do envio.
    if (!together) {
      setData((current) => (current && !current.awaiting.some((row) => row.contactId === item.id)
        ? { ...current, awaiting: [...current.awaiting, { id: `tmp:${item.id}`, contactId: item.id, pending: true, name: item.name, phoneMasked: item.phoneMasked, sentAt: new Date().toISOString(), state: "awaiting", href: item.secondHref, fallbackHref: item.secondFallbackHref, resendHref: item.href }] }
        : current));
    }
    flush();
  };

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

  // Cartão ainda sem gravação da 1ª: grava agora (idempotente) e devolve o id real do envio.
  const withSendId = async (entry) => {
    if (!entry.pending || !entry.contactId) return entry;
    const saved = await call("POST", { action: "sent", contactId: entry.contactId });
    return { ...entry, id: saved.sendId || entry.id, pending: false };
  };

  const markInvalid = async (rawEntry, reason = "nonexistent") => {
    const entry = rawEntry;
    const inactive = reason === "inactive";
    const ok = await confirmAction({
      title: inactive ? "Número não ativo?" : "Número não existe?",
      description: `${entry.name || entry.phoneMasked} não recebe a 2ª mensagem e vai para a aba "Inexistentes". Não vira "Não contactar".`,
      confirmLabel: inactive ? "Sim, número não ativo" : "Sim, número não existe",
      tone: "danger"
    });
    if (!ok) return;
    setBusyId(entry.id);
    try {
      const ready = await withSendId(entry);
      await call("POST", { action: "invalid", sendId: ready.id, reason });
      setData((current) => ({
        ...current,
        awaiting: current.awaiting.filter((row) => row.id !== entry.id),
        done: [{ ...entry, state: "invalid", invalidReason: reason }, ...current.done.filter((row) => row.id !== entry.id)]
      }));
      notify(inactive ? "Marcado como número não ativo." : "Marcado como número que não existe.");
    } catch (invalidError) {
      notify(invalidError.message, "danger");
    } finally {
      setBusyId("");
    }
  };

  const optOut = async (rawEntry) => {
    const entry = rawEntry;
    const ok = await confirmAction({
      title: "Respondeu SAIR?",
      description: `${entry.name || entry.phoneMasked} vai para "Não contactar" e não recebe mais contato nosso, em nenhum canal.`,
      confirmLabel: "Sim, respondeu SAIR",
      tone: "danger"
    });
    if (!ok) return;
    setBusyId(entry.id);
    try {
      const ready = await withSendId(entry);
      await call("POST", { action: "opt-out", sendId: ready.id });
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

  // Troca de lote/período: busca SÓ os resultados (leve, sem remontar a lista de 50) e mostra "Atualizando…"; se falhar,
  // avisa — antes a tela mantinha os números antigos em silêncio e parecia que o filtro não funcionava.
  const reloadResults = async () => {
    setResultsBusy(true);
    try {
      const next = await call("GET", null, resultsQuery({ broker: brokerFilterRef.current, ...periodRef.current, resultsOnly: true }));
      setData((current) => (current ? { ...current, metrics: next.metrics, metricsLabel: next.metricsLabel, period: next.period, lot: next.lot, brokers: next.brokers, signups: next.signups, clickers: next.clickers } : current));
    } catch (resultsError) {
      notify("Não foi possível atualizar os resultados agora. Toque de novo.", "danger");
    } finally {
      setResultsBusy(false);
    }
  };

  const changeBrokerFilter = (value) => {
    brokerFilterRef.current = value;
    setBrokerFilter(value);
    reloadResults();
  };

  // Período: atalhos aplicam na hora; "Personalizado" só depois das duas datas (o servidor valida de novo).
  const applyPeriod = (nextPreset, from = customFrom, to = customTo) => {
    setPreset(nextPreset);
    if (nextPreset === "custom" && (!from || !to)) return;
    periodRef.current = { preset: nextPreset, from, to };
    reloadResults();
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const saved = await call("POST", { action: "settings", template: draft.template, template2: draft.template2, templateBroker: draft.templateBroker, limit: Number(draft.limit) });
      notify("Textos e limite salvos.");
      setDraft({ template: saved.template, template2: saved.template2, templateBroker: saved.templateBroker, limit: String(saved.limit) });
      await reload();
    } catch (saveError) {
      notify(saveError.message, "danger");
    } finally {
      setSavingSettings(false);
    }
  };

  if (officeBlocked) {
    // PRO-18e: sem lista, sem contatos, nada — só o aviso. Envios já marcados no aparelho continuam sendo gravados.
    return (
      <div data-no-reveal="">
        <EmptyState
          icon={WifiOff}
          title={needsWhatsapp ? "WhatsApp desconectado" : "Fora da imobiliária"}
          description={needsWhatsapp ? "Para usar o Lote de SMS, conecte o seu WhatsApp ao CRM (ícone do WhatsApp no topo) e toque em Tentar de novo." : "O Lote de SMS só funciona no Wi-Fi da imobiliária. Conecte-se ao Wi-Fi do escritório."}
          action={<Button size="lg" onClick={reload}>Tentar de novo</Button>}
        />
        {toastElement}
      </div>
    );
  }
  if (error && !data) {
    return <EmptyState tone="danger" title="Não foi possível abrir o Lote de SMS" description={error} action={<Button onClick={reload}>Tentar de novo</Button>} />;
  }
  if (!data) return <p className="p-6 text-center text-sm text-muted">Carregando…</p>;

  const { progress, metrics, items, awaiting, done } = data;
  const isTeam = data.scope === "team";
  const isManager = data.scope === "manager"; // gestor: lote próprio + corretores da equipe; sem configurações nem base inteira
  // Período escolhido (dono, 2026-11-02): "Tudo" é o padrão; "Hoje" também mostra o dia de hoje nos cartões.
  const filtered = Boolean(data.period?.from) && data.period.preset !== "today";
  const customReady = preset !== "custom" || (customFrom && customTo);
  const wa = data.whatsapp || { state: "ok" };
  const noWhatsapp = data.noWhatsapp;

  // Contagem na hora: o toque em Enviar já desconta (a gravação segue na fila, em segundo plano).
  const tappedNow = items.filter((item) => hiddenIds.includes(`1:${item.id}`)).length;
  const visibleItems = items.filter((item) => !hiddenIds.includes(`1:${item.id}`));
  const progressPercent = progress.limit ? Math.min(100, Math.round(((progress.sentToday + tappedNow) / progress.limit) * 100)) : 0;
  const visibleAwaiting = awaiting.filter((entry) => !hiddenIds.includes(`2:${entry.id}`));
  return (
    <div className="space-y-4 pb-32" data-no-reveal="">
      <div className="space-y-3">
      <Field label="Período">
              <Tabs label="Período dos resultados" value={preset} onChange={(value) => applyPeriod(value)} options={PERIOD_OPTIONS} />
            </Field>
            {preset === "custom" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data inicial">
                  <input type="date" className={inputClasses} value={customFrom} max={customTo || undefined} onChange={(event) => { setCustomFrom(event.target.value); applyPeriod("custom", event.target.value, customTo); }} />
                </Field>
                <Field label="Data final">
                  <input type="date" className={inputClasses} value={customTo} min={customFrom || undefined} onChange={(event) => { setCustomTo(event.target.value); applyPeriod("custom", customFrom, event.target.value); }} />
                </Field>
                {!customReady ? <p className="col-span-2 text-xs text-muted">Escolha a data inicial e a final (fuso de São Paulo, até 366 dias).</p> : null}
              </div>
            ) : null}
      </div>

      {!isTeam && !isManager ? (
        <p className="rounded-control border border-info-line bg-info-soft px-3 py-2 text-[13px] leading-5 text-info">
          Estes contatos estão reservados só para você por 24 h. Quem preencher o cadastro pelo seu link fica com você, direto, sem passar pela roleta.
        </p>
      ) : null}

      {data.period?.from || data.lot ? (
        <p className="text-xs font-semibold text-muted" role="status">
          Resultados de: {data.metricsLabel}{data.period?.from ? ` · ${data.period.label}` : ""}{resultsBusy ? " · Atualizando…" : ""}
        </p>
      ) : null}
      <KpiGrid label="Resultados do Lote de SMS">
        <Kpi label="Pessoas contactadas" value={metrics.total.contacted ?? metrics.total.sent} hint={`1ª: ${metrics.total.sent} · 2ª: ${metrics.total.sent2}`} />
        <div
          role="button"
          tabIndex={0}
          className="cursor-pointer rounded-card active:brightness-95"
          aria-label="Ver quem clicou"
          onClick={() => { setTab("results"); setTimeout(() => document.getElementById("sms-clickers")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
        >
          <Kpi label="Cliques no link" value={metrics.total.clicks} hint={`${filtered ? "no período" : `${metrics.byDay[0]?.clicks || 0} hoje`} · toque para ver quem`} />
        </div>
        <div
          role="button"
          tabIndex={0}
          className="cursor-pointer rounded-card active:brightness-95"
          aria-label="Ver quem clicou"
          onClick={() => { setTab("results"); setTimeout(() => document.getElementById("sms-clickers")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
        >
          <Kpi label="Contatos que clicaram" value={data.clickers?.total || 0} hint="pessoas diferentes · toque para ver" />
        </div>
        <div
          role="button"
          tabIndex={0}
          className="cursor-pointer rounded-card active:brightness-95"
          aria-label="Ver os cadastros"
          onClick={() => { setTab("results"); setTimeout(() => document.getElementById("sms-signups")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
        >
          <Kpi label="Cadastros" value={metrics.total.signups} hint={`${filtered ? "no período" : `${metrics.byDay[0]?.signups || 0} hoje`} · toque para ver`} tone="accent" />
        </div>
        <Kpi label="Simulações enviadas" value={metrics.total.simulations || 0} hint="dos cadastros destes links" />
        <Kpi label="Taxa" value={percent(metrics.total.rate)} hint="cadastros ÷ 1ª enviada" />
      </KpiGrid>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm font-bold text-ink">
          <span>{progress.sentToday + tappedNow} de {progress.limit} hoje</span>
          <span className="text-xs font-semibold text-muted">{Math.max(0, progress.remaining - tappedNow)} para enviar</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-neutral-soft" role="progressbar" aria-valuemin={0} aria-valuemax={progress.limit} aria-valuenow={progress.sentToday} aria-label="1ª mensagem enviada hoje">
          <div className="h-full rounded-full bg-accent-strong transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>


      {wa.state === "checking" ? (
        <p className="rounded-control border border-info-line bg-info-soft px-3 py-2 text-[13px] leading-5 text-info" role="status">
          Conferindo quais telefones têm WhatsApp (só consulta, nada é enviado)… a lista completa aparece sozinha.
        </p>
      ) : null}
      {wa.state === "limit" ? (
        <p className="rounded-control border border-info-line bg-info-soft px-3 py-2 text-[13px] leading-5 text-info" role="status">
          Limite de consultas de WhatsApp desta rodada atingido. Atualize a tela mais tarde para completar a lista.
        </p>
      ) : null}
      {wa.state === "unavailable" && wa.reason !== "desligada" ? (
        <p className="text-xs leading-5 text-muted" role="status">
          Checagem de WhatsApp indisponível agora ({wa.reason === "sem_sessao" ? "nenhum WhatsApp do administrador conectado" : wa.reason === "sem_tabela" ? "falta liberar a tabela no banco" : "serviço do WhatsApp sem resposta"}): a lista saiu sem filtrar quem não tem WhatsApp.
        </p>
      ) : null}

      <Button variant={tab === "results" ? "primary" : "secondary"} size="lg" block onClick={() => { setTab("results"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
        Resultados do disparo
      </Button>

      <Tabs
        label="Seções do Lote de SMS"
        value={tab}
        onChange={setTab}
        options={[
          { value: "send", label: `Para enviar (${visibleItems.length})` },
          { value: "second", label: `Aguardando 2ª (${visibleAwaiting.length})` },
          { value: "sent", label: `Enviados (${done.filter((row) => row.state !== "invalid").length}${data.doneCapped ? "+" : ""})` },
          { value: "invalid", label: `Inexistentes (${done.filter((row) => row.state === "invalid").length})` },
          ...(isTeam ? [{ value: "nowa", label: `Sem WhatsApp (${noWhatsapp?.total || 0})` }] : []),
          { value: "results", label: isTeam ? "Resultados e textos" : "Meus resultados" }
        ]}
      />

      {tab === "send" ? (
        <div className="grid gap-2">
          <Button variant="secondary" size="lg" block loading={busyId === "more"} onClick={loadMore}>
            Carregar mais 50 contatos
          </Button>
          {visibleItems.length ? (
            <Button variant="secondary" size="lg" block onClick={() => window.location.assign("/api/admin/lote-sms?vcard=1")}>
              Salvar estes contatos no iPhone
            </Button>
          ) : null}
          {visibleItems.length ? (
            <Button variant="danger-ghost" size="lg" block loading={busyId === "reset"} onClick={resetList}>
              Já enviei estes: zerar e trazer 50 novos
            </Button>
          ) : null}
        </div>
      ) : null}

      {tab === "send" ? (
        <label className="flex min-h-12 items-center gap-3 rounded-control border border-line px-3 text-sm font-semibold text-ink">
          <input type="checkbox" className="h-5 w-5" checked={together} onChange={(event) => { setTogether(event.target.checked); writeJson(TOGETHER_KEY, event.target.checked); }} />
          Enviar as 2 mensagens juntas (um toque só)
        </label>
      ) : null}

      {tab === "send" ? (
        visibleItems.length ? (
          <ul className="space-y-3">
            {visibleItems.map((item) => (
              <li key={item.id}>
                <Card padding="md">
                  <p className="text-lg font-extrabold leading-tight text-ink">{item.name || "Sem nome"}</p>
                  <p className="mt-0.5 text-base tabular-nums text-muted">{item.phoneMasked}</p>
                  <SendLink href={together && item.bothHref ? item.bothHref : item.href} fallbackHref={together && item.bothFallbackHref ? item.bothFallbackHref : item.fallbackHref} label={together ? "Enviar SMS (1ª + 2ª juntas)" : "Enviar SMS"} onTap={() => onTapSend(item, 1)} />
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <EmptyState
              icon={MessageSquareText}
              title={wa.state === "checking" ? "Conferindo os telefones…" : progress.remaining ? "Nenhum contato disponível agora" : "Meta de hoje concluída"}
              description={progress.remaining ? (isTeam ? "Todos os contatos da base já tiveram alguma tentativa de contato." : "Não há contato livre agora: os demais já tiveram contato ou estão reservados para outro corretor.") : "Quer mais? Carregue outros 50 contatos da base que nunca tiveram tentativa."}
            />
            {!progress.remaining ? (
              <Button variant="primary" size="lg" block className="mt-3" loading={busyId === "more"} onClick={loadMore}>
                Carregar mais 50 contatos
              </Button>
            ) : null}
          </>
        )
      ) : null}

      {tab === "second" ? (
        visibleAwaiting.length ? (
          <ul className="space-y-3">
            {visibleAwaiting.map((entry) => (
              <li key={entry.id}>
                <Card padding="md">
                  <p className="text-lg font-extrabold leading-tight text-ink">{entry.name || "Sem nome"}</p>
                  <p className="mt-0.5 text-sm text-muted">{entry.phoneMasked} · 1ª enviada {timeLabel(entry.sentAt)}</p>
                  <SendLink href={entry.href} fallbackHref={entry.fallbackHref} label="Enviar 2ª mensagem" onTap={() => onTapSend(entry, 2)} />
                  <a href={android ? androidSmsHref(entry.resendHref) : entry.resendHref} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line text-base font-bold text-ink active:brightness-95">
                    Enviar 1ª novamente
                  </a>
                  <Button variant="secondary" size="lg" block className="mt-1" loading={busyId === entry.id} onClick={() => markInvalid(entry, "nonexistent")}>
                    Número não existe
                  </Button>
                  <Button variant="secondary" size="lg" block className="mt-1" loading={busyId === entry.id} onClick={() => markInvalid(entry, "inactive")}>
                    Número não ativo
                  </Button>
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
            {done.filter((row) => row.state !== "invalid").map((entry) => (
              <li key={entry.id}>
                <Card padding="md">
                  <p className="text-base font-extrabold leading-tight text-ink">{entry.name || "Sem nome"}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {entry.phoneMasked} · {entry.state === "invalid" ? "número inexistente" : entry.state === "opt_out" ? "respondeu SAIR (Não contactar)" : `2ª enviada ${timeLabel(entry.secondAt)}`}
                  </p>
                  {entry.state === "complete" ? (
                    <Button variant="secondary" size="lg" block className="mt-2" loading={busyId === entry.id} onClick={() => markInvalid(entry, "nonexistent")}>
                      Número não existe
                    </Button>
                  ) : null}
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

      {tab === "invalid" ? (
        done.some((row) => row.state === "invalid") ? (
          <ul className="space-y-3">
            {done.filter((row) => row.state === "invalid").map((entry) => (
              <li key={entry.id}>
                <Card padding="md">
                  <p className="text-base font-extrabold leading-tight text-ink">{entry.name || "Sem nome"}</p>
                  <p className="mt-0.5 text-sm text-muted">{entry.phoneMasked} · {entry.invalidReason === "inactive" ? "número não ativo" : "número não existe"}</p>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhum número inexistente" description="Telefones marcados como não existe ou não ativo aparecem aqui, para tentar por ligação depois." />
        )
      ) : null}

      {tab === "nowa" && isTeam ? (
        !noWhatsapp?.available ? (
          <EmptyState title="Lista indisponível agora" description="A tabela da checagem de WhatsApp ainda não está liberada no banco." />
        ) : noWhatsapp.items.length ? (
          <>
            <p className="text-[13px] leading-5 text-muted">
              Telefones que a consulta apontou sem conta de WhatsApp (últimos 30 dias). Ficam fora do lote de SMS; nada muda no contato nem no cliente. Para tentar por ligação.
            </p>
            <ul className="space-y-3">
              {noWhatsapp.items.map((entry) => (
                <li key={entry.id}>
                  <Card padding="md">
                    <p className="text-base font-extrabold leading-tight text-ink">{entry.name || "Sem nome"}</p>
                    <p className="mt-0.5 text-sm text-muted">{entry.phoneMasked} · checado em {timeLabel(entry.checkedAt)}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState title="Nenhum telefone sem WhatsApp ainda" description="Quem não tiver conta de WhatsApp, quando a lista do dia for conferida, aparece aqui." />
        )
      ) : null}

      {tab === "results" ? (
        <div className="space-y-4">
          <Card title="Lote" note={data.period?.label || "Todo o período"}>
            <div className="space-y-3">
              {(isTeam || isManager) && data.brokers?.length ? (
                <>
                  <Field label="Lote">
                    <Tabs
                      label="Lote dos resultados"
                      value={brokerFilter === "" || brokerFilter === "team" ? brokerFilter : "pick"}
                      onChange={(value) => (value === "pick" ? setBrokerPickerOpen((open) => !open) : (setBrokerPickerOpen(false), changeBrokerFilter(value)))}
                      options={[
                        { value: "", label: "Todos" },
                        { value: "team", label: "O meu" },
                        { value: "pick", label: brokerFilter && brokerFilter !== "team" ? (data.brokers.find((row) => row.id === brokerFilter)?.name || "Corretor") : "Corretor ▾" }
                      ]}
                    />
                  </Field>
                  {brokerPickerOpen ? (
                    <div className="rounded-card border border-line bg-surface p-2" role="listbox" aria-label="Escolher corretor">
                      <ul className="divide-y divide-line">
                        {data.brokers.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={brokerFilter === row.id}
                              className={`flex w-full items-center justify-between gap-3 px-2 py-3 text-left active:brightness-95 ${brokerFilter === row.id ? "font-extrabold text-accent-text" : "font-semibold text-ink"}`}
                              onClick={() => { setBrokerPickerOpen(false); changeBrokerFilter(row.id); }}
                            >
                              <span className="truncate">{row.name}</span>
                              <span className="shrink-0 text-xs tabular-nums text-muted">1ª {row.sent} · 2ª {row.sent2} · cliques {row.clicks} · cad. {row.signups}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </Card>
          <Card id="sms-clickers" title="Quem clicou" note={`${data.clickers?.total || 0} contato(s)`}>
            {data.clickers?.list?.length ? (
              <ul className="divide-y divide-line">
                {data.clickers.list.map((row) => (
                  <li key={row.token} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold text-ink">{row.name}</p>
                      <p className="text-sm tabular-nums text-muted">{row.phoneMasked} · {timeLabel(row.lastClickedAt)} · {row.clicks === 1 ? "1 clique" : `${row.clicks} cliques`}</p>
                      <p className={`text-sm font-semibold ${row.registered ? "text-success" : "text-muted"}`}>{row.registered ? "Preencheu o formulário" : "Ainda não preencheu"}</p>
                    </div>
                    {row.href ? <Button href={row.href} variant="secondary" size="md">Abrir cliente</Button> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Ninguém clicou no link individual ainda. Só contam os SMS enviados com o link de cada contato.</p>
            )}
          </Card>
          <Card id="sms-signups" title="Quem preencheu o formulário" note={`${data.signups?.length || 0} cliente(s)`}>
            {data.signups?.length ? (
              <ul className="divide-y divide-line">
                {data.signups.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold text-ink">{row.name}</p>
                      <p className="text-sm tabular-nums text-muted">{row.phone} · {timeLabel(row.at)}</p>
                      {row.from ? <p className="text-sm text-muted">Veio do contato {row.from.name || "da base"}{row.from.phoneMasked ? ` · ${row.from.phoneMasked}` : ""}</p> : null}
                    </div>
                    {row.href ? <Button href={row.href} variant="secondary" size="md">Abrir cliente</Button> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Ninguém preencheu o formulário ainda.</p>
            )}
          </Card>
          {(isTeam || isManager) && data.brokers?.length ? (
            <Card title="Por corretor" note={`mensagens disparadas · ${data.period?.label || "todo o período"}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm tabular-nums">
                  <thead className="text-xs text-muted">
                    <tr><th className="py-1 font-semibold">Corretor</th><th className="py-1 font-semibold">1ª</th><th className="py-1 font-semibold">2ª</th><th className="py-1 font-semibold">Cliques</th><th className="py-1 font-semibold">Cadastros</th><th className="py-1 font-semibold">Simul.</th></tr>
                  </thead>
                  <tbody>
                    {data.brokers.map((row) => (
                      <tr key={row.id} className="border-t border-line">
                        <td className="py-2 pr-2">{row.name}</td><td>{row.sent}</td><td>{row.sent2}</td><td>{row.clicks}</td><td>{row.signups}</td><td>{row.simulations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
          <Card title="Por dia" note={`${data.metricsLabel || ""} · ${data.period?.from ? data.period.label : "últimos 14 dias"}`}>
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
          {isTeam ? (
          <Card title="Textos e limite do dia">
            <div className="space-y-3">
              <Field label="1ª mensagem" hint="Use [Saudação] (Bom dia/Boa tarde/Boa noite), [nome] e [link]. Máx. 600 caracteres.">
                <textarea className={inputClasses} rows={9} value={draft.template} maxLength={600} onChange={(event) => setDraft({ ...draft, template: event.target.value })} />
              </Field>
              <Field label="1ª mensagem dos corretores" hint="Como a 1ª mensagem, mais [corretor] (nome de quem envia). Máx. 600 caracteres.">
                <textarea className={inputClasses} rows={9} value={draft.templateBroker} maxLength={600} onChange={(event) => setDraft({ ...draft, templateBroker: event.target.value })} />
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
          ) : (
            <Card title="Seu link do cadastro">
              <p className="break-all text-xs text-muted">{data.link}</p>
            </Card>
          )}
        </div>
      ) : null}

      {toastElement}
      {confirmElement}
    </div>
  );
}
