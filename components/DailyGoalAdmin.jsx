"use client";

import { useEffect, useState } from "react";
import { Ban, Save } from "lucide-react";
import Avatar from "./Avatar";

const SESSION_STATUS_LABELS = {
  connected: { label: "Conectado", className: "bg-emerald-50 text-emerald-700" },
  reconnecting: { label: "Reconectando", className: "bg-amber-50 text-amber-700" },
  qr_required: { label: "Aguardando QR", className: "bg-amber-50 text-amber-700" },
  pairing_code_required: { label: "Aguardando código", className: "bg-amber-50 text-amber-700" },
  connecting: { label: "Conectando", className: "bg-amber-50 text-amber-700" },
  disconnected: { label: "Desconectado", className: "bg-red-50 text-red-700" },
  error: { label: "Erro", className: "bg-red-50 text-red-700" },
  nunca_conectou: { label: "Nunca conectou", className: "bg-mist text-muted" }
};

// Integração PARALELA ao WhatsApp (pedido do dono, 2026-10-01) — nunca
// substitui nem se confunde com o status do WhatsApp acima, sempre exibida
// como um badge separado, claramente rotulado "Google Contacts".
const GOOGLE_CONTACTS_STATUS_LABELS = {
  connected: { label: "Conectado", className: "bg-emerald-50 text-emerald-700" },
  error: { label: "Requer reconexão", className: "bg-amber-50 text-amber-700" },
  expired: { label: "Requer reconexão", className: "bg-amber-50 text-amber-700" },
  disconnected: { label: "Não configurado", className: "bg-mist text-muted" }
};

// Motivos internos de "pulado" traduzidos pra linguagem do dono — não são
// erro de verdade na maioria das vezes (ex.: cliente que já respondeu).
const SKIP_REASON_LABELS = {
  fora_da_janela: "Fora do horário configurado",
  fim_de_semana: "Fim de semana (dias úteis apenas)",
  sessao_nao_conectada: "WhatsApp desconectado no momento",
  fila_vazia: "Fila vazia",
  responsavel_mudou: "Cliente mudou de corretor antes do disparo",
  sem_modelo_de_mensagem: "Tentativa sem modelo de mensagem cadastrado",
  modelo_com_variavel_invalida: "Modelo com variável desconhecida — corrigir em Mensagens da automação",
  falha_ao_preparar_cliente: "Disparar desfeito (falha ao preparar o cliente)",
  round_nao_esta_mais_ativo: "Cliente não estava mais ativo (já converteu/encerrou)",
  contato_do_not_contact: "Contato pediu para não ser contactado (PARAR)",
  ja_teve_tentativa_hoje: "Cliente já tinha recebido tentativa hoje",
  sem_telefone: "Contato sem telefone cadastrado",
  sem_nome: "Contato sem nome cadastrado",
  automacao_desligada: "Automação foi desligada",
  reducao_temporaria_2026_10_03: "Redução temporária de 50% dos disparos (somente 03/10/2026)",
  pausado_para_investigacao: "Pausado manualmente para investigação",
  lead_respondeu: "Cliente respondeu — atendimento humano assumiu",
  falha_infraestrutura: "Instabilidade temporária (sessão/WhatsApp) — cliente não foi penalizado",
  movido_para_erro: "Cliente movido para \"Erro\" após 3 falhas técnicas seguidas",
  falha_destinatario_1_3: "Falha técnica ao enviar (1ª de 3) — será tentado de novo",
  falha_destinatario_2_3: "Falha técnica ao enviar (2ª de 3) — será tentado de novo",
  falha_destinatario_3_3: "Falha técnica ao enviar (3ª de 3)",
  google_contacts_sync_falhou: "Aguardando sincronização com o Google Contacts — será tentado de novo",
  reordenado_manualmente: "Fila reorganizada manualmente pelo admin",
  reordenado_automaticamente_reconexao: "Fila redistribuída automaticamente após reconectar o WhatsApp",
  reagendado_por_configuracao: "Fila recalculada automaticamente após salvar a configuração",
  reagendado_fora_da_configuracao: "Fila recalculada: item estava fora da janela/dia atual",
  bloqueado_fora_da_janela_no_envio: "Não enviado: horário fora da janela (fila recalculada)",
  enviando_sem_confirmacao: "Ficou em \"enviando\" sem confirmação — NÃO reenviado (conferir no WhatsApp)",
  preso_enviando_obsoleto: "Ficou em \"enviando\" sem ter enviado; tentativa já não era devida",
  opt_out_whatsapp: "Cliente pediu para parar (Não contactar)",
  nao_tem_interesse: "Corretor marcou Não tem interesse"
};

function minutesToTime(minutes) {
  const value = Number(minutes) || 0;
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeToMinutes(time) {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  return (Number(hour) || 0) * 60 + (Number(minute) || 0);
}

// Intervalo médio REAL entre os horários já agendados hoje (não a teoria de
// min/máx nem da oscilação) — arredonda pra minutos inteiros; menos de 1
// minuto mostra em segundos, pra não arredondar pra "0 min".
function formatGapMinutes(minutes) {
  if (minutes < 1) return `${Math.round(minutes * 60)} seg`;
  return `${Math.round(minutes)} min`;
}

// Horário (São Paulo) do item PENDENTE mais cedo da fila. Pedido do dono,
// 2026-09-30 (repetido várias vezes, categórico): NUNCA mostrar um horário
// passado nem a palavra "atrasado" — scheduled_for <= agora só significa que
// o item está ELEGÍVEL para processamento (o robô tenta a qualquer momento,
// a cada ciclo de 2 min), não que a fila travou. Quando já passou, mostra
// "aguardando processamento" em vez de fingir um horário; só mostra horário
// de verdade quando ele é de fato futuro.
function formatNextDispatch(isoString) {
  if (!isoString) return null;
  const scheduled = new Date(isoString).getTime();
  if (scheduled <= Date.now()) return "aguardando processamento";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(scheduled));
}

