import PresentationPlayer from "@/components/presentation/PresentationPlayer";
import { buildPresentationScenes } from "@/lib/simulation-presentation-core.mjs";

// Vitrine DEV da Apresentação interativa da simulação (só existe no `next dev`; *.dev.jsx não entra no build).
// Renderiza o MESMO player com DADOS 100% FICTÍCIOS, sem login e sem banco, e SEM enviar métrica (token vazio).
//   ?v=completo (padrão) | sem-subsidio | igual (novo = usado) | sem-imovel | sem-justificativa | sem-corretor
//   ?cena=N (começa na cena N, 0-based) · ?pausa=1 não é necessário: use o botão de pausa.
export const dynamic = "force-dynamic";

const DEFAULT_REASON = "Texto padrão do sistema.";
// Foto fictícia e neutra (gradiente com formas simples), nada de imóvel ou cliente real.
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9CC3F5"/><stop offset="0.62" stop-color="#DCE9F9"/><stop offset="1" stop-color="#7FA6D6"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/><rect x="170" y="420" width="740" height="560" fill="#F3F7FC"/><rect x="170" y="420" width="740" height="40" fill="#4C7BB5"/><rect x="250" y="520" width="150" height="150" fill="#9CC3F5"/><rect x="460" y="520" width="150" height="150" fill="#9CC3F5"/><rect x="670" y="520" width="150" height="150" fill="#9CC3F5"/><rect x="480" y="760" width="120" height="220" fill="#4C7BB5"/></svg>`
)}`;

function simulation(variant) {
  const base = {
    id: "dev",
    clientName: "Mariana Souza Lima",
    simulationDate: "2026-10-03",
    simulationModels: {
      novo: { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15" },
      usado: { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15" }
    },
    properties: [
      {
        customName: "Residencial Vila Aurora",
        imageUrl: "https://dev.invalid/foto.jpg",
        benefits: [{ text: "2 dormitórios com varanda" }, { text: "Condomínio com lazer completo" }, { text: "Próximo a escolas e comércio" }, { text: "Entrada parcelada" }],
        recommendationReason: "Boa localização para a rotina da família e parcelas que cabem dentro do orçamento informado na simulação."
      }
    ]
  };
  if (variant === "sem-subsidio") base.simulationModels = { novo: { financingValue: "232.000,00", subsidyValue: "0", firstInstallment: "1.320,00", lastInstallment: "980,55" }, usado: { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" } };
  if (variant === "igual") base.simulationModels.usado = { ...base.simulationModels.novo };
  if (variant === "completo") base.simulationModels.usado = { financingValue: "150.000,00", subsidyValue: "0", firstInstallment: "940,00", lastInstallment: "701,10" };
  if (variant === "sem-imovel") base.properties = [];
  if (variant === "sem-justificativa") base.properties[0].recommendationReason = DEFAULT_REASON;
  return base;
}

export default async function PresentationVitrine({ searchParams }) {
  const query = await searchParams;
  const variant = String(query?.v || "completo");
  const broker = variant === "sem-corretor" ? null : { firstName: "Carlos", whatsappUrl: "https://wa.me/5514900000000?text=Ol%C3%A1" };
  const scenes = buildPresentationScenes({ simulation: simulation(variant), broker, defaultReason: DEFAULT_REASON }).map((scene) =>
    scene.id === "imovel" ? { ...scene, imageUrl: PHOTO } : scene
  );
  return <PresentationPlayer scenes={scenes} token="" initialIndex={Number(query?.cena) || 0} />;
}
