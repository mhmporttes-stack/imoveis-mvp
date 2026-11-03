import { NextResponse } from "next/server";
import { requirePerformanceApi } from "@/lib/admin-auth";
import { clientIpFromHeaders } from "@/lib/office-presence-core.mjs";
import { buildSmsVcards } from "@/lib/sms-batch-core.mjs";
import { saveSmsContactsToGoogle } from "@/lib/sms-google-contacts";
import { addSmsExtraBatch, assertSmsBatchOffice, resetSmsList, loadSmsBatch, markSmsOptOut, markSmsInvalid, markSmsSecondSent, markSmsSent, saveSmsBatchSettings, undoSmsSent } from "@/lib/sms-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A checagem de WhatsApp espaça as consultas (1–2 s cada, até ~16 s por rodada) além da varredura da base.
export const maxDuration = 60;

// Lote de SMS (dono, 2026-11-02): admin geral/gestor (lote da equipe) e corretor (lote próprio). Associado não entra
// (requirePerformanceApi). O escopo de cada leitura/ação é revalidado em lib/sms-batch.js (scopeOf). GET = lista do dia
// (`?broker=<id>|team` filtra os resultados por lote, só equipe; `?preset=today|yesterday|last7|last30|custom&from=&to=`
// filtra o período, validado no servidor); POST = ação.
// PRO-18e: o corretor só usa o lote no Wi-Fi da imobiliária (assertSmsBatchOffice, a cada requisição; 403 SMS_BATCH_OFFICE_ONLY).
function failure(error) {
  const status = Number(error?.status) >= 400 ? Number(error.status) : 500;
  if (status === 500) console.error("Lote de SMS falhou:", error?.message || error);
  return NextResponse.json({ error: status === 500 ? "Não foi possível concluir agora." : error?.message || "Não foi possível concluir.", ...(status !== 500 && error?.code ? { code: error.code } : {}) }, { status });
}

export async function GET(request) {
  const auth = await requirePerformanceApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    await assertSmsBatchOffice(auth, clientIpFromHeaders(request.headers), "load");
    const params = new URL(request.url).searchParams;
    // Salvar os contatos da lista no iPhone (.vcf com "Nome (SMS lote)"): mesmo escopo e mesma regra do Wi-Fi da lista.
    if (params.get("vcard") === "1") {
      const data = await loadSmsBatch(auth, { includePhones: true });
      return new Response(buildSmsVcards(data.items), { headers: { "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": 'inline; filename="lote-sms.vcf"', "Cache-Control": "no-store" } });
    }
    const brokerId = params.get("broker") || "";
    return NextResponse.json(await loadSmsBatch(auth, {
      brokerId: brokerId === "team" || /^[0-9a-f-]{36}$/i.test(brokerId) ? brokerId : "",
      period: { preset: params.get("preset") || "", from: params.get("from") || "", to: params.get("to") || "" }
    }));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request) {
  const auth = await requirePerformanceApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const office = await assertSmsBatchOffice(auth, clientIpFromHeaders(request.headers), String(body.action || ""));
    if (body.action === "sent") return NextResponse.json(await markSmsSent(body.contactId, auth, { outsideOffice: office.recordOnly }));
    if (body.action === "sent-2") return NextResponse.json(await markSmsSecondSent(body.sendId, auth));
    if (body.action === "undo") return NextResponse.json(await undoSmsSent(body.sendId, auth));
    // PRO-18g: cria no Google Contatos do dono a lista ATUAL (nome + celular só servidor -> Google). Mesmo escopo e mesma regra do Wi-Fi.
    if (body.action === "save-google-contacts") {
      const data = await loadSmsBatch(auth, { includePhones: true });
      return NextResponse.json(await saveSmsContactsToGoogle(data.items));
    }
    if (body.action === "reset-list") return NextResponse.json(await resetSmsList(auth));
    if (body.action === "more") return NextResponse.json(await addSmsExtraBatch(auth));
    if (body.action === "invalid") return NextResponse.json(await markSmsInvalid(body.sendId, auth, body.reason === "inactive" ? "inactive" : "nonexistent"));
    if (body.action === "opt-out") return NextResponse.json(await markSmsOptOut(body.sendId, auth));
    if (body.action === "settings") return NextResponse.json(await saveSmsBatchSettings({ template: body.template, template2: body.template2, templateBroker: body.templateBroker, limit: body.limit }, auth));
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
