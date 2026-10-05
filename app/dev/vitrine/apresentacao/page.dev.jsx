import PresentationPlayer from "@/components/presentation/PresentationPlayer";
import { presentationScenes } from "../_fixtures/apresentacao";

// Vitrine DEV da Apresentação interativa da simulação (só existe no `next dev`; *.dev.jsx não entra no build).
// Renderiza o MESMO player com DADOS 100% FICTÍCIOS (../_fixtures/apresentacao.js), sem login e sem banco, e SEM enviar
// métrica (token vazio). Os botões de download apontam para as rotas de imagem DEV desta mesma vitrine.
//   ?v=completo (padrão) | sem-juros-sem-subsidio | igual | sem-imovel | sem-justificativa | longo
//   ?cena=N (começa na cena N, 0-based; cenas finais abrem já liberadas) · use o botão de pausa para parar o auto-avanço.
export const dynamic = "force-dynamic";

export default async function PresentationVitrine({ searchParams }) {
  const query = await searchParams;
  const variant = String(query?.v || "completo");
  return (
    <PresentationPlayer
      scenes={presentationScenes(variant)}
      token=""
      initialIndex={Number(query?.cena) || 0}
      assetsBase="/dev/vitrine/apresentacao"
      assetsQuery={`v=${encodeURIComponent(variant)}`}
    />
  );
}
