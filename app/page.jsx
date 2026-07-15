import Image from "next/image";
import Link from "next/link";
import { Award, CheckCircle2, FileText, Handshake, ShieldCheck } from "lucide-react";
import HomeSearch from "@/components/HomeSearch";
import PropertyCard from "@/components/PropertyCard";
import PropertyExplorer from "@/components/PropertyExplorer";
import SectionHeading from "@/components/SectionHeading";
import TestimonialsSection from "@/components/TestimonialsSection";
import { listPublicProperties } from "@/lib/public-properties";
import { listPublicTestimonials } from "@/lib/public-testimonials";

export const dynamic = "force-dynamic";

const benefits = [
  { icon: ShieldCheck, title: "Compra segura", text: "Acompanhamento consultivo para comparar condições, prazos e documentação." },
  { icon: FileText, title: "Informação clara", text: "Catálogos, valores, metragem e condições comerciais organizados em um só lugar." },
  { icon: Handshake, title: "Negociação guiada", text: "Suporte para entender campanhas, subsídios e entrada parcelada." },
  { icon: Award, title: "Curadoria local", text: "Seleção de oportunidades em Marília com foco em perfil, localização e momento de compra." }
];

const steps = [
  { title: "Escolha", text: "Compare empreendimentos, bairros, plantas e diferenciais." },
  { title: "Simulação", text: "Entenda valores, entrada, financiamento e subsídios possíveis." },
  { title: "Aprovação", text: "Avance com documentação e análise de crédito com orientação." },
  { title: "Entrega das chaves", text: "Acompanhe o processo até a assinatura e recebimento do imóvel." }
];

