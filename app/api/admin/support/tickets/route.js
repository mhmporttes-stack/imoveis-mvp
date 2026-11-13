import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createSupportTicket, listOwnSupportTickets } from "@/lib/support-tickets";
import { TICKET_MAX_IMAGES } from "@/lib/support-tickets-core.mjs";
import { supportErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ajuda e chamados (dono, 2026-11-13). Qualquer perfil logado cria e lista os PRÓPRIOS chamados (requireAdminApi); a fila
// de todos é só do dono, em ../queue.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ tickets: await listOwnSupportTickets(auth) });
  } catch (error) {
    return supportErrorResponse(error, "Não consegui carregar seus chamados.");
  }
}

// multipart: description, context (JSON do navegador: pathname, title, userAgent, viewport, errors), images (até 3).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Envio inválido." }, { status: 400 });
    let client = {};
    try {
      client = JSON.parse(String(form.get("context") || "{}")) || {};
    } catch {
      client = {};
    }
    const entries = form.getAll("images").filter((item) => item && typeof item === "object" && typeof item.arrayBuffer === "function");
    if (entries.length > TICKET_MAX_IMAGES) return NextResponse.json({ error: `Anexe no máximo ${TICKET_MAX_IMAGES} imagens.` }, { status: 400 });
    const files = await Promise.all(entries.map(async (file) => ({ bytes: new Uint8Array(await file.arrayBuffer()), type: file.type })));
    const ticket = await createSupportTicket(auth, { description: form.get("description"), client, files });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return supportErrorResponse(error, "Não consegui enviar o chamado agora.");
  }
}
