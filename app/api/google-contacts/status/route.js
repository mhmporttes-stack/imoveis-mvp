import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getGoogleContactsStatusForBroker, getGoogleContactsSyncCounts } from "@/lib/google-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status da PRÓPRIA conexão Google Contacts do corretor logado — nunca
// devolve token nenhum (ver rowToPublicStatus em lib/google-contacts.js).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const brokerId = auth.profile?.id;
  if (!brokerId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });

  try {
    const [status, counts] = await Promise.all([
      getGoogleContactsStatusForBroker(brokerId),
      getGoogleContactsSyncCounts(brokerId)
    ]);
    return NextResponse.json({ ...status, syncCounts: counts });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