export default async function HomePage() {
  const properties = await listPublicProperties();
  const testimonials = await listPublicTestimonials();
  const featuredProperties = properties.filter((property) => property.isFeatured);
  const featured = (featuredProperties.length ? featuredProperties : properties).slice(0, 3);

  return (
    <main>
      <section className="relative min-h-[100svh] overflow-hidden bg-[#061A2F] text-white">
        <Image src="/assets/hero-premium-casal.png" alt="Empreendimentos imobiliários em Marília" fill priority sizes="100vw" className="object-cover object-[58%_center] md:object-[62%_center]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,16,31,0.97)_0%,rgba(4,20,38,0.9)_28%,rgba(6,28,52,0.52)_52%,rgba(4,16,31,0.2)_78%,rgba(3,12,24,0.08)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_26%,rgba(30,107,198,0.28),transparent_30%),linear-gradient(180deg,rgba(3,12,24,0.06)_0%,rgba(3,12,24,0.34)_100%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-[#061A2F]/90 to-transparent" />
        <div className="relative z-10 flex min-h-[100svh] items-center px-5 py-12 sm:px-[5.8vw] sm:py-16 lg:py-14 xl:py-16">
          <div className="w-full max-w-[calc(100vw-40px)] md:max-w-[850px] xl:max-w-[900px] 2xl:max-w-[940px]">
            <div className="relative h-[105px] w-[min(72vw,285px)] sm:h-32 sm:w-[330px] lg:h-28 lg:w-[300px] xl:h-32 xl:w-[340px]">
              <Image
                src="/assets/matheus-machado-symbol-premium.png"
                alt="Matheus Machado - Corretor de Imóveis"
                fill
                sizes="(max-width: 640px) 74vw, 300px"
                className="object-contain object-center"
                priority
              />
            </div>
            <div className="mt-4">
              <p className="text-xl font-black uppercase tracking-[0.16em] text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.32)] sm:text-2xl xl:text-[1.65rem]">
                MATHEUS MACHADO
              </p>
              <p className="mt-2 text-xs font-black uppercase tracking-[0.22em] text-blue-100/90 sm:text-sm">
                CORRETOR DE IMÓVEIS · CRECI 323106
              </p>
            </div>
            <h1 className="mt-9 max-w-[940px] text-[clamp(1.52rem,3vw,3.4rem)] font-black leading-[1.02] text-white drop-shadow-[0_14px_38px_rgba(0,0,0,0.36)] md:whitespace-nowrap md:leading-[0.96]">
              <span className="md:hidden">
                ENCONTRE SEU IMÓVEL EM
                <br />
                MARÍLIA
              </span>
              <span className="hidden md:inline">ENCONTRE SEU IMÓVEL EM MARÍLIA</span>
            </h1>
            <div className="mt-7 max-w-[680px] space-y-2 text-[0.95rem] leading-7 text-white/88 [overflow-wrap:anywhere] sm:text-lg sm:leading-8 sm:[overflow-wrap:normal]">
              <p>Especialista no mercado imobiliário de Marília.</p>
              <p>Simulação de financiamento, aprovação de crédito e acompanhamento personalizado durante todo o processo.</p>
            </div>
            <HomeSearch />
            <p className="mt-6 text-base text-blue-100/90 sm:text-lg">Atendimento personalizado</p>
            <div className="sm:hidden">
              <HeroPropertyLinks />
            </div>
          </div>
        </div>
        <div className="absolute bottom-24 left-0 right-0 z-20 hidden px-5 sm:block sm:px-[5.8vw] lg:bottom-28">
          <HeroPropertyLinks align="end" />
        </div>
      </section>

      <section id="empreendimentos" className="py-24">
        <SectionHeading
          eyebrow="Imóveis em destaque"
          title="Oportunidades para morar ou investir."
          subtitle="Encontre o imóvel ideal com praticidade, segurança e todas as informações necessárias para decidir."
          titleClassName="max-w-none md:whitespace-nowrap md:text-[clamp(2.2rem,3.2vw,3.1rem)]"
          subtitleClassName="max-w-none md:whitespace-nowrap"
        />
        <div className="container-wide grid gap-8 md:grid-cols-2 xl:grid-cols-3">
          {featured.map((property) => <PropertyCard key={property.id} property={property} large />)}
        </div>
      </section>

      <PropertyExplorer properties={properties} />

      <section className="bg-mist py-24">
        <SectionHeading
          eyebrow="Por que comprar comigo"
          title="Consultoria com método, clareza e acompanhamento."
          titleClassName="xl:whitespace-nowrap"
        />
        <div className="container-page grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {benefits.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-2xl border border-line bg-white p-8 shadow-soft">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
                <Icon className="h-7 w-7" />
              </span>
              <h3 className="mt-7 text-2xl font-extrabold text-navy">{title}</h3>
              <p className="mt-4 leading-7 text-muted">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="py-24">
        <SectionHeading eyebrow="Como funciona" title="Uma jornada simples até as chaves." />
        <div className="container-page grid gap-6 md:grid-cols-4">
          {steps.map((step, index) => (
            <article key={step.title} className="rounded-2xl border border-line bg-white p-8 shadow-soft">
              <span className="text-sm font-black text-brand">0{index + 1}</span>
              <h3 className="mt-5 text-2xl font-extrabold text-navy">{step.title}</h3>
              <p className="mt-4 leading-7 text-muted">{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <TestimonialsSection testimonials={testimonials} />

      <section className="container-page py-24">
        <div className="overflow-hidden rounded-[32px] bg-navy p-10 text-white shadow-premium md:p-16">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-200">Pronto para conversar?</p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,3.75rem)] font-black leading-tight">Receba uma curadoria de imóveis para o seu perfil.</h2>
            <p className="mt-6 text-xl leading-9 text-white/75">Fale sobre sua renda, bairro desejado, objetivo de compra e prazo. Eu organizo as melhores opções disponíveis.</p>
            <Link href="#empreendimentos" className="mt-8 inline-flex premium-button bg-white text-navy hover:-translate-y-0.5">
              <CheckCircle2 className="mr-2 h-5 w-5" />
              Ver empreendimentos
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function HeroPropertyLinks({ align = "start" }) {
  return (
    <nav
      className={`mt-8 flex flex-col items-stretch gap-3 sm:mt-0 sm:flex-row sm:items-center ${
        align === "end" ? "sm:justify-end" : "sm:justify-start"
      }`}
      aria-label="Navegação de imóveis"
    >
      <Link href="/#empreendimentos" className="inline-flex min-h-12 items-center justify-center rounded-full border border-blue-100/35 bg-[#08233f]/60 px-6 text-sm font-extrabold text-white shadow-[0_18px_55px_rgba(0,0,0,0.18)] backdrop-blur-md transition duration-300 hover:-translate-y-0.5 hover:border-blue-100/70 hover:bg-white hover:text-navy sm:min-w-48">
        Imóveis na Planta
      </Link>
      <Link href="/#todos" className="inline-flex min-h-12 items-center justify-center rounded-full border border-blue-100/35 bg-[#08233f]/60 px-6 text-sm font-extrabold text-white shadow-[0_18px_55px_rgba(0,0,0,0.18)] backdrop-blur-md transition duration-300 hover:-translate-y-0.5 hover:border-blue-100/70 hover:bg-white hover:text-navy sm:min-w-48">
        Imóveis Prontos
      </Link>
    </nav>
  );
}
