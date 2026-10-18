import { readFile } from "node:fs/promises";
import path from "node:path";
import { compareStrategy, parseStrategyChoices } from "@/lib/payment-strategy-core.mjs";
import { generatePaymentStrategyPdf, strategyPdfFileName } from "@/lib/payment-strategy-pdf.mjs";
import { presentationStrategy } from "../../_fixtures/apresentacao";

// PDF da "Estratégia de pagamento" de DESENVOLVIMENTO (dados fictícios, sem banco): POST /dev/vitrine/apresentacao/estrategia?v=<variante>
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const variant = String(request.nextUrl.searchParams.get("v") || "completo");
  const body = await request.json().catch(() => ({}));
  const choices = parseStrategyChoices(body?.escolhas);
  const base = presentationStrategy(variant);
  const comparison = compareStrategy(base, choices);
  if (!choices || !comparison) return Response.json({ error: "Confira os valores informados." }, { status: 400 });
  const logoBytes = await readFile(path.join(process.cwd(), "public", "assets", "matheus-machado-symbol.png"));
  const bytes = await generatePaymentStrategyPdf({ base, choices, comparison, firstName: "Mariana", dateText: "18/10/2026", logoBytes });
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${strategyPdfFileName("Mariana")}"` } });
}
