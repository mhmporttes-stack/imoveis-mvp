import { NextResponse, after } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { prepareHenryAutoTraining, runHenryAutoTrainingRound } from "@/lib/henry-training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // uma rodada completa (8 cenários, até 40 trocas) continua depois do 202 (after)

// Treino automático do Henry (dono, 2026-10-25 — docs/BUSINESS_RULES.md HENRY-1 "Modo treino"). Mesma autenticação das
// rotas de cron (CRON_SECRET ou hash do token do vault; falha fechada). Responde 202 { ok, roundId } logo e roda a rodada
// depois (pg_net tem timeout curto). Nunca devolve falas/dados: o resultado fica em "Treinos anteriores" (selo automático).
// Recusa 409 se o teto de gasto (HENRY_AUTO_TRAINING_BUDGET_USD, padrão 1,8 ≈ R$ 10) já foi atingido ou se outra rodada
// automática está rodando.
export async function GET(request) {
  const secret = process.env.CRON_SECRET || "";
  const hash = process.env.SUPABASE_CRON_TOKEN_HASH || "";
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const suppliedHash = createHash("sha256").update(token).digest("hex");
  const validVaultToken = hash.length === suppliedHash.length && timingSafeEqual(Buffer.from(hash), Buffer.from(suppliedHash));
  if ((!secret || authorization !== `Bearer ${secret}`) && !validVaultToken) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const run = await prepareHenryAutoTraining();
    after(() => runHenryAutoTrainingRound(run));
    return NextResponse.json({ ok: true, roundId: run.roundId }, { status: 202 });
  } catch (error) {
    console.warn(`[henry] treino automático recusado: ${error?.status ? error.message : error?.message || "erro"}.`);
    return NextResponse.json({ error: error?.status ? error.message : "Não consegui iniciar o treino automático." }, { status: error?.status || 500 });
  }
}
