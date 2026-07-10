import Image from "next/image";
import Link from "next/link";
import { Award, CheckCircle2, FileText, Handshake, ShieldCheck, Sparkles } from "lucide-react";
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

export default async function HomePage() {
  const properties = await listPublicProperties();
  const featured = properties.slice(0, 3);

  return (
    <main>
      <section className="relative min-h-[calc(100svh-112px)] overflow-hidden bg-[#061A2F] text-white">
        <Image src="/assets/hero-premium-casal.png" alt="Empreendimentos imobiliários em Marília" fill priority sizes="100vw" className="object-cover object-[57%_center] md:object-[66%_center]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,19,35,0.96)_0%,rgba(6,26,47,0.84)_34%,rgba(8,38,68,0.42)_62%,rgba(3,12,24,0.12)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_30%,rgba(31,111,202,0.32),transparent_28%),linear-gradient(180deg,rgba(3,12,24,0.18)_0%,rgba(3,12,24,0.58)_100%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-[#061A2F] to-transparent" />
        <div className="container-wide relative z-10 flex min-h-[calc(100svh-112px)] items-center py-16 sm:py-20 lg:py-24">
          <div className="w-full max-w-[1320px]">
            <p className="inline-flex rounded-full border border-white/20 bg-white/10 px-5 py-3 text-xs font-black uppercase text-blue-100 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-md sm:text-sm">
              Matheus Machado · CRECI 323106
            </p>
            <h1 className="mt-7 max-w-none whitespace-nowrap text-[clamp(0.78rem,4.25vw,4.85rem)] font-black leading-none text-white drop-shadow-[0_14px_38px_rgba(0,0,0,0.36)]">
              ENCONTRE SEU IMÓVEL EM MARÍLIA
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/84 sm:text-xl sm:leading-9">
              Especialistas em imóveis na planta e prontos para morar em Marília. Encontre a oportunidade ideal para realizar o sonho da casa própria com segurança e atendimento personalizado.
            </p>
            <HomeSearch />
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
