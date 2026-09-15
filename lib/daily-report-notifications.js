import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { formatPlainDateBR } from "./daily-report";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Reaproveita o crm_settings já usado por outras configurações simples
// (ex.: whatsapp_master) em vez de criar uma tabela nova só para guardar "já
// mandei o relatório de hoje?" — uma linha, um campo.
const DISPATCH_SETTING_ID = "daily_report_dispatch";

// getDailyReport (lib/daily-report.js) já existe e é completo — só faltava
// alguém receber isso automaticamente, sem precisar abrir a tela. Reaproveita
// o mesmo Resend já configurado para a notificação de novo cadastro
// (mesmas variáveis de ambiente), não uma integração de e-mail paralela.
export async function sendDailyReportEmail(report) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const to = process.env.SIMULATION_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || "";
  const from = process.env.RESEND_FROM_EMAIL || "";

  const missingConfig = [];
  if (!apiKey) missingConfig.push("RESEND_API_KEY");
  if (!to) missingConfig.push("SIMULATION_NOTIFICATION_EMAIL");
  if (!from) missingConfig.push("RESEND_FROM_EMAIL");
  if (missingConfig.length > 0) {
    return { skipped: true, reason: `Configuração ausente: ${missingConfig.join(", ")}` };
  }

  const payload = {
    from,
    to,
    subject: `Relatório diário — ${formatPlainDateBR(report.range.startDate)}`,
    html: buildReportHtml(report),
    text: buildReportText(report)
  };

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha ao enviar relatório diário por e-mail (${response.status}). ${detail}`.trim());
  }

  return { skipped: false };
}

// Trava simples contra reenvio no mesmo dia — protege só contra o cron
// externo disparar mais de uma vez no mesmo dia (config duplicada, novo
// disparo manual de teste etc.), nunca contra reenvio deliberado em dias
// diferentes.
export async function wasDailyReportSentOn(plainDate) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("crm_settings").select("setting_value").eq("id", DISPATCH_SETTING_ID).maybeSingle();
  if (error) throw error;
  return data?.setting_value?.lastSentDate === plainDate;
}

export async function markDailyReportSentOn(plainDate) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("crm_settings").upsert({
    id: DISPATCH_SETTING_ID,
    setting_value: { lastSentDate: plainDate },
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

function buildReportHtml(report) {
  const { metrics, funnel, brokerBreakdown } = report;
  const funnelRows = funnel
    .map((stage) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #E5EAF1;">${stage.label}</td><td style="padding:6px 12px;border-bottom:1px solid #E5EAF1;text-align:right;font-weight:700;">${stage.value}</td></tr>`)
    .join("");

  const brokerRows = (brokerBreakdown || [])
    .map((broker) => `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #E5EAF1;">${escapeHtml(broker.brokerName)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E5EAF1;text-align:right;">${broker.metrics?.clientsToday ?? "—"}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E5EAF1;text-align:right;">${broker.metrics?.overdueActivities ?? "—"}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E5EAF1;text-align:right;">${broker.metrics?.completedActivities ?? "—"}</td>
    </tr>`)
    .join("");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0D3B66;max-width:640px;margin:0 auto;">
      <h1 style="font-size:22px;">Relatório diário — ${escapeHtml(report.range.primaryLabel)}</h1>
      <p style="color:#5b6b82;">Gerado automaticamente em ${new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.</p>

      <h2 style="font-size:16px;margin-top:24px;">Funil do dia</h2>
      <table style="width:100%;border-collapse:collapse;">${funnelRows}</table>

      ${brokerRows ? `
      <h2 style="font-size:16px;margin-top:24px;">Por corretor</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="color:#5b6b82;font-size:12px;text-transform:uppercase;">
          <td style="padding:6px 12px;">Corretor</td>
          <td style="padding:6px 12px;text-align:right;">Novos</td>
          <td style="padding:6px 12px;text-align:right;">Atrasadas</td>
          <td style="padding:6px 12px;text-align:right;">Concluídas</td>
        </tr>
        ${brokerRows}
      </table>` : ""}

      <p style="margin-top:24px;color:#5b6b82;font-size:12px;">Novos cadastros: ${metrics.newRegistrations} · Documentação: ${metrics.documentationReceived} · Enviados para aprovação: ${metrics.sentForApproval} · Aprovados: ${metrics.approved}</p>
    </div>
  `;
}

function buildReportText(report) {
  const { metrics, range } = report;
  return `Relatório diário — ${range.primaryLabel}\n\nNovos cadastros: ${metrics.newRegistrations}\nDocumentação: ${metrics.documentationReceived}\nEnviados para aprovação: ${metrics.sentForApproval}\nAprovados: ${metrics.approved}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