const TABS = [
  { key: "config", label: "Configurações" },
  { key: "messages", label: "Mensagens" },
  { key: "performance", label: "Desempenho" },
  { key: "automacao", label: "Automação" }
];

const MESSAGE_FIELDS = [
  { key: "message1", label: "Mensagem 1 — Primeiro contato" },
  { key: "message2", label: "Mensagem 2 — Pós-atendimento" },
  { key: "message3", label: "Mensagem 3 — Última tentativa" }
];

export default function DailyGoalAdmin({ initialSettings }) {
  const [tab, setTab] = useState("config");
  const [settings, setSettings] = useState(initialSettings);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <section className="container-page space-y-6">
      <div className="mx-auto flex w-full max-w-xl flex-wrap justify-center rounded-2xl border border-navy/[0.07] bg-white p-0.5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`min-w-[110px] flex-1 rounded-xl px-4 py-2 text-center text-[13px] font-extrabold transition duration-200 ${
              tab === item.key ? "bg-navy text-white shadow-soft" : "text-navy hover:bg-brand/10 hover:text-brand"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {feedback ? <p role="status" className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-bold text-navy">{feedback}</p> : null}

      {tab === "config" ? (
        <ConfigTab settings={settings} setSettings={setSettings} busy={busy} setBusy={setBusy} setFeedback={setFeedback} />
      ) : null}
      {tab === "messages" ? (
        <MessagesTab settings={settings} setSettings={setSettings} busy={busy} setBusy={setBusy} setFeedback={setFeedback} />
      ) : null}
      {tab === "performance" ? <PerformanceTab /> : null}
      {tab === "automacao" ? <AutomationTab /> : null}
    </section>
  );
}

// Um erro registrado ANTES da sessão atual conectar (ela caiu e reconectou
// depois) já foi resolvido pela reconexão — só falta um envio de sucesso
// pra zerar consecutive_errors sozinho. Sem isso, o painel mostrava alerta
// pra corretor já reconectado, mostrando um problema antigo como se fosse
// atual (pedido do dono, 2026-09-30).
function isIssueStale(broker) {
  if (broker.sessionStatus !== "connected" || !broker.lastIssue?.at || !broker.sessionLastConnectedAt) return false;
  return new Date(broker.sessionLastConnectedAt).getTime() > new Date(broker.lastIssue.at).getTime();
}

// "OK" = rodando de verdade agora: ligada, não pausada, WhatsApp conectado
// e sem erro em sequência acumulado (ou o erro já é de antes da reconexão atual).
function isAutoHealthy(broker) {
  if (!broker.enabled || broker.paused || broker.sessionStatus !== "connected") return false;
  if (!broker.consecutiveErrors) return true;
  return isIssueStale(broker);
}

// Visão do admin da automação da Meta Diária (pedido do dono, 2026-09-29):
// TODOS os corretores ativos — quem está rodando com a automação, quem está
// conectado no WhatsApp individual e quem está OK, mesmo quem nunca mexeu
// na automação — e permite pausar/retomar QUALQUER corretor.
// Atualiza sozinho a cada 20s (pedido do dono, 2026-09-30: mandou mensagem
// pro próximo cliente da fila e o card ficou com "Próximo disparo" antigo até
// ele recarregar a página na mão) — só enquanto esta aba estiver montada.
const AUTOMATION_POLL_MS = 20000;

