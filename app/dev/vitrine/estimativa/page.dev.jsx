import SimulationSuccess from "@/components/simulation-form/SimulationSuccess";

// Vitrine DEV da tela final do /simulacao. Só no `next dev`; dados FICTÍCIOS.
// Desde 2026-10-24 (dono, "Ir direto ao WhatsApp") a tela não mostra mais a estimativa: só "Recebemos, <nome>" e o botão
// de reserva. A vitrine NUNCA abre o WhatsApp sozinha (sem `autoOpenWhatsapp`).   ?nome=Maria
export const dynamic = "force-dynamic";

export default async function EstimateVitrine({ searchParams }) {
  const params = await searchParams;
  return (
    <main className="min-h-screen bg-mist px-4 py-8">
      <SimulationSuccess firstName={params?.nome || "Maria"} />
    </main>
  );
}
