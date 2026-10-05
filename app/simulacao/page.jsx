import { Suspense } from "react";
import LinkJourneyGate from "@/components/simulation-form/LinkJourneyGate";

// Prévia de compartilhamento (WhatsApp, Instagram Direct, Facebook, X…): título, descrição, canonical, Open Graph e
// Twitter Card ficam no HTML estático desta página (crawlers não executam JavaScript). A imagem 1200x630 é um PNG
// estático (public/assets/og-simulacao-v2.png) com a logo atual; ao trocá-la, mude o sufixo do nome para o cache das
// plataformas não segurar a versão antiga.
const SHARE_URL = "https://www.matheusmachadoimoveis.com.br/simulacao";
const SHARE_TITLE = "Simule seu primeiro imóvel | Matheus Machado";
const SHARE_DESCRIPTION = "Descubra seu poder de compra e dê o primeiro passo para o seu imóvel.";
const SHARE_IMAGE = "https://www.matheusmachadoimoveis.com.br/assets/og-simulacao-v2.png";
const SHARE_IMAGE_ALT = "Simule seu primeiro imóvel — Descubra seu poder de compra | Matheus Machado, Corretor de Imóveis";

export const metadata = {
  title: SHARE_TITLE,
  description: SHARE_DESCRIPTION,
  alternates: { canonical: SHARE_URL },
  openGraph: {
    type: "website",
    url: SHARE_URL,
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    siteName: "Matheus Machado Imóveis",
    locale: "pt_BR",
    images: [{ url: SHARE_IMAGE, secureUrl: SHARE_IMAGE, width: 1200, height: 630, type: "image/png", alt: SHARE_IMAGE_ALT }]
  },
  twitter: {
    card: "summary_large_image",
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: [{ url: SHARE_IMAGE, alt: SHARE_IMAGE_ALT }]
  }
};

export default function SimulationPage() {
  return <SimulationPageContent />;
}

// O cabeçalho fixo "Simulação de financiamento" foi para dentro de
// LinkJourneyGate (só aparece quando o visitante escolhe essa jornada) — a
// tela de escolha e o Atendimento Rápido têm seu próprio título contextual,
// então um cabeçalho fixo aqui ficaria repetido/errado nessas duas etapas.
export function SimulationPageContent({ brokerRef = "" }) {
  return (
    <main className="bg-mist py-12 sm:py-16">
      <section className="container-page">
        <Suspense fallback={<SimulationFormFallback />}>
          <LinkJourneyGate brokerRefOverride={brokerRef} />
        </Suspense>
      </section>
    </main>
  );
}

function SimulationFormFallback() {
  return (
    <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-8 shadow-soft">
      <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
        <div className="h-full w-1/3 rounded-full bg-brand" />
      </div>
      <div className="mt-8 h-8 w-2/3 rounded-full bg-slate-100" />
      <div className="mt-5 h-14 rounded-2xl bg-slate-100" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="h-28 rounded-2xl bg-slate-100" />
        <div className="h-28 rounded-2xl bg-slate-100" />
      </div>
    </article>
  );
}
