import "server-only";
import { getSiteBaseUrl } from "./admin-profiles";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendAdminUserInvitation(user) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.RESEND_FROM_EMAIL || "";
  if (!apiKey || !from || !user?.email) return { skipped: true };

  const appUrl = `${getSiteBaseUrl()}/admin/login`;
  const payload = {
    from,
    to: user.email,
    subject: "Acesse o aplicativo Painel Matheus",
    html: buildHtml(user, appUrl),
    text: buildText(user, appUrl)
  };

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha ao enviar convite do aplicativo (${response.status}). ${detail}`.trim());
  }

  return { skipped: false };
}

function buildHtml(user, appUrl) {
  return `
    <div style="margin:0;background:#f3f7fb;padding:32px;font-family:Arial,sans-serif;color:#0d2b4f;">
      <div style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #dfe8f2;border-radius:24px;background:#ffffff;">
        <div style="padding:28px 30px;background:#0D3B66;color:#ffffff;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#9dccff;">Painel Matheus</p>
          <h1 style="margin:0;font-size:28px;line-height:1.2;">Seu acesso foi criado</h1>
        </div>
        <div style="padding:28px 30px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#49627d;">Olá, ${escapeHtml(user.name)}. Seu usuário já está disponível.</p>
          <a href="${appUrl}" style="display:inline-block;border-radius:999px;background:#0D3B66;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:800;">Abrir e instalar o aplicativo</a>
          <div style="margin-top:24px;padding:18px;border-radius:16px;background:#f3f7fb;color:#49627d;font-size:14px;line-height:1.6;">
            <strong style="color:#0d2b4f;">No iPhone:</strong> abra o link no Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.<br />
            <strong style="color:#0d2b4f;">No Android:</strong> abra o link no Chrome, toque no menu e depois em Instalar aplicativo ou Adicionar à tela inicial.
          </div>
        </div>
      </div>
    </div>`;
}

function buildText(user, appUrl) {
  return [
    `Olá, ${user.name}. Seu acesso ao Painel Matheus foi criado.`,
    "",
    `Abra o aplicativo: ${appUrl}`,
    "",
    "iPhone: abra no Safari, toque em Compartilhar e em Adicionar à Tela de Início.",
    "Android: abra no Chrome, toque no menu e em Instalar aplicativo ou Adicionar à tela inicial."
  ].join("\n");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
