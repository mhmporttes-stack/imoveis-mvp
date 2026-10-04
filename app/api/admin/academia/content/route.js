import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { assertCanManage, resolveManagementActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, getAcademyContent } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_KEYS = ["trackId", "fromVersionId", "versionId", "moduleId", "lessonId", "activityId", "toModuleId", "parentId"];
const ACTIONS = [
  "createDraft", "discardDraft", "publish", "addModule", "updateModule", "deleteModule", "addLesson", "updateLesson", "deleteLesson",
  "moveLesson", "setQuestion", "removeQuestion", "addActivity", "updateActivity", "deleteActivity", "reorder"
];
const bodySchema = z.object({ action: z.enum(ACTIONS) }).passthrough();

// Lista as trilhas com versões e histórico (Admin e Gerente — ACA-1). Conteúdo é global (sem escopo por equipe).
export async function GET(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const content = getAcademyContent();
    if (!content) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json({ tracks: await content.listTracks() });
  } catch (error) {
    return academyErrorResponse(error);
  }
}

// Uma ação de gestão por chamada (criar rascunho, editar, reordenar, publicar...). Edição só em rascunho; em
// "Alterar conta" a gestão é somente leitura (403).
export async function POST(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ação inválida.", code: "invalid_action" }, { status: 400 });
  const { action, ...input } = parsed.data;
  for (const key of ID_KEYS) {
    if (input[key] != null && !(typeof input[key] === "string" && UUID.test(input[key]))) {
      return NextResponse.json({ error: "Identificador inválido.", code: "invalid_action" }, { status: 400 });
    }
  }
  if (input.orderedIds != null && !(Array.isArray(input.orderedIds) && input.orderedIds.every((id) => typeof id === "string" && UUID.test(id)))) {
    return NextResponse.json({ error: "Ordem inválida.", code: "invalid_order" }, { status: 400 });
  }
  try {
    const actor = assertCanManage(resolveManagementActor(auth));
    const content = getAcademyContent();
    if (!content) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json({ ok: true, result: await content.run(actor, action, input) });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
