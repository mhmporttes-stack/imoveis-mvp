import { NextResponse } from "next/server";
import { isGeneralAdmin, requireBrokerManagementApi } from "@/lib/admin-auth";
import {
  ADMIN_ROLE,
  buildBrokerCaptacaoLink,
  buildBrokerSimulationLink,
  formatBrokerSchemaError,
  getAdminProfileById,
  updateAdminProfile
} from "@/lib/admin-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mesma trava do cadastro: gestor mexe só em corretores/associados, nunca em
// administradores ou outros gestores, e não pode promover ninguém a esses papéis.
const MANAGER_ASSIGNABLE_ROLES = [ADMIN_ROLE.BROKER, ADMIN_ROLE.ASSOCIATE];

export async function PATCH(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  try {
    const payload = await request.json();

    if (!isGeneralAdmin(auth)) {
      const target = await getAdminProfileById(id);
      if (!target || !MANAGER_ASSIGNABLE_ROLES.includes(target.role)) {
        return NextResponse.json({ error: "Gestores só podem gerenciar corretores ou associados." }, { status: 403 });
      }
      if ("role" in payload && !MANAGER_ASSIGNABLE_ROLES.includes(payload.role)) {
        return NextResponse.json({ error: "Gestores só podem atribuir o papel de corretor ou associado." }, { status: 403 });
      }
    }

    const user = await updateAdminProfile(id, payload);
    return NextResponse.json({ user: withLinks(user) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatBrokerSchemaError(error) }, { status: 400 });
  }
}

function withLinks(user) {
  return {
    ...user,
    simulationLink: buildBrokerSimulationLink(user),
    captacaoLink: buildBrokerCaptacaoLink(user)
  };
}
