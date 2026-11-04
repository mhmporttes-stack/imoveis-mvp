import { NextResponse } from "next/server";
import { clientIpFromHeaders } from "@/lib/office-presence-core.mjs";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";
import { assertSmsBatchOffice, loadSmsBatch, markSmsSecondSent, markSmsSent } from "@/lib/sms-batch";
import { authFromSmsShortcutKey } from "@/lib/sms-shortcut";
import { SMS_SHORTCUT_RATE_LIMIT, shortcutItems, smsShortcutKeyFromHeaders } from "@/lib/sms-shortcut-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Atalho do iPhone do Lote de SMS (dono, 2026-11-04): o Atalho busca a lista do dia (GET) e avisa cada envio (POST), sem cookie de
// sessão. A barreira é a chave pessoal `Authorization: Bearer sms_...` (só o hash no banco) + limite por IP + as MESMAS travas do
// Lote (perfil, Wi-Fi da imobiliária e WhatsApp conectado — assertSmsBatchOffice). Nunca envia SMS: só entrega o texto e registra
// o envio que o próprio iPhone fez. Docs: docs/ATALHO_LOTE_SMS.md.
const NO_STORE = { "Cache-Control": "no-store" };

function failure(error) {
  const status = Number(error?.status) >= 400 ? Number(error.status) : 500;
  if (status === 500) console.error("Atalho do Lote de SMS falhou:", error?.message || error);
  return NextResponse.json({ error: status === 500 ? "Não foi possível concluir agora." : error?.message || "Não foi possível concluir.", ...(status !== 500 && error?.code ? { code: error.code } : {}) }, { status, headers: NO_STORE });
}

async function authorize(request, action) {
  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, "sms-shortcut"), SMS_SHORTCUT_RATE_LIMIT);
  if (!allowed) return { response: NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429, headers: NO_STORE }) };
  const key = smsShortcutKeyFromHeaders(request.headers);
  const auth = key ? await authFromSmsShortcutKey(key) : null;
  if (!auth) return { response: NextResponse.json({ error: "Chave do Atalho inválida. Gere uma nova no Lote de SMS." }, { status: 401, headers: NO_STORE }) };
  const office = await assertSmsBatchOffice(auth, clientIpFromHeaders(request.headers), action);
  return { auth, office };
}

// GET = lista do dia (as vagas de hoje, incluindo o "Carregar mais"): [{ id, name, phone (+55…), text, text2, together }].
export async function GET(request) {
  try {
    const { auth, response } = await authorize(request, "load");
    if (response) return response;
    const data = await loadSmsBatch(auth, { includePhones: true });
    const items = shortcutItems(data.items);
    return NextResponse.json({ ok: true, count: items.length, remaining: data.progress?.remaining ?? items.length, items }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

// POST { contactId } = 1ª enviada (devolve sendId); POST { sendId } = 2ª enviada. Idempotente (repetir o aviso não duplica).
export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const action = body.sendId ? "sent-2" : "sent";
    const { auth, office, response } = await authorize(request, action);
    if (response) return response;
    if (body.sendId) return NextResponse.json({ ok: true, ...(await markSmsSecondSent(body.sendId, auth)) }, { headers: NO_STORE });
    // `go` = "sim" só quando ESTA chamada foi a que registrou a 1ª mensagem. O Atalho registra ANTES de enviar e só envia o SMS
    // se `go` for "sim": registro repetido (outra execução do Atalho, repetição de rede) devolve go vazio e o SMS não sai de novo.
    const result = await markSmsSent(body.contactId, auth, { outsideOffice: office.recordOnly });
    return NextResponse.json({ ok: true, ...result, go: result?.alreadySent ? "" : "sim" }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
