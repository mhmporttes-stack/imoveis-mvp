// Avisa o CRM (Next.js) de mensagem nova ou mudança de status/QR — mesmo
// endpoint (/api/webhooks/whatsapp-individual) pros dois tipos, autenticado
// pelo MESMO segredo compartilhado usado no sentido contrário
// (Next.js -> este serviço), WHATSAPP_INDIVIDUAL_SERVICE_SECRET.
async function post(body) {
  const baseUrl = String(process.env.APP_WEBHOOK_URL || "").replace(/\/+$/, "");
  const secret = process.env.WHATSAPP_INDIVIDUAL_SERVICE_SECRET || "";
  if (!baseUrl || !secret) {
    console.warn("APP_WEBHOOK_URL/WHATSAPP_INDIVIDUAL_SERVICE_SECRET não configurados — evento não notificado ao CRM:", body.type);
    return;
  }
  try {
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp-individual`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Secret": secret },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`Webhook do CRM respondeu ${response.status} para ${body.type}:`, text.slice(0, 300));
    }
  } catch (error) {
    // Best-effort: nunca derruba a sessão do WhatsApp por causa de uma falha
    // de rede ao notificar o CRM — a mensagem já está confirmada no WhatsApp.
    console.error(`Falha ao notificar o CRM (${body.type}):`, error.message);
  }
}

export function notifyMessage(userId, { from, text, waMessageId, at, contactName, fromMe }) {
  return post({ userId, type: "message", from, text, waMessageId, at, contactName, fromMe });
}

// Lote do histórico sincronizado ao conectar (ver sessions.js: onHistorySync).
export function notifyHistoryBatch(userId, items) {
  return post({ userId, type: "history", items });
}

export function notifyStatus(userId, { status, qr, phoneNumber, error }) {
  return post({ userId, type: "status", status, qr, phoneNumber, error });
}
