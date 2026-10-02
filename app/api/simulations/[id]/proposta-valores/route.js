import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getProperty } from "@/lib/properties";
import { canManageSimulations, formatSimulationError, getSimulation } from "@/lib/simulations";
import { simularEntrada } from "@/lib/simulacao-entrada/calculator";
import { clienteEntradaFromSimulation, parcelasFinanciamentoFromSimulation } from "@/lib/simulacao-entrada/cliente-entrada";
import { aplicarParcelasManuais, buildPresentationModel } from "@/lib/simulacao-entrada/presentation-model.mjs";
import { gerarPropostaValoresPdf, sanitizeFileName } from "@/lib/simulacao-entrada/proposta-pdf.mjs";
import { canManageEmpreendimentoRegras, getEmpreendimentoRegras } from "@/lib/simulacao-entrada/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF "Proposta de Valores" de UM empreendimento para o cliente de UMA simulação.
 * Mesmo guard e mesmo escopo das demais rotas de simulação (`getSimulation(id, auth)` valida
 * se o usuário pode ver aquela simulação). Todo o cálculo vem do motor + modelo compartilhado.
 */
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!canManageSimulations() || !canManageEmpreendimentoRegras()) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie dados válidos." }, { status: 400 });
  }
  const propertyId = typeof payload?.propertyId === "string" ? payload.propertyId : "";
  if (!propertyId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }
  const atoManual = Math.max(0, Number(payload?.atoManual) || 0);
  const parcelasManuais = Math.max(0, Math.floor(Number(payload?.parcelasManuais) || 0));

  try {
    const simulation = await getSimulation((await params).id, auth);
    if (!simulation) {
      return NextResponse.json({ error: "Simulação não encontrada." }, { status: 404 });
    }
    const [row, property] = await Promise.all([getEmpreendimentoRegras(propertyId), getProperty(propertyId)]);
    if (!row || row.ativo === false || !row.regras || !property) {
      return NextResponse.json({ error: "Este empreendimento não possui regras de entrada." }, { status: 404 });
    }

    const resultado = simularEntrada(
      clienteEntradaFromSimulation(simulation),
      aplicarParcelasManuais(row.regras, parcelasManuais),
      { atoDesejado: atoManual }
    );
    const model = buildPresentationModel(resultado, {
      financingInstallments: parcelasFinanciamentoFromSimulation(simulation),
      propertyFeatures: property.features || []
    });

    let logoBytes = null;
    try {
      logoBytes = await readFile(path.join(process.cwd(), "public", "assets", "matheus-machado-symbol.png"));
    } catch {
      // Em produção (Vercel) o arquivo estático pode não estar no bundle da função: busca pelo próprio site.
      try {
        const logoResponse = await fetch(new URL("/assets/matheus-machado-symbol.png", request.url));
        logoBytes = logoResponse.ok ? Buffer.from(await logoResponse.arrayBuffer()) : null;
      } catch {
        logoBytes = null;
      }
    }

    const dataTexto = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
    const { bytes } = await gerarPropostaValoresPdf({
      model,
      clienteNome: simulation.clientName || "Cliente",
      dataTexto,
      empreendimento: { nome: property.name || row.nome, construtora: property.builder || "", localizacao: property.location || "" },
      logoBytes
    });

    const fileName = `proposta-${sanitizeFileName(simulation.clientName) || "cliente"}-${sanitizeFileName(property.name) || "empreendimento"}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("Falha ao gerar Proposta de Valores:", error?.message || error);
    return NextResponse.json({ error: formatSimulationError(error) }, { status: 400 });
  }
}
