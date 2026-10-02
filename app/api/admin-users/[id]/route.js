import { NextResponse } from "next/server";
import { isGeneralAdmin, requireBrokerManagementApi } from "@/lib/admin-auth";
import {
  ADMIN_ROLE,
  buildBrokerCaptacaoLink,
  buildBrokerSimulationLink,
  deleteAdminProfile,
  formatBrokerSchemaError,
  getAdminProfileById,
  previewBrokerRemoval,
  updateAdminProfile
} from "@/lib/admin-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mesma trava do cadastro: gestor mexe só em corretores/associados, nunca em
// administradores ou outros gestores, e não pode promover ninguém a esses papéis.
const MANAGER_ASSIGNABLE_ROLES = [ADMIN_ROLE.BROKER, ADMIN_ROLE.ASSOCIATE];

// Quem pode excluir: administrador geral (qualquer corretor) ou gestor — este só da PRÓPRIA equipe
// (manager_id = ele). Validado de novo no backend em lib/admin-profiles.js (previewBrokerRemoval/deleteAdminProfile).
function removalActor(auth) {
  return { id: auth.profile?.id || "", role: auth.profile?.role || "", isGeneralAdmin: isGeneralAdmin(auth) };
}

// Pré-visualização da exclusão: clientes por etapa, quem pode receber e a distribuição equilibrada.
export async function GET(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  try {
    const preview = await previewBrokerRemoval(id, { actor: removalActor(auth) });
    return NextResponse.json(preview);
  } catch (error) {
    console.error(error);
    if (error?.status === 403) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Não foi possível contar os clientes." }, { status: 400 });
  }
}

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

// Exclusão é mais sensível que editar/desativar (some com o cadastro). Administrador geral: qualquer
// usuário. Gestor: só corretor/associado da própria equipe. Se o usuário tem clientes, o corpo traz
// `strategy`: "transfer" (+ `transferToUserId`) ou "distribute" (equilibrado entre a equipe).
export async function DELETE(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await deleteAdminProfile(id, {
      transferToUserId: String(body?.transferToUserId || ""),
      strategy: body?.strategy === "distribute" ? "distribute" : "transfer",
      auth,
      actor: removalActor(auth)
    });
    return NextResponse.json({ ok: true, transferred: result.transferred, tagName: result.tagName, strategy: result.strategy, distribution: result.distribution });
  } catch (error) {
    console.error(error);
    if (error?.status === 403) return NextResponse.json({ error: error.message }, { status: 403 });
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
