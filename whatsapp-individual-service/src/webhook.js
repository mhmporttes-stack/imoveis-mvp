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
      return null;
    }
    return await response.json().catch(() => null);
  } catch (error) {
    // Best-effort: nunca derruba a sessão do WhatsApp por causa de uma falha
    // de rede ao notificar o CRM — a mensagem já está confirmada no WhatsApp.
    console.error(`Falha ao notificar o CRM (${body.type}):`, error.message);
  }
}

// Evento completo do Chat (2026-10-02) — mesmo type:'message' (compatível com
// o CRM antigo, que lê from/text), mais `kind` (message|reaction|edit|revoke)
// e os campos de mídia, citação, reação e edição (ver message-extract.js).
export function notifyChatEvent(userId, event) {
  return post({ userId, type: "message", ...event });
}

// Mensagem de GRUPO (2026-10-11): evento próprio — o CRM guarda só para a aba "Grupos" do dono, nunca como cliente.
// Resposta { ignored: true } = grupo removido do Chat pelo dono (o serviço para de baixar mídia dele).
export function notifyGroupEvent(userId, event) {
  return post({ userId, type: "group_message", ...event });
}

// Mensagem que o corretor mandou PELO CELULAR para um contato novo chega endereçada por LID, sem telefone (2026-10-10,
// caso Anderson/Bencke). Pergunta ao CRM quais telefones são candidatos (clientes recentes desse corretor); o serviço
// confere cada um no WhatsApp (onWhatsApp devolve o LID) e aprende o par LID -> telefone.
export async function requestLidCandidates(userId, lid) {
  const result = await post({ userId, type: "lid_candidates", lid });
  return Array.isArray(result?.phones) ? result.phones.map((phone) => String(phone || "").replace(/\D/g, "")).filter(Boolean).slice(0, 40) : [];
}

// Telemetria JÁ GRAVADA deste número na última janela (tentativas, conexões, quedas): base do limite de tentativas depois
// de um 403 (reconnect-policy.js, dono 2026-10-13) — o serviço reinicia, o banco não. null = CRM não respondeu com a lista
// (fora do ar, ou versão antiga sem este tipo): quem chama decide (connect-limit.js segue e avisa no log).
export async function requestConnectEvents(userId, windowMs) {
  const result = await post({ userId, type: "connect_events", windowMs });
  return Array.isArray(result?.events) ? result.events : null;
}

// Telefone de um LID que já tinha conversa "Número não identificado" no CRM: o CRM junta as duas conversas.
export function notifyLidResolved(userId, lid, phone) {
  return post({ userId, type: "lid_resolved", lid, phone });
}

// Lote do histórico sincronizado ao conectar (ver sessions.js: onHistorySync).
export function notifyHistoryBatch(userId, items) {
  return post({ userId, type: "history", items });
}

// pairingCode precisa ir junto (2026-10-02): sem ele o CRM nunca gravava o
// código e a tela, ao reler o status ~1s depois, apagava o código exibido.
export function notifyStatus(userId, { status, qr, phoneNumber, error, pairingCode, statusCode, output }) {
  return post({ userId, type: "status", status, qr, phoneNumber, error, pairingCode, statusCode, output });
}

// Telemetria de conexão em lote (ver telemetry.js) — rota própria, mesmo segredo.
// Best-effort: falha só vai para o log, nunca derruba a sessão.
export async function notifyTelemetry(events) {
  const baseUrl = String(process.env.APP_WEBHOOK_URL || "").replace(/\/+$/, "");
  const secret = process.env.WHATSAPP_INDIVIDUAL_SERVICE_SECRET || "";
  if (!baseUrl || !secret || !events?.length) return;
  try {
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp-individual/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Secret": secret },
      body: JSON.stringify({ events })
    });
    if (!response.ok) console.error(`Telemetria de sessão recusada pelo CRM (HTTP ${response.status}).`);
  } catch (error) {
    console.error("Falha ao enviar telemetria ao CRM:", error.message);
  }
}

// Confirmação de entrega ("delivered") ou leitura ("read") de uma mensagem
// que o corretor mandou — as setinhas do WhatsApp (ver sessions.js: onMessagesUpdate).
export function notifyMessageStatus(userId, { waMessageId, status }) {
  return post({ userId, type: "message_status", waMessageId, status });
}
