import HenryDemo from "../_components/HenryDemo";

// Vitrine DEV do assistente de voz Henry (HENRY-1). Só no `next dev`; sinal de áudio simulado e conversa fictícia.
//   ?modo=idle|listening|thinking|speaking  ·  ?tela=icone (ícone do canto sobre fundo do painel)
export const dynamic = "force-dynamic";

export default async function HenryVitrine({ searchParams }) {
  const params = await searchParams;
  const mode = ["idle", "listening", "thinking", "speaking"].includes(params?.modo) ? params.modo : "speaking";
  const icon = params?.tela === "icone";
  return (
    <main className={icon ? "min-h-screen bg-mist p-10" : "min-h-screen"}>
      <HenryDemo mode={mode} expanded={!icon} capturing={params?.camera === "1"} />
    </main>
  );
}
