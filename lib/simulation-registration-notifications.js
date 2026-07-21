import {
  booleanLabel,
  calculateFamilyIncome,
  formatCurrency,
  formatDateBR,
  formatDateTimeBR,
  incomeTypeLabel,
  maritalStatusLabel,
  simulationTypeLabel
} from "./simulation-registration-schema";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendSimulationRegistrationNotification(registration) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const to = process.env.SIMULATION_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || "";
  const from = process.env.RESEND_FROM_EMAIL || "";

  const missingConfig = [];
  if (!apiKey) missingConfig.push("RESEND_API_KEY");
  if (!to) missingConfig.push("SIMULATION_NOTIFICATION_EMAIL");
  if (!from) missingConfig.push("RESEND_FROM_EMAIL");

  if (missingConfig.length > 0) {
    return {
      skipped: true,
      reason: `Configuração ausente: ${missingConfig.join(", ")}`
    };
  }

  const payload = {
    from,
    to,
    subject: `Novo cadastro de simulação: ${registration.fullName}`,
    html: buildNotificationHtml(registration),
    text: buildNotificationText(registration)
  };

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha ao enviar e-mail de notificação (${response.status}). ${detail}`.trim());
  }

  return { skipped: false };
}

function buildNotificationHtml(registration) {
  const adminUrl = buildAdminRegistrationUrl(registration.id);
  const familyIncome = calculateFamilyIncome(registration);
  const rows = [
    ["Nome", registration.fullName],
    ["Telefone", registration.phone],
    ["Tipo de simulação", simulationTypeLabel(registration.simulationType)],
    ["Data de nascimento", formatDateBR(registration.oldestBirthDate)],
    ["Tipo de renda", incomeTypeLabel(registration.primaryIncomeType)],
    ["Renda do titular", formatCurrency(registration.primaryMonthlyIncome)],
    ["Renda da segunda pessoa", registration.secondaryMonthlyIncome === null ? "Não se aplica" : formatCurrency(registration.secondaryMonthlyIncome)],
    ["Renda familiar total", formatCurrency(familyIncome)],
    ["Mais de 3 anos de registro", booleanLabel(registration.hasOverThreeYearsRegisteredWork)],
    ["Filhos menores de 18 anos", booleanLabel(registration.hasChildrenUnder18)],
    ["Estado civil", maritalStatusLabel(registration.primaryMaritalStatus)],
    ["Imóvel residencial no nome", booleanLabel(registration.hasResidentialProperty)],
    ["Valor disponível", formatCurrency(registration.availablePurchaseResource)],
    ["Recebido em", formatDateTimeBR(registration.createdAt)]
  ];

  return `
    <div style="margin:0;background:#f3f7fb;padding:32px;font-family:Inter,Arial,sans-serif;color:#0d2b4f;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dfe8f2;border-radius:24px;overflow:hidden;">
        <div style="padding:28px 30px;background:#0D3B66;color:#ffffff;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9dccff;">
            Novo cadastro
          </p>
          <h1 style="margin:0;font-size:28px;line-height:1.15;">Simulação de financiamento</h1>
        </div>
        <div style="padding:28px 30px;">
          <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#49627d;">
            Um cliente concluiu o formulário de simulação pelo site.
          </p>
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
          ${
            adminUrl
              ? `<a href="${adminUrl}" style="display:inline-block;margin-top:26px;background:#0D3B66;color:#ffffff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:800;">Abrir cadastro no painel</a>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function buildNotificationText(registration) {
  const adminUrl = buildAdminRegistrationUrl(registration.id);
  const lines = [
    "Novo cadastro de simulação de financiamento",
    "",
    `Nome: ${registration.fullName}`,
    `Telefone: ${registration.phone}`,
    `Tipo de simulação: ${simulationTypeLabel(registration.simulationType)}`,
    `Data de nascimento: ${formatDateBR(registration.oldestBirthDate)}`,
    `Tipo de renda: ${incomeTypeLabel(registration.primaryIncomeType)}`,
    `Renda do titular: ${formatCurrency(registration.primaryMonthlyIncome)}`,
    `Renda da segunda pessoa: ${registration.secondaryMonthlyIncome === null ? "Não se aplica" : formatCurrency(registration.secondaryMonthlyIncome)}`,
    `Renda familiar total: ${formatCurrency(calculateFamilyIncome(registration))}`,
    `Mais de 3 anos de registro: ${booleanLabel(registration.hasOverThreeYearsRegisteredWork)}`,
    `Filhos menores de 18 anos: ${booleanLabel(registration.hasChildrenUnder18)}`,
    `Estado civil: ${maritalStatusLabel(registration.primaryMaritalStatus)}`,
    `Imóvel residencial no nome: ${booleanLabel(registration.hasResidentialProperty)}`,
    `Valor disponível: ${formatCurrency(registration.availablePurchaseResource)}`,
    `Recebido em: ${formatDateTimeBR(registration.createdAt)}`
  ];

  if (adminUrl) lines.push("", `Abrir no painel: ${adminUrl}`);
  return lines.join("\n");
}

function buildAdminRegistrationUrl(id) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  return baseUrl ? `${baseUrl.replace(/\/$/, "")}/admin/cadastros/${id}` : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
