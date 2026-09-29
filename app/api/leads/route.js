import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";
import { sendLeadNotification } from "@/lib/lead-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os dados enviados." }, { status: 400 });
  }

  const name = normalizeText(payload?.name);
  const phone = normalizeText(payload?.phone);
  const phoneDigits = phone.replace(/\D/g, "");
  const pageUrl = normalizeText(payload?.pageUrl || payload?.page_url).slice(0, 500);
  const source = "homepage_modal";

  if (name.length < 3) {
    return NextResponse.json({ error: "Informe seu nome completo." }, { status: 400 });
  }

  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    return NextResponse.json({ error: "Informe um telefone/WhatsApp válido." }, { status: 400 });
  }

  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, phoneDigits), { windowSeconds: 60, maxAttempts: 1 });
  if (!allowed) {
    return NextResponse.json(
      { error: "Aguarde alguns instantes antes de enviar novamente." },
      { status: 429 }
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Cadastro temporariamente indisponível. Tente pelo WhatsApp." },
      { status: 503 }
    );
  }

  const { error } = await supabase.from("leads").insert({
    name,
    phone,
    source,
    page_url: pageUrl
  });

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível salvar seu cadastro agora. Tente novamente." },
      { status: 500 }
    );
  }

  try {
    const notification = await sendLeadNotification({ name, phone, pageUrl });
    if (notification?.skipped) console.warn("Lead notification email skipped:", notification.reason);
  } catch (notificationError) {
    console.warn("Lead notification email failed:", notificationError?.message || notificationError);
  }

  return NextResponse.json({
    ok: true,
    message: "Cadastro realizado com sucesso. Em breve entraremos em contato."
  });
}

function normalizeText(value = "") {
  return typeof value === "string" ? value.trim() : "";
}
