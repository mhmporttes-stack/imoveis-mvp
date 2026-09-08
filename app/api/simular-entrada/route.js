import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { simularEntrada } from "@/lib/simulacao-entrada/calculator";
import { canManageEmpreendimentoRegras, getEmpreendimentoRegras } from "@/lib/simulacao-entrada/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Calcula a simulação de entrada (motor mcmv-calculator) para uma lista de
 * empreendimentos, sem nunca devolver a configuração `regras` (limites,
 * tabela de condições) ao navegador — só o resultado numérico.
 */
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageEmpreendimentoRegras()) {
    return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie dados validos." }, { status: 400 });
  }

  const cliente = normalizeCliente(payload?.cliente);
  const propertyIds = Array.isArray(payload?.propertyIds) ? payload.propertyIds.filter(Boolean) : [];

  const resultados = [];
  for (const propertyId of propertyIds) {
    try {
      const row = await getEmpreendimentoRegras(propertyId);
      if (!row || row.ativo === false || !row.regras) continue;
      resultados.push({
        ...simularEntrada(cliente, row.regras),
        clienteSnapshot: cliente,
        regrasAtualizadasEm: row.atualizado_em || row.regras.atualizadoEm || "",
        calculadoEm: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Falha ao simular entrada para ${propertyId}:`, error?.message || error);
    }
  }

  return NextResponse.json({ resultados });
}

function normalizeCliente(input = {}) {
  return {
    rendaTotal: num(input.rendaTotal),
    financiamentoAprovado: num(input.financiamentoAprovado),
    subsidioMcmv: num(input.subsidioMcmv),
    casaPaulista: num(input.casaPaulista),
    parcelaFinanciamento: num(input.parcelaFinanciamento),
    fgtsDisponivel: num(input.fgtsDisponivel),
    temDependente: Boolean(input.temDependente),
    fgtsMaisDe3Anos: Boolean(input.fgtsMaisDe3Anos),
    tipoRenda: typeof input.tipoRenda === "string" ? input.tipoRenda : ""
  };
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
