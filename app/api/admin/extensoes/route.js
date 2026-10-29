import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { getExtensionsOverview, saveExtensionConfig, setExtensionsStopped } from "@/lib/browser-extensions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Tela Extensões (EXT-1, dono, 2026-10-29): só o administrador geral REAL — requireRealGeneralAdminApi confere a conta
// logada, ignorando o "Alterar conta".
function fail(error, fallback) {
  if (error?.status) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[extensoes]", fallback, error?.message || error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

async function guard(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  return { auth };
}

export async function GET(request) {
  const { response } = await guard(request);
  if (response) return response;
  try {
    return NextResponse.json(await getExtensionsOverview());
  } catch (error) {
    return fail(error, "Não foi possível carregar as extensões.");
  }
}

// { ext, config } — grava a configuração (faixas fechadas no servidor).
export async function PUT(request) {
  const { auth, response } = await guard(request);
  if (response) return response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  try {
    return NextResponse.json({ config: await saveExtensionConfig(String(body.ext || ""), body.config || {}, auth) });
  } catch (error) {
    return fail(error, "Não foi possível salvar a configuração.");
  }
}

// { action: "stop" | "resume" } — "Parar tudo" / "Retomar".
export async function POST(request) {
  const { auth, response } = await guard(request);
  if (response) return response;
  const body = await request.json().catch(() => null);
  const action = String(body?.action || "");
  if (action !== "stop" && action !== "resume") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  try {
    return NextResponse.json({ control: await setExtensionsStopped(action === "stop", auth) });
  } catch (error) {
    return fail(error, "Não foi possível mudar o estado das extensões.");
  }
}
