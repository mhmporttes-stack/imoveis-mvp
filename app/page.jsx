import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Building2, Calculator, Check, KeyRound, ShieldCheck } from "lucide-react";
import PropertyCaptureSection from "@/components/PropertyCaptureSection";
import PropertyExplorer from "@/components/PropertyExplorer";
import TestimonialsSection from "@/components/TestimonialsSection";
import HeroBackground from "@/components/site/HeroBackground";
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
// recorte do Matheus (docs/posicionamento/assets/boneco-3d/realista); depoimentos; vender. Sem número de famílias e sem nota
// do Google (o dono não informou esses dados).
const journey = [
  { title: "Simulação", text: "Você descobre quanto pode financiar, a entrada e os subsídios possíveis." },
  { title: "Escolha", text: "Comparamos imóveis, bairros e condições em Marília para o seu momento." },
  { title: "Aprovação", text: "Documentação e análise de crédito com orientação em cada passo." },
  { title: "Chaves", text: "Acompanhamento até a assinatura e a entrega do seu imóvel." }
];

// Fundo da abertura: "A" (degradê + grão + brilho), "B" (cidade desfocada sob véu azul) ou "C" (traço de casas/planta).
// Opções desenhadas em 2026-10-15 para o dono escolher; detalhes em components/site/HeroBackground.jsx.
const HERO_BACKGROUND = "B";