function AutomationTab() {
  const [brokers, setBrokers] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [historyBrokerId, setHistoryBrokerId] = useState("");

  useEffect(() => {
    load();
    const interval = setInterval(load, AUTOMATION_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/admin/daily-goal-auto");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBrokers(data.brokers || []);
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar a automação.");
    }
  }

  async function togglePause(brokerId, paused) {
    setBusyId(brokerId);
    setError("");
    try {
      const response = await fetch("/api/admin/daily-goal-auto", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, paused })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBrokers(data.brokers || []);
    } catch (toggleError) {
      setError(toggleError.message || "Não foi possível atualizar.");
    } finally {
      setBusyId("");
    }
  }

  // Liga/desliga a automação de um corretor — o corretor não controla mais
  // isso sozinho (pedido do dono, 2026-09-30), então precisa ter como o
  // admin ativar pela 1ª vez ou desligar de vez (diferente de "Pausar", que
  // é temporário e mantém a fila/config).
  async function toggleEnabled(brokerId, enabled) {
    setBusyId(brokerId);
    setError("");
    try {
      const response = await fetch("/api/admin/daily-goal-auto", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, enabled })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBrokers(data.brokers || []);
    } catch (toggleError) {
      setError(toggleError.message || "Não foi possível atualizar.");
    } finally {
      setBusyId("");
    }
  }

  async function saveBrokerCap(brokerId, dailyCapOverride) {
    setBusyId(brokerId);
    setError("");
    try {
      const response = await fetch("/api/admin/daily-goal-auto", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, dailyCapOverride })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBrokers(data.brokers || []);
    } catch (capError) {
      setError(capError.message || "Não foi possível atualizar o teto diário.");
    } finally {
      setBusyId("");
    }
  }

  if (!brokers) return <p className="rounded-[24px] border border-line bg-white p-8 text-center font-bold text-muted">Carregando…</p>;

  // Rodando de verdade primeiro, depois quem tem algum problema, por último
  // quem nunca ligou — assim os casos que precisam de atenção aparecem no topo.
  const sorted = [...brokers].sort((a, b) => {
    const rank = (broker) => (isAutoHealthy(broker) ? 0 : broker.enabled ? 1 : 2);
    return rank(a) - rank(b) || a.brokerName.localeCompare(b.brokerName, "pt-BR");
  });
  const runningCount = brokers.filter((broker) => broker.enabled && !broker.paused).length;
  const totals = brokers.reduce(
    (acc, broker) => ({
      sentToday: acc.sentToday + (broker.sentToday || 0),
      sentUnconfirmedToday: acc.sentUnconfirmedToday + (broker.sentUnconfirmedToday || 0),
      pendingToday: acc.pendingToday + (broker.pendingToday || 0),
      skippedToday: acc.skippedToday + (broker.skippedToday || 0),
      errorToday: acc.errorToday + (broker.errorToday || 0),
      sentTotal: acc.sentTotal + (broker.sentTotal || 0)
    }),
    { sentToday: 0, sentUnconfirmedToday: 0, pendingToday: 0, skippedToday: 0, errorToday: 0, sentTotal: 0 }
  );

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Enviadas hoje" value={totals.sentToday} tone="emerald" />
        <StatCard label="Aguardando confirmação" value={totals.sentUnconfirmedToday} tone="amber" />
        <StatCard label="Na fila" value={totals.pendingToday} tone="brand" />
        <StatCard label="Puladas hoje" value={totals.skippedToday} tone="amber" />
        <StatCard label="Erros hoje" value={totals.errorToday} tone="red" />
        <StatCard label="Enviadas no total" value={totals.sentTotal} tone="navy" />
      </div>
      <p className="text-sm font-bold text-muted">{runningCount} de {brokers.length} corretores com a automação ligada.</p>

      <GlobalConfigPanel onSaved={load} />

      <AutoMessagesEditor />

      <div className="grid gap-3">
        {sorted.map((broker) => {
          const sessionInfo = SESSION_STATUS_LABELS[broker.sessionStatus] || SESSION_STATUS_LABELS.nunca_conectou;
          // "Rodando" só quando o WhatsApp individual está conectado de
          // verdade — ligada+sem pausa mas sem sessão vira "Aguardando
          // WhatsApp", nunca "Rodando" (o dispatcher pula, nada é enviado).
          const sessionConnected = broker.sessionStatus === "connected";
          const autoLabel = !broker.enabled ? "Desligada" : broker.paused ? "Pausada" : sessionConnected ? "Rodando" : broker.whatsappRestricted ? "WhatsApp restringido" : "Aguardando WhatsApp";
          const showRestrictedIcon = autoLabel === "WhatsApp restringido";
          const autoClassName = !broker.enabled ? "bg-mist text-muted" : showRestrictedIcon ? "bg-navy/10 text-navy ring-1 ring-navy/30" : broker.paused || !sessionConnected ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700";
          const healthy = isAutoHealthy(broker);
          return (
            <div key={broker.brokerId} className="rounded-2xl border border-line bg-white p-4 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={broker.brokerName} photoUrl={broker.brokerPhotoUrl} size={40} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-navy">{broker.brokerName}</p>
                      <span title={healthy ? "Tudo certo" : "Precisa de atenção"}>{healthy ? "✅" : "⚠️"}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${autoClassName}`}>{showRestrictedIcon ? <Ban aria-hidden="true" className="mr-1 inline h-3 w-3" /> : null}Automação: {autoLabel}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${sessionInfo.className}`}>WhatsApp: {sessionInfo.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${(GOOGLE_CONTACTS_STATUS_LABELS[broker.googleContactsStatus] || GOOGLE_CONTACTS_STATUS_LABELS.disconnected).className}`}>
                        Google Contacts: {(GOOGLE_CONTACTS_STATUS_LABELS[broker.googleContactsStatus] || GOOGLE_CONTACTS_STATUS_LABELS.disconnected).label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-muted">
                      Hoje: {broker.sentToday} enviadas{broker.sentUnconfirmedToday ? ` · ${broker.sentUnconfirmedToday} aguardando confirmação` : ""} · {broker.pendingToday} na fila · {broker.skippedToday} puladas · {broker.errorToday} com erro
                      {broker.consecutiveErrors ? ` · ${broker.consecutiveErrors} erros seguidos` : ""}
                    </p>
                    <p className="mt-0.5 text-xs font-bold text-muted">
                      Total de hoje: {broker.plannedToday} de até {broker.dailyCap} mensagem{broker.dailyCap === 1 ? "" : "s"}
                      {broker.avgGapMinutes !== null ? ` (~${formatGapMinutes(broker.avgGapMinutes)} entre elas)` : ""}
                      {broker.dailyCapReason ? ` · teto: ${broker.dailyCapReason}` : ""}
                    </p>
                    {broker.nextDispatchAt ? (
                      <p className="mt-0.5 text-xs font-bold text-brand">Próximo disparo: {formatNextDispatch(broker.nextDispatchAt)}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs font-bold text-muted">Total já enviado por este corretor: {broker.sentTotal}</p>
                    {broker.autoErrorTotal ? (
                      <p className="mt-0.5 text-xs font-bold text-red-700">{broker.autoErrorTotal} cliente{broker.autoErrorTotal === 1 ? "" : "s"} em "Erro" (3 falhas técnicas seguidas — veja o Histórico)</p>
                    ) : null}
                    {broker.paused ? <p className="mt-1 text-xs font-bold text-red-700">Pausado: {broker.pausedReason}</p> : null}
                    {/* "Último problema" removido daqui (pedido do dono, 2026-10-01) —
                        informação de "o que aconteceu" agora vive só no Histórico,
                        pra não duplicar entre a configuração e o detalhamento. */}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="text-xs font-bold text-brand hover:underline"
                    onClick={() => setHistoryBrokerId((current) => (current === broker.brokerId ? "" : broker.brokerId))}
                  >
                    {historyBrokerId === broker.brokerId ? "Fechar histórico" : "Histórico"}
                  </button>
                  {broker.enabled ? (
                    <>
                      <button
                        type="button"
                        className="client-action-button"
                        disabled={busyId === broker.brokerId}
                        onClick={() => togglePause(broker.brokerId, !broker.paused)}
                      >
                        {broker.paused ? "Retomar" : "Pausar"}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-bold text-muted hover:text-red-700"
                        disabled={busyId === broker.brokerId}
                        onClick={() => toggleEnabled(broker.brokerId, false)}
                      >
                        Desativar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="client-action-button"
                      disabled={busyId === broker.brokerId}
                      onClick={() => toggleEnabled(broker.brokerId, true)}
                    >
                      Ativar
                    </button>
                  )}
                </div>
              </div>
              {broker.enabled ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs font-bold text-muted">
                  <span>Janela: {minutesToTime(broker.windowStartMinutes)}–{minutesToTime(broker.windowEndMinutes)}</span>
                  <span>· Intervalo: {broker.oscillateEnabled ? `média automática ± ${broker.oscillatePercent}%${broker.maxAvgGapMinutes ? ` (média máx. ${broker.maxAvgGapMinutes} min)` : ""}` : `${broker.minGapMinutes}–${broker.maxGapMinutes} min`}</span>
                  <span>· {broker.businessDaysOnly ? "Só dias úteis" : "Todos os dias"}</span>
                  <span className="flex items-center gap-1">
                    · Teto diário:
                    <BrokerCapInput
                      brokerId={broker.brokerId}
                      value={broker.dailyCapOverride}
                      disabled={busyId === broker.brokerId}
                      onSave={saveBrokerCap}
                    />
                  </span>
                </div>
              ) : null}
              {historyBrokerId === broker.brokerId ? <BrokerHistoryPanel brokerId={broker.brokerId} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const HISTORY_PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "7 dias" }
];
const HISTORY_STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "sent", label: "Enviadas" },
  { value: "pending", label: "Pendentes/aguardando retry" },
  { value: "error", label: "Com erro" },
  { value: "skipped", label: "Puladas" },
  { value: "canceled", label: "Canceladas" }
];
const HISTORY_ATTEMPT_OPTIONS = [
  { value: "", label: "Todas as tentativas" },
  { value: "1", label: "1ª tentativa" },
  { value: "2", label: "2ª tentativa" },
  { value: "3", label: "3ª tentativa" }
];

// Histórico da automação por corretor (pedido do dono, 2026-09-30) —
// resumo do período + timeline cronológica, reaproveitando
// adminGetDailyGoalAutoHistory/daily_goal_auto_queue (nenhum dado novo).
// Exportado (pedido do dono, 2026-10-01): reaproveitado também pelo ícone de
// histórico do painel "Desempenho de Hoje" (components/TeamDailyPerformance.jsx),
// em vez de recriar o histórico lá.
export function BrokerHistoryPanel({ brokerId }) {
  const [period, setPeriod] = useState("today");
  const [status, setStatus] = useState("");
  const [attemptNumber, setAttemptNumber] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ brokerId });
        if (status) query.set("status", status);
        if (attemptNumber) query.set("attemptNumber", attemptNumber);
        if (period === "last7") {
          const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          query.set("from", from);
        } else {
          // "Hoje" também mostra o que ainda falta disparar até o fim do dia
          // (pedido do dono, 2026-10-02), não só o que já aconteceu.
          query.set("scheduled", "1");
        }
        const response = await fetch(`/api/admin/daily-goal-auto/history?${query.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setData(payload);
      } catch (requestError) {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar o histórico.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [brokerId, period, status, attemptNumber]);

  return (
    <div className="mt-3 rounded-2xl border border-line bg-mist/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {HISTORY_PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
              period === option.value ? "border-brand bg-blue-50 text-brand" : "border-line bg-white text-navy"
            }`}
          >
            {option.label}
          </button>
        ))}
        <select className="h-8 rounded-lg border border-line bg-white px-2 text-xs font-bold text-navy" value={status} onChange={(event) => setStatus(event.target.value)}>
          {HISTORY_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="h-8 rounded-lg border border-line bg-white px-2 text-xs font-bold text-navy" value={attemptNumber} onChange={(event) => setAttemptNumber(event.target.value)}>
          {HISTORY_ATTEMPT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {error ? <p className="mt-2 text-xs font-bold text-red-700">{error}</p> : null}
      {loading || !data ? (
        <p className="mt-3 text-xs font-bold text-muted">Carregando…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
            <HistoryStat label="Processadas" value={data.summary.processadas} />
            <HistoryStat label="Enviadas" value={data.summary.enviadas} tone="emerald" />
            <HistoryStat label="Aguard. retry" value={data.summary.aguardandoRetry} tone="amber" />
            <HistoryStat label="Erros" value={data.summary.erros} tone="red" />
            <HistoryStat label="Puladas" value={data.summary.puladas} />
            {typeof data.summary.agendadas === "number" ? <HistoryStat label="Agendadas" value={data.summary.agendadas} tone="brand" /> : null}
          </div>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-line bg-white">
            {data.timeline.length ? (
              <ul className="divide-y divide-line">
                {data.timeline.map((event) => (
                  <li key={event.id} className="px-3 py-2 text-xs">
                    {/* Para item NÃO enviado, `at` é a hora do registro
                        (ex.: cancelado ao reagendar) — nunca horário de envio. */}
                    <span className="font-black text-navy" title={event.status === "sent" ? "Enviado às" : "Registrado às"}>{formatTime(event.at)}</span>{" "}
                    <span className="font-bold text-navy">{event.contactName || "Contato sem nome"}</span>{" "}
                    {event.attemptNumber ? <span className="text-muted">· {event.attemptNumber}ª tentativa</span> : null}
                    {event.variant ? <span className="text-muted"> · Modelo {event.variant}</span> : null}
                    {event.source === "extra" ? <span className="text-muted"> · Disparar</span> : null}
                    {" · "}
                    <span className={
                      event.status === "sent" ? "font-bold text-emerald-700"
                        : event.status === "error" ? "font-bold text-red-700"
                        : "font-bold text-amber-700"
                    }>
                      {event.status === "sent" ? "Enviado" : SKIP_REASON_LABELS[event.reason] || event.reason || event.status}
                    </span>
                    {event.status !== "sent" && event.scheduledFor ? <span className="text-muted"> · estava agendado para {formatTime(event.scheduledFor)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-4 text-center text-xs font-bold text-muted">Nada no período selecionado.</p>
            )}
          </div>

          {Array.isArray(data.scheduled) ? (
            <div className="mt-3">
              <p className="text-[11px] font-black uppercase tracking-wide text-muted">Ainda hoje ({data.scheduled.length})</p>
              <div className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-white">
                {data.scheduled.length ? (
                  <ul className="divide-y divide-line">
                    {data.scheduled.map((event) => (
                      <li key={event.id} className="px-3 py-2 text-xs">
                        <span className="font-black text-brand">{formatNextDispatch(event.scheduledFor)}</span>{" "}
                        <span className="font-bold text-navy">{event.contactName || "Contato sem nome"}</span>{" "}
                        {event.attemptNumber ? <span className="text-muted">· {event.attemptNumber}ª tentativa</span> : null}
                        {event.variant ? <span className="text-muted"> · Modelo {event.variant}</span> : null}
                        {event.isRetry ? <span className="text-muted"> · retry</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-4 text-center text-xs font-bold text-muted">Nada mais agendado para hoje.</p>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function HistoryStat({ label, value, tone }) {
  const toneClass = { emerald: "text-emerald-700", amber: "text-amber-700", red: "text-red-700", brand: "text-brand" }[tone] || "text-navy";
  return (
    <div className="rounded-xl border border-line bg-white p-2 text-center">
      <p className={`text-lg font-black ${toneClass}`}>{value ?? 0}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = {
    emerald: "text-emerald-700",
    brand: "text-brand",
    amber: "text-amber-700",
    red: "text-red-700",
    navy: "text-navy"
  }[tone] || "text-navy";
  return (
    <div className="rounded-2xl border border-line bg-white p-3 text-center shadow-soft">
      <p className={`text-2xl font-black ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function BrokerCapInput({ brokerId, value, disabled, onSave }) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => setDraft(value ?? ""), [value]);

  return (
    <input
      type="number"
      min={1}
      max={100}
      placeholder="auto"
      className="w-16 rounded-lg border border-line px-2 py-0.5 text-center text-xs font-bold text-navy outline-none focus:border-brand"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const normalized = draft === "" ? null : Number(draft);
        if (normalized !== (value ?? null)) onSave(brokerId, normalized);
      }}
    />
  );
}

