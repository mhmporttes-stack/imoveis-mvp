import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { handleSkillRequestV2 } from "@/lib/alexa-v2/router.mjs";
import { makeBrokerMatcher } from "@/lib/alexa-v2/brokers.mjs";
import { getV2Providers } from "@/lib/alexa-v2/providers";
import { loadBrokerList } from "@/lib/crm-metrics/team-goal";
import { saoPauloDateKey } from "@/lib/alexa-config-core.mjs";

// TEMPORÁRIA (Alexa V2): roda o roteador V2 com os provedores REAIS a partir
// de um envelope simulado (intenção + slots em texto/id + atributos de
// sessão). Só administrador geral. Não passa pela Amazon.
//   POST { intent, slots: { assunto: "meta_bateram", periodo: "ontem", ... }, attributes }
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function toSlot(name, value) {
  if (!value) return undefined;
  // "id:xxx" simula um slot resolvido pelo modelo; texto puro simula fala não resolvida.
  if (String(value).startsWith("id:")) {
    const id = String(value).slice(3);
    return { name, value: id, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: id } }] }] } };
  }
  return { name, value };
}

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const slots = {};
  for (const [name, value] of Object.entries(body.slots || {})) {
    const slot = toSlot(name, value);
    if (slot) slots[name] = slot;
  }
  const envelope = {
    session: { new: false, application: { applicationId: "teste" }, user: { userId: "teste" }, attributes: body.attributes || {} },
    request: { type: "IntentRequest", intent: { name: body.intent, slots } }
  };

  const started = Date.now();
  const brokers = makeBrokerMatcher(await loadBrokerList().catch(() => []));
  const result = await handleSkillRequestV2(envelope, {
    legacyDeps: {},
    providers: getV2Providers(),
    brokers,
    today: () => saoPauloDateKey(),
    onProviderError: (topic, error) => console.warn(`[tmp-alexa-ask] provedor ${topic}: ${error?.message || "erro"}`)
  });

  return NextResponse.json({
    ms: Date.now() - started,
    text: result?.response?.outputSpeech?.text || "",
    attributes: result?.sessionAttributes || {},
    end: result?.response?.shouldEndSession
  });
}
