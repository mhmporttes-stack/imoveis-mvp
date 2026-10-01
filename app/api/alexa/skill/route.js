import { NextResponse } from "next/server";
import { answerSkillRequest, getSkillConfig, verifyAmazonRequest } from "@/lib/alexa-skill";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

// Endpoint da skill privada "Central Machado". Só aceita chamadas assinadas
// pela Amazon, da nossa skill e de um usuário Alexa autorizado. Somente leitura.
export async function POST(request) {
  const config = getSkillConfig();
  if (!config.enabled || !config.skillId) return NextResponse.json({ error: "Indisponível." }, { status: 503 });

  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, "alexa-skill"), { windowSeconds: 60, maxAttempts: 60 });
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });

  const rawBody = await request.text();
  try {
    await verifyAmazonRequest(rawBody, Object.fromEntries(request.headers));
  } catch (verifyError) {
    console.warn(`[alexa-skill] assinatura ou horário inválidos: ${String(verifyError?.message || verifyError).slice(0, 200)}`);
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const result = await answerSkillRequest(body);
  return NextResponse.json(result.payload);
}
