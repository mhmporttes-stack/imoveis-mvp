import { Suspense } from "react";
import LinkJourneyGate from "@/components/simulation-form/LinkJourneyGate";
import { SHARE_DESCRIPTION, SHARE_IMAGE, SHARE_IMAGE_ALT, SHARE_TITLE, SHARE_URL } from "@/lib/simulacao-share.mjs";

// Prévia de compartilhamento (WhatsApp, Instagram Direct, Facebook, X…): título, descrição, canonical, Open Graph e
// Twitter Card ficam no HTML estático desta página (crawlers não executam JavaScript). A imagem 1200x630 é um PNG
// estático (public/assets/og-simulacao-v3.png) com a logo atual; ao trocá-la, mude o sufixo do nome para o cache das
// plataformas não segurar a versão antiga.

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
    // Tela fixa (2026-10-05): o questionário ocupa a tela inteira, centralizado e sem rolagem da página. Só se o conteúdo
    // for maior que a tela (celular pequeno, tela final) a própria área rola — nada fica cortado.
    <main className="fixed inset-0 z-10 flex overflow-y-auto bg-[#f6f9fd] px-0">
      {/* Fundo leve (2026-10-05): degradê azul/violeta quase transparente + marca d'água do M da logo bem suave. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(60%_50%_at_12%_8%,rgba(23,105,209,0.12),transparent_70%),radial-gradient(55%_45%_at_92%_88%,rgba(129,52,175,0.09),transparent_70%),radial-gradient(40%_35%_at_85%_10%,rgba(245,133,41,0.06),transparent_70%),linear-gradient(180deg,#fafcff_0%,#eef3fb_100%)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" className="absolute -bottom-10 -right-16 w-[300px] rotate-[-8deg] opacity-[0.045] sm:w-[420px]" src="/assets/matheus-machado-symbol.png" />
      </div>
      <section className="container-page relative z-10 m-auto w-full py-4 sm:py-6">
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
