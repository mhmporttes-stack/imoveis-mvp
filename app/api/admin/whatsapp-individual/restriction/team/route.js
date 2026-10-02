import { NextResponse } from "next/server";
import { isGeneralAdmin, requireBrokerManagementApi } from "@/lib/admin-auth";
import { resolveTeamVisibilityScope } from "@/lib/admin-profiles";
import { listAllOpenRestrictions, listOpenRestrictions } from "@/lib/whatsapp-restriction";
import { canValidateRestriction } from "@/lib/whatsapp-restriction-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Restrições ABERTAS do escopo de quem consulta (admin geral: todas; gestora:
// a própria equipe) + se ele pode validar cada uma. Só leitura.
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const scope = resolveTeamVisibilityScope(auth);
    const open = scope.admin ? await listAllOpenRestrictions() : await listOpenRestrictions(scope.ids || []);
    const actor = { actorId: auth.profile?.id, actorRole: auth.profile?.role, isGeneralAdmin: isGeneralAdmin(auth), managedUserIds: auth.profile?.managedUserIds || [] };
    const restrictions = {};
    for (const [userId, row] of open) {
      restrictions[userId] = {
        validationStatus: row.validation_status || "informed",
        reportedAt: row.reported_at,
        validatedAt: row.validated_at || null,
        validationOrigin: row.validation_origin || null,
        canValidate: canValidateRestriction({ ...actor, targetUserId: userId })
      };
    }
    return NextResponse.json({ restrictions });
  } catch (error) {
    console.error("Falha ao listar as restrições do WhatsApp:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler as restrições." }, { status: 500 });
  }
}
