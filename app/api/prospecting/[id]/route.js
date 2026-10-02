import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recordAdminGrace } from "@/lib/admin-presence";
import { deleteProspectingContact, getProspectingHistory, updateProspectingContact } from "@/lib/prospecting";
import { enqueueExtraProspectingDispatch } from "@/lib/prospecting-extra-dispatch";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await getProspectingHistory((await params).id, auth)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}

// "Disparar" (2026-10-02): substitui o antigo botão WhatsApp da Prospecção —
// não abre o WhatsApp nem envia na hora; põe o cliente na fila de disparo do
// corretor (lib/prospecting-extra-dispatch.js). Meta 100%, limite de 10 e
// cooldown são validados no servidor.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await enqueueExtraProspectingDispatch((await params).id, auth);
    // Clique na Prospecção = atividade real no CRM (ROL-2b).
    await recordAdminGrace(auth);
    return NextResponse.json(result);
  }
  catch (error) { return NextResponse.json({ error: error.message, status: error.availability || undefined }, { status: error?.status || 409 }); }
}
export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await updateProspectingContact((await params).id, await request.json(), auth)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { await deleteProspectingContact((await params).id, auth); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
