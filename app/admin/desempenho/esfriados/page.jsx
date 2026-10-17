import Link from "next/link";
import AdminSectionNav from "@/components/AdminSectionNav";
import CooledFlowToggle from "@/components/cooled/CooledFlowToggle";
import CooledClientPhone from "@/components/cooled/CooledClientPhone";
import { isGeneralAdmin, requireBrokerManagementPage } from "@/lib/admin-auth";
import { getCooledFlowSettings, listCooledCaseHistory } from "@/lib/cooled-clients";

export const dynamic = "force-dynamic";

// Histórico do fluxo de clientes que esfriaram (dono, 2026-10-16): admin geral vê todos; gestora, a própria equipe
// (filtro no servidor, listCooledCaseHistory). Somente consulta — decisões são na caixinha do cabeçalho.
const PERIODS = [7, 30, 90];
const DECISIONS = [
  { key: "", label: "Todos" },
  { key: "open", label: "Em aberto" },
  { key: "transferred", label: "Transferidos" },
  { key: "second_chance", label: "Segunda chance" },
  { key: "status", label: "Status negativo" },
  { key: "canceled", label: "Encerrados sozinhos" }
];
const STATUS_LABEL = { awaiting_reason: "Aguardando corretor", awaiting_decision: "Aguardando decisão", closed: "Decidido", canceled: "Encerrado sozinho" };
const CANCEL_LABEL = { responsavel_mudou: "mudou de responsável", contato_retomado: "contato retomado", status_negativo: "status negativo", contato_particular: "contato particular", cliente_removido: "cliente removido", cliente_aprovado: "cliente aprovado", cliente_com_restricao: "cliente com restrição" };
const TRANSFER_REASON_LABEL = { sem_conversa: "automático: sem conversa", nao_respondeu: "automático: não respondeu" };

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function outcome(item) {
  if (item.decision === "transferred") return `Transferido${TRANSFER_REASON_LABEL[item.transferReason] ? ` (${TRANSFER_REASON_LABEL[item.transferReason]})` : ""}${item.transferredToName ? ` para ${item.transferredToName}` : ""}`;
  if (item.decision === "second_chance") return `Segunda chance${item.brokerName ? ` para ${item.brokerName}` : ""}`;
  if (item.decision === "status") return `Status: ${item.decisionStatusLabel}`;
  if (item.status === "canceled") return `Encerrado (${CANCEL_LABEL[item.canceledReason] || item.canceledReason || "sem motivo"})`;
  return STATUS_LABEL[item.status] || item.status;
}

export default async function CooledClientsHistoryPage({ searchParams }) {
  const auth = await requireBrokerManagementPage();
  const params = await searchParams;
  const days = PERIODS.includes(Number(params?.dias)) ? Number(params.dias) : 30;
  const decision = DECISIONS.some((item) => item.key === params?.decisao) ? params.decisao : "";
  const brokerId = typeof params?.corretor === "string" ? params.corretor : "";
  const canToggle = isGeneralAdmin(auth) && !auth.accountSwitchMode;

  let report = { brokers: [], items: [] };
  let settings = { enabled: false };
  let error = "";
  try {
    [report, settings] = await Promise.all([listCooledCaseHistory(auth, { brokerId, decision, days }), getCooledFlowSettings()]);
  } catch (loadError) {
    console.error("Cooled clients history failed:", loadError?.message || loadError);
    error = "Não foi possível carregar o histórico agora (a tabela pode ainda não estar criada).";
  }
  const href = (patch) => {
    const query = new URLSearchParams({ dias: String(days), ...(decision ? { decisao: decision } : {}), ...(brokerId ? { corretor: brokerId } : {}), ...patch });
    for (const [key, value] of [...query.entries()]) if (!value) query.delete(key);
    return `/admin/desempenho/esfriados?${query.toString()}`;
  };
  const pill = (active) => `rounded-full border px-4 py-2 ${active ? "border-brand bg-brand text-white" : "border-brand/20 bg-white text-brand"}`;

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="cooled-clients" />
      <div className="container-page space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-black text-navy">Clientes que esfriaram</h1>
          <p className="max-w-2xl text-sm font-semibold text-muted">
            Clientes com mais de 3 dias sem contato e sem atividade agendada: o motivo escrito pelo corretor e a decisão da gestão.
          </p>
          <p className="text-xs font-bold text-navy">Fluxo {settings.enabled ? "LIGADO" : "DESLIGADO"}</p>
          {canToggle ? <CooledFlowToggle enabled={settings.enabled} /> : null}
          <nav className="flex flex-wrap gap-2 text-xs font-bold" aria-label="Período">
            {PERIODS.map((period) => <Link key={period} href={href({ dias: String(period) })} className={pill(period === days)}>{period} dias</Link>)}
          </nav>
          <nav className="flex flex-wrap gap-2 text-xs font-bold" aria-label="Decisão">
            {DECISIONS.map((item) => <Link key={item.key || "all"} href={href({ decisao: item.key })} className={pill(item.key === decision)}>{item.label}</Link>)}
          </nav>
          {report.brokers.length ? (
            <nav className="flex flex-wrap gap-2 text-xs font-bold" aria-label="Corretor">
              <Link href={href({ corretor: "" })} className={pill(!brokerId)}>Todos os corretores</Link>
              {report.brokers.map((broker) => <Link key={broker.id} href={href({ corretor: broker.id })} className={pill(broker.id === brokerId)}>{broker.name}</Link>)}
            </nav>
          ) : null}
        </header>

        {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : null}
        {!error && !report.items.length ? <p className="rounded-2xl border border-line bg-white p-6 text-sm font-semibold text-muted">Nenhum caso no período.</p> : null}

        <ul className="space-y-3">
          {report.items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-line bg-white p-4 text-sm shadow-soft">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/simulacoes/${item.clientId}`} className="font-black text-brand hover:underline">{item.clientName}</Link>
                <span className="text-xs font-bold text-navy">{outcome(item)}</span>
              </div>
              {item.clientPhone ? <CooledClientPhone phone={item.clientPhone} className="mt-1 text-[13px]" /> : null}
              <p className="mt-1 text-xs font-semibold text-muted">Corretor: {item.brokerName || "—"} · Aberto em {formatDate(item.openedAt)} · Decisor: {item.deciderName || "—"}</p>
              {item.firstReason ? <p className="mt-2 text-ink-2"><b className="text-navy">Motivo ({formatDate(item.firstReasonAt)}):</b> {item.firstReason}</p> : null}
              {item.returnedText ? <p className="mt-1 text-ink-2"><b className="text-navy">Devolvido por {item.returnedByName || "—"} ({formatDate(item.returnedAt)}):</b> {item.returnedText}</p> : null}
              {item.secondReason ? <p className="mt-1 text-ink-2"><b className="text-navy">2ª resposta ({formatDate(item.secondReasonAt)}):</b> {item.secondReason}</p> : null}
              {item.decidedAt ? <p className="mt-1 text-xs font-semibold text-muted">Decidido por {item.decidedByName || "—"} em {formatDate(item.decidedAt)}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