// Configuração global aplicada a todos os corretores de uma vez (pedido do
// dono, 2026-09-30: menu completo — janela de envio, intervalo entre
// mensagens, dias úteis, teto diário padrão). Também vira o padrão herdado
// por quem ligar a automação pela 1ª vez depois (ver getDailyGoalAutoDefaults).
function GlobalConfigPanel({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    fetch("/api/admin/daily-goal-auto/global-config").then((r) => r.json()).then((data) => setDraft(data)).catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setFeedback("");
    try {
      const response = await fetch("/api/admin/daily-goal-auto/global-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDraft(data.defaults);
      setFeedback("Configuração aplicada a todos os corretores.");
      onSaved?.();
    } catch (error) {
      setFeedback(error.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((current) => !current)}>
        <div>
          <h3 className="text-lg font-black text-navy">Configuração geral da automação</h3>
          <p className="mt-1 text-xs font-bold text-muted">Horário de envio, intervalo entre mensagens, dias úteis e teto diário — aplica a todos os corretores.</p>
        </div>
        <span className="text-sm font-black text-brand">{open ? "Fechar" : "Editar"}</span>
      </button>

      {open ? (
        !draft ? (
          <p className="mt-4 text-sm font-bold text-muted">Carregando…</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-black text-navy">Janela de envio</p>
                <p className="text-[11px] font-bold text-muted">Horário em que a automação pode disparar mensagens.</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="time"
                    className="rounded-xl border border-line px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand"
                    value={minutesToTime(draft.windowStartMinutes)}
                    onChange={(event) => setDraft((current) => ({ ...current, windowStartMinutes: timeToMinutes(event.target.value) }))}
                  />
                  <span className="text-sm font-bold text-muted">até</span>
                  <input
                    type="time"
                    className="rounded-xl border border-line px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand"
                    value={minutesToTime(draft.windowEndMinutes)}
                    onChange={(event) => setDraft((current) => ({ ...current, windowEndMinutes: timeToMinutes(event.target.value) }))}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-navy">Intervalo entre mensagens</p>
                <p className="text-[11px] font-bold text-muted">Tempo aleatório (min–máx) entre um disparo e outro do mesmo corretor. Ignorado se "Oscilar mensagens" estiver ligado.</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={180}
                    disabled={Boolean(draft.oscillateEnabled)}
                    className="w-20 rounded-xl border border-line px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand disabled:opacity-50"
                    value={draft.minGapMinutes}
                    onChange={(event) => setDraft((current) => ({ ...current, minGapMinutes: Number(event.target.value) }))}
                  />
                  <span className="text-sm font-bold text-muted">a</span>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    disabled={Boolean(draft.oscillateEnabled)}
                    className="w-20 rounded-xl border border-line px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand disabled:opacity-50"
                    value={draft.maxGapMinutes}
                    onChange={(event) => setDraft((current) => ({ ...current, maxGapMinutes: Number(event.target.value) }))}
                  />
                  <span className="text-sm font-bold text-muted">minutos</span>
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-navy">Oscilar mensagens</p>
                <p className="text-[11px] font-bold text-muted">
                  Em vez do intervalo fixo acima, calcula a média sozinho (tempo restante da janela ÷ mensagens do dia)
                  e varia cada envio ± o percentual abaixo. Ex.: 90 mensagens numa janela de 12h30 dá uma média de ~8
                  min; com 50% de oscilação, cada intervalo real fica entre ~4 e ~12 min.
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-navy">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.oscillateEnabled)}
                      onChange={(event) => setDraft((current) => ({ ...current, oscillateEnabled: event.target.checked }))}
                    />
                    Ligar oscilação
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!draft.oscillateEnabled}
                    className="w-20 rounded-xl border border-line px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand disabled:opacity-50"
                    value={draft.oscillatePercent ?? 50}
                    onChange={(event) => setDraft((current) => ({ ...current, oscillatePercent: Number(event.target.value) }))}
                  />
                  <span className="text-sm font-bold text-muted">%</span>
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-navy">Intervalo médio máximo</p>
                <p className="text-[11px] font-bold text-muted">Só com a oscilação ligada. Limita o intervalo médio entre mensagens: com pouco volume a fila termina cedo (a janela é o limite permitido, não a duração obrigatória). Com muito volume o intervalo diminui sozinho para tudo caber na janela. Vazio = sem limite (usa a janela inteira). Não é o mesmo que o intervalo mín./máx. acima, usado com a oscilação desligada.</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={180}
                    placeholder="sem limite"
                    disabled={!draft.oscillateEnabled}
                    className="w-28 rounded-xl border border-line px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand disabled:opacity-50"
                    value={draft.maxAvgGapMinutes ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, maxAvgGapMinutes: event.target.value === "" ? null : Number(event.target.value) }))}
                  />
                  <span className="text-sm font-bold text-muted">min</span>
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-navy">Teto diário padrão</p>
                <p className="text-[11px] font-bold text-muted">Máximo de mensagens automáticas por corretor por dia. Vazio = automático (todas as atividades pendentes do dia, limitado a 100).</p>
                <input
                  type="number"
                  min={1}
                  max={100}
                  placeholder="automático"
                  className="mt-2 w-28 rounded-xl border border-line px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand"
                  value={draft.dailyCapOverride ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, dailyCapOverride: event.target.value === "" ? null : Number(event.target.value) }))}
                />
              </div>

              <div>
                <p className="text-xs font-black text-navy">Dias de envio</p>
                <label className="mt-2 flex items-center gap-2 text-sm font-bold text-navy">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.businessDaysOnly)}
                    onChange={(event) => setDraft((current) => ({ ...current, businessDaysOnly: event.target.checked }))}
                  />
                  Enviar só em dias úteis (seg. a sex.)
                </label>
              </div>
            </div>

            {feedback ? <p className="text-sm font-bold text-navy">{feedback}</p> : null}
            <button type="button" className="premium-button-primary" disabled={busy} onClick={save}>
              {busy ? "Salvando..." : "Aplicar a todos os corretores"}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

