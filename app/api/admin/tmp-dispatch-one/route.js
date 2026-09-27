import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { dispatchBroadcastNow } from "@/lib/whatsapp-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// TEMPORÁRIO — teste ponta a ponta autorizado pelo dono (2026-09-27), remover depois.
// Só dispara o UM broadcast/telefone abaixo (travado no código, não só no parâmetro) — nunca outro.
const SECRET_HASH = "3237c806482289990f67df261af5c37d75b7f3e42ed5363bb3092a926316fcb7";
const ALLOWED_BROADCAST_ID = "57ea7a36-76cf-485e-9aea-d5adccf78fc8";
const ALLOWED_PHONE = "+5514998407380";
const SYSTEM_AUTH = { profile: { id: null, role: "admin", name: "Teste E2E" }, user: null };

export async function GET(request) {
  const secret = new URL(request.url).searchParams.get("secret") || "";
  const suppliedHash = createHash("sha256").update(secret).digest("hex");
  const validSuppliedHash =
    suppliedHash.length === SECRET_HASH.length && timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(SECRET_HASH));
  if (!validSuppliedHash) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = getSupabaseAdminClient();
  const { data: broadcast, error } = await db.from("whatsapp_broadcasts").select("id, status").eq("id", ALLOWED_BROADCAST_ID).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!broadcast) return NextResponse.json({ error: "broadcast não encontrado" }, { status: 404 });

  const { data: messages } = await db.from("whatsapp_broadcast_messages").select("phone_normalized").eq("broadcast_id", ALLOWED_BROADCAST_ID);
  const phones = [...new Set((messages || []).map((row) => row.phone_normalized))];
  if (phones.length !== 1 || phones[0] !== ALLOWED_PHONE) {
    return NextResponse.json({ error: "trava de segurança: telefone do broadcast não confere", phones }, { status: 400 });
  }

  const result = await dispatchBroadcastNow(ALLOWED_BROADCAST_ID, SYSTEM_AUTH);
  return NextResponse.json({ ok: true, result });
}
