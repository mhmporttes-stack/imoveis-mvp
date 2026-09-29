import { formatDateTimeSaoPaulo } from "./date-utils";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Lead do modal da home (tabela `leads`) nunca avisava ninguém — o cadastro
// ficava salvo sem nenhum leitor no código (P-08 do pente-fino 2026-09-24,
// corrigido 2026-09-29). Mesmo padrão de lib/captacao-notifications.js e
// lib/simulation-registration-notifications.js: best-effort, nunca impede o
// cadastro em si de ser salvo (chamado depois do INSERT, dentro de um
// try/catch que só loga se falhar).
export async function sendLeadNotification(lead) {
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
    subject: `Novo contato pelo site — ${lead.name}`,
    html: buildHtml(lead),
    text: buildText(lead)
  };

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha ao enviar e-mail de novo contato (${response.status}). ${detail}`.trim());
  }

  return { skipped: false };
}

function buildHtml(lead) {
  const rows = [
    ["Nome", lead.name],
    ["WhatsApp", lead.phone],
    ["Origem", "Modal da home"],
    ["Página", lead.pageUrl || "—"],
    ["Recebido em", formatDateTimeSaoPaulo(new Date().toISOString())]
  ];

  return `
    <div style="margin:0;background:#f3f7fb;padding:32px;font-family:Inter,Arial,sans-serif;color:#0d2b4f;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dfe8f2;border-radius:24px;overflow:hidden;">
        <div style="padding:28px 30px;background:#0D3B66;color:#ffffff;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9dccff;">
            Novo contato pelo site
          </p>
          <h1 style="margin:0;font-size:28px;line-height:1.15;">${escapeHtml(lead.name)}</h1>
        </div>
        <div style="padding:28px 30px;">
          <table style="width:100%;border-collapse:collapse;">
            ${rows
              .map(
                ([label, value]) => `
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #edf2f7;width:38%;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#60758d;">${escapeHtml(label)}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #edf2f7;font-size:15px;font-weight:700;color:#0d2b4f;">${escapeHtml(value)}</td>
                  </tr>
                `
              )
              .join("")}
          </table>
        </div>
      </div>
    </div>
  `;
}

function buildText(lead) {
  return [
    `Novo contato pelo site — ${lead.name}`,
    "",
    `Nome: ${lead.name}`,
    `WhatsApp: ${lead.phone}`,
    "Origem: Modal da home",
    `Página: ${lead.pageUrl || "—"}`,
    `Recebido em: ${formatDateTimeSaoPaulo(new Date().toISOString())}`
  ].join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