// Máximo de variações por tentativa — o mesmo limite do servidor
// (AUTO_MESSAGE_MAX_VARIANTS em lib/daily-goal.js).
const AUTO_MESSAGE_FIELDS = [
  { key: "message1", label: "1ª tentativa", max: 4 },
  { key: "message2", label: "2ª tentativa", max: 4 },
  { key: "message3", label: "3ª tentativa", max: 10 }
];

// Variações sorteadas pela automação no momento do envio, com anti-repetição
// por WhatsApp (nenhuma se repete até todas da tentativa terem saído) —
// pedido do dono (2026-09-29/2026-10-02): variar o texto entre várias opções
// reduz o padrão repetitivo que ajuda a banir número no WhatsApp.
function AutoMessagesEditor() {
  const [drafts, setDrafts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/daily-goal-auto/messages").then((r) => r.json()).then((data) => setDrafts(data)).catch(() => {});
  }, []);

  function updateVariant(key, index, value) {
    setDrafts((current) => {
      const next = { ...current, [key]: [...(current[key] || [])] };
      next[key][index] = value;
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setFeedback("");
    try {
      const response = await fetch("/api/admin/daily-goal-auto/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drafts)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDrafts(data);
      setFeedback("Mensagens da automação salvas.");
    } catch (error) {
      setFeedback(error.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((current) => !current)}>
        <div>
          <h3 className="text-lg font-black text-navy">Mensagens da automação (até 4 variações na 1ª e 2ª tentativa, até 10 na 3ª)</h3>
          <p className="mt-1 text-xs font-bold text-muted">Sorteadas no envio sem repetir nenhuma até todas daquela tentativa terem saído pelo mesmo WhatsApp. Campo vazio é ignorado. Variáveis disponíveis: {"{saudacao}"}, {"{primeiro_nome}"}, {"{nome_corretor}"}, {"{associado_a}"}</p>
        </div>
        <span className="text-sm font-black text-brand">{open ? "Fechar" : "Editar"}</span>
      </button>

      {open ? (
        !drafts ? (
          <p className="mt-4 text-sm font-bold text-muted">Carregando…</p>
        ) : (
          <div className="mt-4 space-y-6">
            {AUTO_MESSAGE_FIELDS.map((field) => (
              <div key={field.key}>
                <p className="text-sm font-black text-navy">{field.label}</p>
                <div className="mt-2 grid gap-2">
                  {Array.from({ length: Math.max(field.max, (drafts[field.key] || []).length) }, (_, index) => (drafts[field.key] || [])[index] || "").map((text, index) => (
                    <textarea
                      key={index}
                      className="w-full rounded-2xl border border-line p-3 text-sm font-normal text-navy outline-none focus:border-brand"
                      rows={field.key === "message2" ? 6 : 2}
                      placeholder={`Variação ${index + 1}`}
                      value={text}
                      onChange={(event) => updateVariant(field.key, index, event.target.value)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {feedback ? <p className="text-sm font-bold text-navy">{feedback}</p> : null}
            <button type="button" className="premium-button-primary" disabled={busy} onClick={save}>
              {busy ? "Salvando..." : "Salvar mensagens da automação"}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

async function saveSettings(payload, setBusy, setFeedback, setSettings) {
  setBusy(true);
  setFeedback("");
  try {
    const response = await fetch("/api/daily-goal/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setSettings(data);
    setFeedback("Configurações salvas.");
  } catch (error) {
    setFeedback(error.message || "Não foi possível salvar.");
  } finally {
    setBusy(false);
  }
}

function ConfigTab({ settings, setSettings, busy, setBusy, setFeedback }) {
  const [quota, setQuota] = useState(settings?.quota || 30);
  const [walletLimit, setWalletLimit] = useState(settings?.wallet?.walletLimit ?? 100);
  const [blockOnLimit, setBlockOnLimit] = useState(settings?.wallet?.blockOnLimit ?? true);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-line bg-white p-6 shadow-soft md:p-8">
        <h2 className="text-xl font-black text-navy">Novos clientes por corretor/dia</h2>
        <p className="mt-1 text-sm font-bold text-muted">Padrão: 30. Alterar aqui só afeta as próximas gerações de Meta Diária.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-black text-navy">
            Quantidade diária
            <input
              className="mt-2 h-12 w-40 rounded-2xl border border-line bg-white px-4 font-bold text-navy outline-none focus:border-brand"
              max={500}
              min={1}
              onChange={(event) => setQuota(event.target.value)}
              type="number"
              value={quota}
            />
          </label>
          <button
            className="premium-button-primary"
            disabled={busy}
            onClick={() => saveSettings({ quota: Number(quota) }, setBusy, setFeedback, setSettings)}
            type="button"
          >
            <Save className="h-4 w-4" /> Salvar
          </button>
        </div>
        <div className="mt-6 rounded-2xl border border-line bg-mist/40 p-4">
          <p className="text-sm font-black text-navy">Retorno à fila após: 30 dias</p>
          <p className="mt-1 text-sm font-bold text-muted">
            Reaproveita a mesma trava de 30 dias já usada na fila de Prospecção — um cliente que completa a cadência
            sem conversão só volta a ficar disponível (no final da fila) depois desse período.
          </p>
        </div>
      </div>

      <div className="rounded-[28px] border border-line bg-white p-6 shadow-soft md:p-8">
        <h2 className="text-xl font-black text-navy">Carteira ativa</h2>
        <p className="mt-1 text-sm font-bold text-muted">
          Total de clientes que um corretor pode ter aguardando 1ª, 2ª e 3ª tentativa AO MESMO TEMPO (soma das três
          etapas). A distribuição diária nunca ultrapassa o espaço disponível: novos clientes = mínimo entre a cota
          diária e (limite − carteira ativa atual).
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-black text-navy">
            Limite máximo da carteira ativa
            <input
              className="mt-2 h-12 w-40 rounded-2xl border border-line bg-white px-4 font-bold text-navy outline-none focus:border-brand"
              max={5000}
              min={1}
              onChange={(event) => setWalletLimit(event.target.value)}
              type="number"
              value={walletLimit}
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-black text-navy">
            <input checked={blockOnLimit} onChange={(event) => setBlockOnLimit(event.target.checked)} type="checkbox" />
            Bloquear novas prospecções ao atingir o limite
          </label>
          <button
            className="premium-button-primary"
            disabled={busy}
            onClick={() => saveSettings({ wallet: { walletLimit: Number(walletLimit), blockOnLimit } }, setBusy, setFeedback, setSettings)}
            type="button"
          >
            <Save className="h-4 w-4" /> Salvar
          </button>
        </div>
        <p className="mt-4 text-xs font-bold text-muted">
          Com o bloqueio desligado, a carteira nunca impede novas prospecções (o limite deixa de ser aplicado).
        </p>
      </div>
    </div>
  );
}

function MessagesTab({ settings, setSettings, busy, setBusy, setFeedback }) {
  const [drafts, setDrafts] = useState(settings?.messages || {});

  function update(key, patch) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  return (
    <div className="space-y-4">
      {MESSAGE_FIELDS.map((field) => (
        <div key={field.key} className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
          <h3 className="text-lg font-black text-navy">{field.label}</h3>
          <textarea
            className="mt-3 w-full rounded-2xl border border-line p-4 font-normal text-navy outline-none focus:border-brand"
            rows={4}
            value={drafts[field.key]?.text || ""}
            onChange={(event) => update(field.key, { text: event.target.value })}
          />
          <p className="mt-2 text-xs font-bold text-muted">
            Variáveis disponíveis: {"{saudacao} {primeiro_nome} {nome_corretor} {codigo_cliente}"}
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm font-bold text-navy">
            <input
              type="checkbox"
              checked={Boolean(drafts[field.key]?.allowPersonalization)}
              onChange={(event) => update(field.key, { allowPersonalization: event.target.checked })}
            />
            Permitir personalização pelo corretor
          </label>
        </div>
      ))}
      <button
        className="premium-button-primary"
        disabled={busy}
        onClick={() => saveSettings({ messages: drafts }, setBusy, setFeedback, setSettings)}
        type="button"
      >
        <Save className="h-4 w-4" /> Salvar mensagens
      </button>
    </div>
  );
}

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "7 dias" },
  { value: "last30", label: "30 dias" }
];

function PerformanceTab() {
  const [period, setPeriod] = useState("today");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  async function load(signal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/daily-goal/performance?period=${period}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setData(payload);
    } catch (requestError) {
      if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar o desempenho.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            className={`min-h-11 rounded-full border px-4 text-sm font-extrabold transition ${
              period === option.value ? "border-brand bg-blue-50 text-brand" : "border-line bg-white text-navy hover:border-brand"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
      {loading || !data ? (
        <p className="rounded-[24px] border border-line bg-white p-8 text-center font-bold text-muted">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Previstas" value={data.summary.previstas} />
            <Metric label="Realizadas" value={data.summary.realizadas} />
            <Metric label="Automáticas" value={data.summary.automaticas} />
            <Metric label="% Meta Diária" value={formatPercent(data.summary.execucao)} />
            <Metric label="Taxa de reativação" value={formatPercent(data.summary.taxaReativacao)} />
          </div>

          <div className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
            <h3 className="text-lg font-black text-navy">Conversão por mensagem</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {data.summary.porMensagem.map((row) => (
                <div key={row.attemptNumber} className="rounded-2xl border border-line bg-mist/40 p-4">
                  <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">{row.attemptNumber}ª mensagem</p>
                  <p className="mt-1 text-sm font-bold text-navy">{row.abordados} abordados</p>
                  <p className="text-sm font-bold text-navy">{row.convertidos} convertidos</p>
                  <p className="mt-1 text-xl font-black text-brand">{formatPercent(row.taxa)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-[24px] border border-line bg-white p-6 shadow-soft">
            <h3 className="text-lg font-black text-navy">Desempenho por corretor</h3>
            <table className="mt-4 w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
                  <th className="pb-2">Corretor</th>
                  <th className="pb-2">Meta executada</th>
                  <th className="pb-2">1ª msg</th>
                  <th className="pb-2">2ª msg</th>
                  <th className="pb-2">3ª msg</th>
                  <th className="pb-2">Conversão total</th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((row) => (
                  <tr key={row.brokerId} className="border-t border-line">
                    <td className="py-2 font-black text-navy">{row.brokerName}</td>
                    <td className="py-2 font-bold text-navy">{formatPercent(row.execucao)}</td>
                    <td className="py-2 font-bold text-muted">{formatPercent(rate(row.porMensagem[1]))}</td>
                    <td className="py-2 font-bold text-muted">{formatPercent(rate(row.porMensagem[2]))}</td>
                    <td className="py-2 font-bold text-muted">{formatPercent(rate(row.porMensagem[3]))}</td>
                    <td className="py-2 font-black text-brand">{formatPercent(row.conversaoTotal)}</td>
                  </tr>
                ))}
                {!data.team.length ? (
                  <tr><td className="py-4 text-center font-bold text-muted" colSpan={6}>Nenhum dado para o período.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <PointsLedger period={period} team={data.team} />
        </>
      )}
    </div>
  );
}

// EXTRATO DE PONTOS — mesma tela de Desempenho (nunca um item novo no menu
// principal), consumindo a mesma fonte de eventos do ranking
// (getPointsLedger em lib/performance-overview.js) — nenhum ponto aqui pode
// existir sem uma linha correspondente, e a soma de cada corretor bate
// exatamente com o total que ele tem no Ranking do mesmo período.
function PointsLedger({ period, team }) {
  const [brokerId, setBrokerId] = useState("");
  const [activityFilter, setActivityFilter] = useState("all");
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ period, withReconciliation: "1" });
        if (brokerId) query.set("brokerId", brokerId);
        const response = await fetch(`/api/performance-overview/points-ledger?${query.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setLedger(payload.ledger);
      } catch (requestError) {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar o extrato.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [period, brokerId]);

  const activityOptions = Array.from(new Set((ledger?.rows || []).map((row) => row.origin)));
  const visibleRows = (ledger?.rows || []).filter((row) => activityFilter === "all" || row.origin === activityFilter);

  return (
    <div className="overflow-x-auto rounded-[24px] border border-line bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black text-navy">Extrato de Pontos</h3>
        <div className="flex flex-wrap gap-2">
          <select className="h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy" onChange={(event) => setBrokerId(event.target.value)} value={brokerId}>
            <option value="">Todos os corretores</option>
            {team.map((row) => <option key={row.brokerId} value={row.brokerId}>{row.brokerName}</option>)}
          </select>
          <select className="h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy" onChange={(event) => setActivityFilter(event.target.value)} value={activityFilter}>
            <option value="all">Todas as origens</option>
            {activityOptions.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
          </select>
        </div>
      </div>

      {error ? <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {ledger?.reconciliation?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {ledger.reconciliation.filter((entry) => !brokerId || entry.brokerId === brokerId).map((entry) => (
            <span key={entry.brokerId} className={`rounded-full px-3 py-1 text-xs font-extrabold ${entry.reconciled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {entry.brokerName}: {entry.reconciled ? "✓ Conferido" : `⚠ Divergência (extrato ${entry.ledgerPoints} × ranking ${entry.rankingPoints})`}
            </span>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-center font-bold text-muted">Carregando…</p>
      ) : (
        <table className="mt-4 w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
              <th className="pb-2">Corretor</th>
              <th className="pb-2">Cliente</th>
              <th className="pb-2">Ação</th>
              <th className="pb-2">Pontos</th>
              <th className="pb-2">Data</th>
              <th className="pb-2">Horário</th>
              <th className="pb-2">Origem</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={index} className="border-t border-line">
                <td className="py-2 font-black text-navy">{row.brokerName}</td>
                <td className="py-2 font-bold text-muted">{row.clientName}</td>
                <td className="py-2 font-bold text-navy">{row.action}</td>
                <td className={`py-2 font-black ${row.points >= 0 ? "text-brand" : "text-red-600"}`}>{row.points >= 0 ? `+${row.points}` : row.points}</td>
                <td className="py-2 font-bold text-muted">{formatDate(row.occurredAt)}</td>
                <td className="py-2 font-bold text-muted">{formatTime(row.occurredAt)}</td>
                <td className="py-2 font-bold text-muted">{row.origin}</td>
              </tr>
            ))}
            {!visibleRows.length ? (
              <tr><td className="py-4 text-center font-bold text-muted" colSpan={7}>Nenhum evento de pontuação neste período.</td></tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "—";
}
function formatTime(value) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
}

function rate(entry) {
  if (!entry || !entry.abordados) return null;
  return entry.convertidos / entry.abordados;
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 text-center shadow-soft">
      <p className="text-2xl font-black text-navy">{value}</p>
      <p className="mt-1 text-xs font-bold text-muted">{label}</p>
    </div>
  );
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}
