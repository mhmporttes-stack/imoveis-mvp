import Image from "next/image";
import Link from "next/link";
import { Award, CheckCircle2, FileText, Handshake, Mail, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import HomeSearch from "@/components/HomeSearch";
import PropertyCard from "@/components/PropertyCard";
import PropertyExplorer from "@/components/PropertyExplorer";
import SectionHeading from "@/components/SectionHeading";
import { listPublicProperties } from "@/lib/public-properties";

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

const testimonials = [
  { name: "Cliente comprador", text: "O atendimento deixou muito mais fácil entender as opções e escolher com segurança." },
  { name: "Família em busca do primeiro imóvel", text: "Recebemos as informações organizadas, com simulação e condições bem explicadas." },
  { name: "Investidor local", text: "A curadoria economizou tempo e mostrou oportunidades que faziam sentido para meu objetivo." }
];

const heroContactCardClass =
  "inline-flex min-h-[58px] w-full items-center gap-3 rounded-xl border border-blue-200/25 bg-[#08233f]/55 px-5 text-white/90 shadow-[0_18px_55px_rgba(0,0,0,0.18)] backdrop-blur-md transition duration-300 hover:-translate-y-0.5 hover:border-blue-200/55 hover:bg-[#0a2c4f]/70 hover:text-white";

const heroContactTextClass =
  "whitespace-nowrap text-[clamp(0.62rem,2.35vw,0.86rem)] font-black leading-none";

export default async function HomePage() {
  const properties = await listPublicProperties();
  const featured = properties.slice(0, 3);

  return (
    <main>
      <section className="relative min-h-[calc(100svh-56px)] overflow-hidden bg-[#061A2F] text-white">
        <Image src="/assets/hero-premium-casal.png" alt="Empreendimentos imobiliários em Marília" fill priority sizes="100vw" className="object-cover object-[58%_center] md:object-[62%_center]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,16,31,0.97)_0%,rgba(4,20,38,0.9)_28%,rgba(6,28,52,0.52)_52%,rgba(4,16,31,0.2)_78%,rgba(3,12,24,0.08)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_26%,rgba(30,107,198,0.28),transparent_30%),linear-gradient(180deg,rgba(3,12,24,0.06)_0%,rgba(3,12,24,0.34)_100%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-[#061A2F]/90 to-transparent" />
        <div className="relative z-10 flex min-h-[calc(100svh-56px)] items-center px-5 py-12 sm:px-[5.8vw] sm:py-16 lg:py-14 xl:py-16">
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
            <HeroContactCards />
          </div>
        </div>
      </section>

      <section id="empreendimentos" className="py-24">
        <SectionHeading
          eyebrow="Empreendimentos em destaque"
          title="Oportunidades selecionadas para morar ou investir."
          subtitle="Cards grandes, informações essenciais e acesso direto à página individual de cada empreendimento."
        />
        <div className="container-page grid gap-8 lg:grid-cols-3">
          {featured.map((property) => <PropertyCard key={property.id} property={property} large />)}
        </div>
      </section>

      <section className="bg-mist py-24">
        <SectionHeading
          eyebrow="Por que comprar comigo"
          title="Consultoria imobiliária com método, clareza e acompanhamento."
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

      <SectionHeading
        eyebrow="Todos os empreendimentos"
        title="Explore o portfólio completo."
        subtitle="Use filtros e pesquisa para encontrar imóveis por tipo, bairro, cidade ou construtora."
      />
      <PropertyExplorer properties={properties} />

      <section className="bg-mist py-24">
        <SectionHeading eyebrow="Depoimentos" title="Atendimento pensado para decisões importantes." />
        <div className="container-page grid gap-6 md:grid-cols-3">
          {testimonials.map((testimonial) => (
            <article key={testimonial.name} className="rounded-2xl border border-line bg-white p-8 shadow-soft">
              <div className="flex gap-1 text-brand">
                {Array.from({ length: 5 }).map((_, index) => <Sparkles key={index} className="h-4 w-4" />)}
              </div>
              <p className="mt-6 text-lg leading-8 text-ink">“{testimonial.text}”</p>
              <p className="mt-6 font-extrabold text-navy">{testimonial.name}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="container-page py-24">
        <div className="overflow-hidden rounded-[32px] bg-navy p-10 text-white shadow-premium md:p-16">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-200">Pronto para conversar?</p>
            <h2 className="mt-4 text-4xl font-black leading-tight md:text-6xl">Receba uma curadoria de imóveis para o seu perfil.</h2>
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

function HeroContactCards() {
  return (
    <div className="mt-8">
      <div className="flex w-full max-w-[850px] flex-col gap-3 sm:flex-row sm:flex-wrap xl:flex-nowrap">
        <a
          href="https://wa.me/5514998407380"
          target="_blank"
          rel="noopener noreferrer"
          className={`${heroContactCardClass} sm:w-auto sm:min-w-[190px]`}
        >
          <WhatsAppIcon className="h-5 w-5 shrink-0 text-[#25D366]" />
          <span className={heroContactTextClass}>(14) 9 9840-7380</span>
        </a>
        <a
          href="mailto:MATHEUS.MACHADO.MARILIA@GMAIL.COM"
          className={`${heroContactCardClass} sm:w-auto sm:min-w-[335px]`}
        >
          <Mail className="h-5 w-5 shrink-0 text-blue-200" />
          <span className={heroContactTextClass}>MATHEUS.MACHADO.MARILIA@GMAIL.COM</span>
        </a>
        <a
          href="https://www.google.com/maps/search/?api=1&query=Av.%20Sampaio%20Vidal%20N%C2%BA%20575%2C%20Mar%C3%ADlia%2C%20SP"
          target="_blank"
          rel="noopener noreferrer"
          className={`${heroContactCardClass} sm:w-auto sm:min-w-[245px]`}
        >
          <MapPin className="h-5 w-5 shrink-0 text-blue-200" />
          <span className={heroContactTextClass}>Av. Sampaio Vidal Nº 575</span>
        </a>
      </div>
      <p className="mt-6 text-base text-blue-100/90 sm:text-lg">Atendimento personalizado</p>
    </div>
  );
}

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}