export default async function HomePage() {
  const properties = await listPublicProperties();
  const testimonials = await listPublicTestimonials();

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(realEstateAgentJsonLd()) }} />

      {/* Abertura — direção de arte dos carrosséis aprovados (docs/posicionamento/ESTILO-CARROSSEL.md, dono 2026-10-15):
          degradê azul da marca com o ponto claro atrás do Matheus (recorte sem moldura, apoiado na base, apontando
          para o texto). No celular, texto e botões vêm primeiro; a foto fica embaixo e não empurra os botões. */}
      {/* O cabeçalho do site fica transparente por cima desta seção (components/Header.jsx); pt-14/sm:pt-16 = altura dele. */}
      <section data-home-hero className="relative isolate overflow-hidden bg-[#08112E] pt-14 text-white sm:pt-16">
        <HeroBackground variant={HERO_BACKGROUND} />
        <div className="container-page relative grid md:min-h-[600px] md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:gap-6 lg:min-h-[640px] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-10">
          <div className="min-w-0 pt-7 sm:pt-12 md:self-center md:py-16 lg:py-20">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-blue-200/90 sm:text-sm sm:tracking-[0.2em] md:text-xs lg:text-sm">
              Matheus Machado <span className="text-white/35" aria-hidden="true">·</span> Corretor em Marília
            </p>

            <h1 className="mt-4 text-[clamp(2.15rem,5.6vw,4rem)] font-black leading-[1.16] tracking-[-0.015em] sm:mt-5">
              Seu primeiro imóvel em <span className="text-[#4C8DF6]">Marília</span>
              <span className="mt-3 block max-w-[30rem] text-[clamp(1.15rem,2.2vw,1.6rem)] font-bold leading-snug tracking-normal text-white/85">
                com Minha Casa Minha Vida e financiamento Caixa.
              </span>
            </h1>
            <p className="mt-5 max-w-[32rem] text-[15px] leading-relaxed text-white/70 sm:text-lg sm:leading-8">
              Descubra em menos de 2 minutos quanto você pode financiar. Depois, a gente acompanha você da aprovação até a entrega das chaves.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center md:flex-col md:items-start lg:flex-row lg:items-center">
              <Link
                href={SIMULATION_FORM_URLS.main}
                className="group inline-flex min-h-14 whitespace-nowrap items-center justify-center gap-2 rounded-full bg-white px-7 text-base font-black text-[#0E2257] shadow-[0_14px_34px_rgba(4,10,30,0.5),0_8px_30px_rgba(76,141,246,0.35)] transition duration-300 hover:-translate-y-0.5 hover:bg-blue-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300/60"
              >
                Simular quanto posso financiar
                <ArrowRight className="h-5 w-5 transition duration-300 group-hover:translate-x-1" aria-hidden="true" />
              </Link>
              <a
                href={siteWhatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 whitespace-nowrap items-center justify-center gap-2 rounded-full border border-white/25 bg-white/[0.04] px-6 text-[15px] font-bold text-white/90 transition duration-300 hover:border-white/50 hover:bg-white/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300/50 sm:min-h-14"
              >
                <WhatsAppIcon className="h-5 w-5 text-[#25D366]" />
                Falar no WhatsApp
              </a>
            </div>

            {/* Selos de confiança: pequenos e na mesma linha visual, sem competir com os botões. */}
            <ul className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2.5 text-[13px] font-semibold text-white/65 sm:mt-7 sm:text-sm">
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-[#4C8DF6]" aria-hidden="true" />
                Simulação gratuita e sem compromisso.
              </li>
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[#4C8DF6]" aria-hidden="true" />
                CRECI 323106-F
              </li>
              <li className="flex items-center border-l border-white/15 pl-5">
                <Image src="/assets/mcmv-logo-branco.png" alt="Minha Casa Minha Vida" width={101} height={30} className="h-[26px] w-auto opacity-80" />
              </li>
            </ul>
          </div>

          <div className="relative -mx-4 mt-2 h-[340px] sm:mx-0 sm:h-[380px] md:mt-0 md:h-auto">
            <span
              className="pointer-events-none absolute bottom-0 left-1/2 h-[70%] w-[78%] -translate-x-1/2 rounded-[50%] bg-[#4C8DF6]/20 blur-[70px] md:h-[62%]"
              aria-hidden="true"
            />
            <div className="absolute inset-x-0 bottom-0 top-0 md:top-8">
              <Image
                src="/assets/matheus-machado-apontando-recorte.webp"
                alt="Matheus Machado, corretor de imóveis em Marília"
                fill
                priority
                sizes="(min-width: 768px) 560px, 92vw"
                className="object-contain object-bottom [filter:drop-shadow(0_28px_36px_rgba(3,8,26,0.55))_drop-shadow(0_2px_6px_rgba(3,8,26,0.35))]"
              />
            </div>
          </div>
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

      {/* Quem é o Matheus (redesenho 2026-10-15, pedido do dono): fundo claro da marca para contrastar com a abertura
          escura; recorte do Matheus de braços cruzados (pose diferente da abertura) saindo de um círculo com o degradê
          azul, sem moldura; selo do CRECI na base do círculo (longe do rosto); os 3 itens como cartões com ícone. */}
      <section
        aria-labelledby="quem-title"
        className="relative isolate overflow-hidden bg-[radial-gradient(120%_90%_at_28%_45%,#FFFFFF_0%,#F7F9FD_38%,#EAF0FA_72%,#DCE5F4_100%)] py-14 sm:py-20 lg:py-24"
      >
        <div className="container-page grid items-center gap-12 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-12 lg:gap-16">
          <div className="relative mx-auto w-[272px] sm:w-[320px] lg:w-[380px]">
            {/* Halo e anel: decorativos, atrás do círculo. */}
            <span className="pointer-events-none absolute inset-x-[-12%] bottom-[-6%] aspect-square rounded-full bg-[#4C8DF6]/20 blur-[60px]" aria-hidden="true" />
            <span className="pointer-events-none absolute inset-x-[-5%] bottom-[-5%] aspect-square rounded-full border border-[#1F4CB3]/15" aria-hidden="true" />
            <div className="relative aspect-[100/122]">
              <span
                className="absolute inset-x-0 bottom-0 aspect-square rounded-full bg-[radial-gradient(circle_at_50%_32%,#4C8DF6_0%,#1F4CB3_38%,#0E2257_74%,#08112E_100%)] shadow-[0_34px_60px_-24px_rgba(8,17,46,0.55)]"
                aria-hidden="true"
              />
              {/* O recorte sai pelo topo do círculo e é cortado pela curva de baixo (rounded-b), sem borda reta. */}
              <div className="absolute inset-0 overflow-hidden rounded-b-[9999px]">
                <Image
                  src="/assets/matheus-machado-bracos-cruzados-recorte.webp"
                  alt="Matheus Machado, corretor de imóveis em Marília, sorrindo de braços cruzados"
                  fill
                  sizes="(min-width: 1024px) 380px, 320px"
                  className="object-contain object-bottom"
                />
              </div>
            </div>
            <p className="absolute bottom-0 left-1/2 inline-flex -translate-x-1/2 translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#DCE5F4] bg-white px-4 py-2 text-[13px] font-bold text-[#0E2257] shadow-[0_10px_24px_-10px_rgba(8,17,46,0.35)]">
              <ShieldCheck className="h-4 w-4 text-[#1F4CB3]" aria-hidden="true" />
              CRECI 323106-F
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#1F4CB3] sm:text-sm">Quem é o Matheus</p>
            <h2 id="quem-title" className="mt-3 text-[clamp(1.75rem,3.4vw,2.75rem)] font-black leading-[1.15] tracking-[-0.015em] text-[#0E2257]">
              Prazer, eu sou o <span className="text-[#1F4CB3]">Matheus</span>.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-ink-2 sm:text-lg">
              Sou corretor de imóveis em Marília, com CRECI 323106-F, e sou especialista na compra do primeiro imóvel:
              explico o Minha Casa Minha Vida e o financiamento da Caixa sem palavras difíceis, e minha equipe e eu
              acompanhamos cada etapa com você.
            </p>
            <ul className="mt-7 grid gap-3 lg:grid-cols-3">
              {[
                { text: "Simulação gratuita, sem compromisso", Icon: Calculator },
                { text: "Imóveis na planta e prontos em Marília", Icon: Building2 },
                { text: "Acompanhamento até a entrega das chaves", Icon: KeyRound }
              ].map(({ text, Icon }) => (
                <li
                  key={text}
                  className="flex items-center gap-3 rounded-2xl border border-white bg-white/75 p-3.5 text-[15px] font-semibold leading-snug text-ink shadow-[0_8px_24px_-14px_rgba(14,34,87,0.35)] backdrop-blur-sm lg:flex-col lg:items-start lg:gap-3 lg:p-4"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#1F4CB3_0%,#0E2257_100%)] text-white shadow-[0_6px_14px_-6px_rgba(31,76,179,0.7)]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {text}
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
