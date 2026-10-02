import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getIndividualSessionStatusForUser } from "@/lib/whatsapp-individual";
import { endRestrictionIfConnected, getOpenRestriction, reportRestriction, resolveRestriction } from "@/lib/whatsapp-restriction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status operacional "WhatsApp restringido" do usuário LOGADO. Só o próprio
// usuário altera (gestor/admin apenas visualizam nos cards, via Meta Diária).
// Não libera Prospecção/Meta Diária/disparos — isso continua exigindo "connected".
async function currentUserId(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return { error: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  const userId = auth.profile?.id;
  if (!userId) return { error: NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 }) };
  return { userId };
}

export async function GET(request) {
  const who = await currentUserId(request);
  if (who.error) return who.error;
  try {
    await endRestrictionIfConnected(who.userId, await getIndividualSessionStatusForUser(who.userId));
    const open = await getOpenRestriction(who.userId);
    return NextResponse.json({ restricted: Boolean(open), reportedAt: open?.reported_at || null });
  } catch (error) {
    console.error("Falha ao ler a restrição do WhatsApp:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler o status." }, { status: 500 });
  }
}

export async function POST(request) {
  const who = await currentUserId(request);
  if (who.error) return who.error;
  const body = await request.json().catch(() => ({}));
  try {
    let result;
    if (body.action === "report") {
      const sessionStatus = await getIndividualSessionStatusForUser(who.userId);
      result = await reportRestriction({ actorId: who.userId, targetUserId: who.userId, confirmed: body.confirm === true, sessionStatus });
    } else if (body.action === "resolve") {
      result = await resolveRestriction({ actorId: who.userId, targetUserId: who.userId });
    } else {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const open = await getOpenRestriction(who.userId);
    return NextResponse.json({ result: result.result, restricted: Boolean(open), reportedAt: open?.reported_at || null });
  } catch (error) {
    console.error("Falha ao gravar a restrição do WhatsApp:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar." }, { status: 500 });
  }
}
