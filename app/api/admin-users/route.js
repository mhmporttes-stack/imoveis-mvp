import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import {
  buildBrokerCaptacaoLink,
  buildBrokerSimulationLink,
  createAdminProfile,
  formatBrokerSchemaError,
  listAdminProfiles
} from "@/lib/admin-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
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
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const user = await createAdminProfile(await request.json());
    return NextResponse.json({ user: withLinks(user) }, { status: 201 });
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
