import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import PropertyCaptureSection from "@/components/PropertyCaptureSection";
import PropertyExplorer from "@/components/PropertyExplorer";
import TestimonialsSection from "@/components/TestimonialsSection";
import { siteWhatsappUrl } from "@/components/site/site-links";
import { listPublicProperties } from "@/lib/public-properties";
import { listPublicTestimonials } from "@/lib/public-testimonials";
import { SIMULATION_FORM_URLS } from "@/lib/simulation-links";
import { HOME_DESCRIPTION, jsonLdHtml, realEstateAgentJsonLd } from "@/lib/public-seo";

// ISR: página pública, mesmo conteúdo para todo visitante (sem sessão/auth).
// force-dynamic forçava um round-trip ao Supabase a cada visita (TTFB medido
// em 636ms); 60s de cache é imperceptível para a home e tira carga do banco
// em todo pico de tráfego. Achado da auditoria de performance 2026-10-01.
export const revalidate = 60;

// SEO da home (dono, 2026-10-15): descrição e canônica; dados da imobiliária em JSON-LD (lib/public-seo.js).
export const metadata = {
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" }
};

// Home mais curta (dono aprovou em 2026-10-15): abertura com a promessa + simular; uma lista só de imóveis
// (busca no topo dela, 6 por vez); "Por que comprar comigo" como linha do tempo; "Quem é o Matheus" com
// foto real (docs/posicionamento/assets/fotos-reais); depoimentos; vender. Sem número de famílias e sem nota
// do Google (o dono não informou esses dados).
const journey = [
  { title: "Simulação", text: "Você descobre quanto pode financiar, a entrada e os subsídios possíveis." },
  { title: "Escolha", text: "Comparamos imóveis, bairros e condições em Marília para o seu momento." },
  { title: "Aprovação", text: "Documentação e análise de crédito com orientação em cada passo." },
  { title: "Chaves", text: "Acompanhamento até a assinatura e a entrega do seu imóvel." }
];

