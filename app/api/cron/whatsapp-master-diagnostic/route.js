import { NextResponse } from "next/server";
import {
  createWhatsappReminderTemplate,
  listApprovedWhatsappTemplates,
  registerWhatsappMasterPhone,
  sendWhatsappTemplateMessage
} from "@/lib/whatsapp-master";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET || "";
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });

  try {
    const templates = await listApprovedWhatsappTemplates();
    return NextResponse.json({ ok: true, templates });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao consultar modelos." }, { status: 400 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });

  try {
    const payload = await request.json();
    if (payload?.action === "register") {
      const result = await registerWhatsappMasterPhone(process.env.WHATSAPP_REGISTRATION_PIN);
      return NextResponse.json({ ok: true, registered: result.success });
    }
    if (payload?.action === "createReminderTemplate") {
      const result = await createWhatsappReminderTemplate();
      return NextResponse.json({ ok: true, template: result });
    }
    const result = await sendWhatsappTemplateMessage({
      to: payload?.to,
      templateName: payload?.templateName,
      languageCode: payload?.languageCode,
      bodyParameters: Array.isArray(payload?.bodyParameters) ? payload.bodyParameters : []
    });
    return NextResponse.json({ ok: true, messageId: result.messageId, recipient: result.recipient });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao enviar mensagem." }, { status: 400 });
  }
}
