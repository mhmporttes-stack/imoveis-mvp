import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listMyCooledDecisions } from "@/lib/cooled-clients";
import { cooledErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Caixinha da decisora: só os casos endereçados ao PRÓPRIO usuário (gestora/dono); demais perfis recebem lista vazia.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await listMyCooledDecisions(auth));
  } catch (error) {
    return cooledErrorResponse(error);
  }
}
