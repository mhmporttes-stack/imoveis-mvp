import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";

export function manualErrorResponse(error) {
  const known = error?.name === "ManualError";
  const status = known ? error.status : 500;
  if (!known) console.error("Manual do CRM:", error?.message || error);
  return NextResponse.json({ error: known ? error.message : "Não foi possível concluir." }, { status });
}

export async function readJson(request) {
  try { return (await request.json()) || {}; } catch { return {}; }
}

// Guard ANTES de qualquer dado; perfil efetivo; erro genérico.
export async function manualRoute(request, run, guard = requireAdminApi) {
  const auth = await guard(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await run(auth));
  } catch (error) {
    return manualErrorResponse(error);
  }
}
