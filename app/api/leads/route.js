import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const leadAttempts = new Map();
const MIN_ATTEMPT_INTERVAL_MS = 60_000;

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

  const spamKey = `${request.headers.get("x-forwarded-for") || "local"}:${phoneDigits}`;
  const now = Date.now();
  const lastAttemptAt = leadAttempts.get(spamKey) || 0;

  if (now - lastAttemptAt < MIN_ATTEMPT_INTERVAL_MS) {
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

  leadAttempts.set(spamKey, now);

  const { error } = await supabase.from("leads").insert({
    name,
    phone,
    source,
    page_url: pageUrl
  });

  if (error) {
    leadAttempts.delete(spamKey);
    return NextResponse.json(
      { error: "Não foi possível salvar seu cadastro agora. Tente novamente." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Cadastro realizado com sucesso. Em breve entraremos em contato."
  });
}

function normalizeText(value = "") {
  return typeof value === "string" ? value.trim() : "";
}
