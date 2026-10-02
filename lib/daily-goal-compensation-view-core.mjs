// Texto/estado EXIBIDO ao corretor sobre a compensação da janela da Meta Diária (PRO-14). Função PURA e
// somente de apresentação: nenhuma regra nem cálculo novo — recebe números já calculados por
// lib/daily-goal-window-core.mjs e decide o que mostrar. Testes: tests/daily-goal-compensation-view.test.mjs.
//
// Mostra algo SÓ com restrição VALIDADA (aberta, ou crédito já gerado hoje por uma validada). Conectado
// normal, desconectado comum e restrição apenas INFORMADA -> null (a tela mantém os avisos de hoje).

export const RESTRICTED_MANUAL_MESSAGE = "WhatsApp restringido. Meta Diária disponível em modo manual.";
export const IMPACTED_MESSAGE = "Dia impactado por restrição. Sem penalidade da Meta Diária neste dia.";
export const MANUAL_PROSPECTING_MESSAGE = "Prospecção manual liberada";

export function formatClock(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

// 120 -> "2h", 90 -> "1h30", 45 -> "45 min"
export function formatCredit(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

// -> null | { restrictedManual, normalWindow, extended: {untilLabel, creditLabel}|null, impacted, manualProspecting, items }
// items: lista ordenada de { key, tone: "info"|"ok"|"warn", text } para a tela renderizar com ícone + texto.
export function buildCompensationNotice({
  restrictionStatus = null,   // status da restrição ABERTA: "validated" | "informed" | null
  sessionConnected = false,
  baseStartMinutes = null,
  baseEndMinutes = null,
  creditMinutes = 0,
  effectiveEndMinutes = null,
  impacted = false,
  goalComplete = false
} = {}) {
  const openValidated = restrictionStatus === "validated" && !sessionConnected;
  const credit = Math.max(0, Number(creditMinutes) || 0);
  if (!openValidated && credit <= 0 && !impacted) return null;

  const items = [];
  const hasBase = Number.isFinite(baseStartMinutes) && Number.isFinite(baseEndMinutes);
  if (hasBase) items.push({ key: "window", tone: "info", text: `Horário normal: ${formatClock(baseStartMinutes)} às ${formatClock(baseEndMinutes)}` });

  const extended = credit > 0 && Number.isFinite(effectiveEndMinutes) && effectiveEndMinutes > baseEndMinutes
    ? { untilLabel: formatClock(effectiveEndMinutes), creditLabel: formatCredit(credit) }
    : null;
  if (credit > 0) {
    items.push({ key: "credit", tone: "ok", text: `+${formatCredit(credit)} por restrição validada` });
    if (extended) items.push({ key: "until", tone: "ok", text: `Prazo estendido até ${extended.untilLabel}` });
  }
  if (impacted) items.push({ key: "impacted", tone: "warn", text: IMPACTED_MESSAGE });
  if (openValidated) items.push({ key: "manual", tone: "warn", text: RESTRICTED_MANUAL_MESSAGE });
  const manualProspecting = openValidated && Boolean(goalComplete);
  if (manualProspecting) items.push({ key: "prospecting", tone: "ok", text: MANUAL_PROSPECTING_MESSAGE });

  return { restrictedManual: openValidated, normalWindow: hasBase, extended, impacted: Boolean(impacted), manualProspecting, items };
}