export default async function HomePage() {
  const properties = await listPublicProperties();
  const testimonials = await listPublicTestimonials();

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(realEstateAgentJsonLd()) }} />

      {/* Abertura (redesenho visual 2026-10-15): mesma promessa, mesmos links. A foto do Matheus entra num
          arco "de porta" apoiado na base da faixa (metáfora de casa, sem card); o brilho azul usa o azul da
          logo (#3673C2) para dar profundidade ao marinho. No celular, prioridade para a promessa e os botões. */}
      <section className="relative isolate overflow-hidden bg-[#061A2F] text-white">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_0%_0%,rgba(54,115,194,0.38),transparent_70%)]" />
          <div className="absolute inset-0 hidden bg-[radial-gradient(ellipse_38%_60%_at_76%_72%,rgba(54,115,194,0.42),transparent_72%)] lg:block" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-[#041427]" />
        </div>

        <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] lg:gap-12">
          <div className="min-w-0 self-center pb-10 pt-7 sm:pb-14 sm:pt-12 lg:py-20">
            {/* No computador, nome e CRECI ficam no selo junto da foto. */}
            <div className="flex items-center gap-3 lg:hidden">
              <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-full ring-2 ring-[#3673C2] ring-offset-2 ring-offset-[#061A2F]">
                <Image src="/assets/corretor-matheus-rosto.jpg" alt="Matheus Machado, corretor de imóveis" fill sizes="56px" className="object-cover" priority />
              </span>
              <p className="leading-tight">
                <span className="block text-base font-extrabold text-white">Matheus Machado</span>
                <span className="mt-1 block text-sm font-semibold text-blue-100/80">Corretor em Marília · CRECI 323106-F</span>
              </p>
            </div>

            {/* "em Marília" e "Minha Casa Minha Vida" nunca se partem: nome do programa e da cidade leem como um bloco. */}
            <h1 className="mt-7 text-[clamp(2.15rem,5.6vw,3.9rem)] font-extrabold leading-[1.04] tracking-[-0.025em] sm:mt-9 lg:mt-0">
              Seu primeiro imóvel <span className="whitespace-nowrap">em Marília</span>
              <span className="mt-3 block max-w-[30rem] text-[clamp(1.2rem,2.5vw,1.75rem)] font-bold leading-snug tracking-[-0.01em] text-[#A8CBF5]">
                com <span className="whitespace-nowrap">Minha Casa Minha Vida</span> e financiamento Caixa.
              </span>
            </h1>
            <p className="mt-5 max-w-[33rem] text-[1.0625rem] leading-relaxed text-white/85 sm:mt-6 sm:text-lg sm:leading-8">
              Descubra em menos de 2 minutos quanto você pode financiar. Depois, a gente acompanha você da aprovação até a entrega das chaves.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href={SIMULATION_FORM_URLS.main}
                className="group inline-flex min-h-14 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-7 text-base font-black text-navy shadow-[0_12px_40px_rgba(54,115,194,0.45)] transition duration-300 hover:-translate-y-0.5 hover:bg-blue-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                Simular quanto posso financiar
                <ArrowRight className="h-5 w-5 transition duration-300 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" aria-hidden="true" />
              </Link>
              <a
                href={siteWhatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-14 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/35 px-7 text-base font-extrabold text-white transition duration-300 hover:border-white/70 hover:bg-white/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300/60 motion-reduce:transition-none"
              >
                <WhatsAppIcon className="h-5 w-5 text-[#25D366]" />
                Falar no WhatsApp
              </a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-white/80">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#3673C2]/35 text-[#CFE1FA]" aria-hidden="true">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              Simulação gratuita e sem compromisso.
            </p>
          </div>

          <figure className="relative mx-auto hidden w-full max-w-[400px] self-end pt-14 lg:block">
            {/* Arco de fundo deslocado: dá profundidade sem sombra pesada. */}
            <div className="absolute -inset-x-5 bottom-0 top-9 rounded-t-full border border-white/10" aria-hidden="true" />
            <div className="relative aspect-[4/5] overflow-hidden rounded-t-full bg-[#0A2747]">
              <Image
                src="/assets/corretor-matheus-caixa.jpg"
                alt="Matheus Machado, corretor de imóveis em Marília"
                fill
                priority
                sizes="400px"
                className="object-cover object-top"
              />
              <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#041427] via-[#041427]/55 to-transparent" aria-hidden="true" />
            </div>
            <figcaption className="absolute -left-10 bottom-10 rounded-2xl bg-[#0A2747] px-5 py-3.5 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/15">
              <span className="block text-base font-extrabold">Matheus Machado</span>
              <span className="mt-0.5 block text-sm font-semibold text-blue-100/80">Corretor de imóveis · CRECI 323106-F</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <PropertyExplorer properties={properties} />

      {/* Por que comprar comigo — linha do tempo curta */}
      <section aria-labelledby="jornada-title" className="bg-mist py-12 sm:py-20">
        <div className="container-page">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand sm:text-sm">Por que comprar comigo</p>
          <h2 id="jornada-title" className="mt-2 max-w-3xl text-[clamp(1.6rem,3vw,2.5rem)] font-black leading-tight text-navy">
            Do primeiro contato às chaves, com alguém do seu lado.
          </h2>
          <ol className="relative mt-8 grid gap-6 md:mt-12 md:grid-cols-4 md:gap-8">
            <span className="absolute bottom-3 left-[15px] top-3 w-px bg-brand/25 md:bottom-auto md:left-4 md:right-4 md:top-[15px] md:h-px md:w-auto" aria-hidden="true" />
            {journey.map((step, index) => (
              <li key={step.title} className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-4 md:grid-cols-1 md:gap-5">
                <span className="relative z-10 grid h-8 w-8 place-items-center rounded-full bg-navy text-sm font-black text-white ring-4 ring-mist">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-lg font-extrabold text-navy">{step.title}</h3>
                  <p className="mt-1 leading-7 text-muted">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link
            href={SIMULATION_FORM_URLS.main}
            className="mt-8 inline-flex items-center gap-2 text-base font-extrabold text-brand transition hover:text-navy md:mt-10"
          >
            Começar pela simulação
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* Quem é o Matheus */}
      <section aria-labelledby="quem-title" className="py-12 sm:py-20">
        <div className="container-page grid items-center gap-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-14">
          <div className="relative mx-auto aspect-[3/4] w-full max-w-[280px] overflow-hidden rounded-[24px] bg-mist sm:max-w-[360px]">
            <Image src="/assets/corretor-matheus-caixa.jpg" alt="Matheus Machado na porta de uma agência bancária" fill sizes="(min-width: 768px) 360px, 90vw" className="object-cover lg:hidden" />
            <Image src="/assets/corretor-matheus-retrato.jpg" alt="Matheus Machado sorrindo" fill sizes="360px" className="hidden object-cover lg:block" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand sm:text-sm">Quem é o Matheus</p>
            <h2 id="quem-title" className="mt-2 text-[clamp(1.6rem,3vw,2.5rem)] font-black leading-tight text-navy">
              Prazer, eu sou o Matheus.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-ink-2 sm:text-lg">
              Sou corretor de imóveis em Marília, com CRECI 323106-F. Meu foco é quem vai comprar o primeiro imóvel:
              explico o Minha Casa Minha Vida e o financiamento da Caixa sem palavras difíceis, e minha equipe e eu
              acompanhamos cada etapa com você.
            </p>
            <ul className="mt-6 grid gap-3 text-base font-semibold text-ink">
              {["Simulação gratuita, sem compromisso", "Imóveis na planta e prontos em Marília", "Acompanhamento até a entrega das chaves"].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <TestimonialsSection testimonials={testimonials} />

      <section className="container-page pt-4">
        <PropertyCaptureSection />
      </section>
    </main>
  );
}

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}
