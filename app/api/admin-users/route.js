import { NextResponse } from "next/server";
import { isGeneralAdmin, requireBrokerManagementApi } from "@/lib/admin-auth";
import { ADMIN_ROLE } from "@/lib/admin-profiles";
import { sendAdminUserInvitation } from "@/lib/admin-user-invitation";
import {
  buildBrokerCaptacaoLink,
  buildBrokerSimulationLink,
  createAdminProfile,
  formatBrokerSchemaError,
  listAdminProfiles
} from "@/lib/admin-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gestores podem cadastrar/gerenciar corretores e associados, mas nao podem
// criar outros administradores ou gestores (evita escalonamento de privilegio).
const MANAGER_ASSIGNABLE_ROLES = [ADMIN_ROLE.BROKER, ADMIN_ROLE.ASSOCIATE];

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const users = await listAdminProfiles();
    return NextResponse.json({ users: users.map(withLinks) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatBrokerSchemaError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const payload = await request.json();
    if (!isGeneralAdmin(auth) && !MANAGER_ASSIGNABLE_ROLES.includes(payload.role)) {
      return NextResponse.json(
        { error: "Gestores só podem cadastrar corretores ou associados." },
        { status: 403 }
      );
    }

    const user = await createAdminProfile(payload);
    let invitationSent = false;
    let invitationError = "";
    try {
      const invitation = await sendAdminUserInvitation(user);
      invitationSent = !invitation.skipped;
      if (invitation.skipped) invitationError = "Envio de e-mail não configurado.";
    } catch (emailError) {
      console.error("Nao foi possivel enviar o convite do aplicativo.", emailError);
      invitationError = "Usuário criado, mas não foi possível enviar o e-mail do aplicativo.";
    }
    return NextResponse.json({ user: withLinks(user), invitationSent, invitationError }, { status: 201 });
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
