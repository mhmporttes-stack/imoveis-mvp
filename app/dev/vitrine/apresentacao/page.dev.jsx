import PresentationPlayer from "@/components/presentation/PresentationPlayer";
import { presentationBranch, presentationScenes } from "../_fixtures/apresentacao";

// Vitrine DEV da Apresentação interativa da simulação (só existe no `next dev`; *.dev.jsx não entra no build).
// Renderiza o MESMO player com DADOS 100% FICTÍCIOS (../_fixtures/apresentacao.js), sem login e sem banco, e SEM enviar
// métrica (token vazio). Os botões de download apontam para as rotas de imagem DEV desta mesma vitrine.
//   ?v=completo (padrão) | informal | minimo | sem-juros-sem-subsidio | igual | sem-imovel | sem-justificativa | longo
//   ?ramo=N (abre direto no imóvel N do ramo de imóveis sugeridos, 1-based)
//   ?cena=N (começa na cena N, 0-based; cenas finais abrem já liberadas) · use o botão de pausa para parar o auto-avanço.
export const dynamic = "force-dynamic";

export default async function PresentationVitrine({ searchParams }) {
  const query = await searchParams;
  const variant = String(query?.v || "completo");
  const scenes = presentationScenes(variant);
  const ramo = Number(query?.ramo) || 0;
  // ?ramo=N abre direto no imóvel N do ramo (o roteiro principal fica parado em "Próximo passo")
  const initialIndex = ramo ? Math.max(0, scenes.findIndex((scene) => scene.id === "proximo")) : Number(query?.cena) || 0;
  return (
    <PresentationPlayer
      scenes={scenes}
      branch={presentationBranch(variant)}
      token=""
      initialIndex={initialIndex}
      initialBranch={ramo}
      assetsBase="/dev/vitrine/apresentacao"
      assetsQuery={`v=${encodeURIComponent(variant)}`}
    />
  );
}
