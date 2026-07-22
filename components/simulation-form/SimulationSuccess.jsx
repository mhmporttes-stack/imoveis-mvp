import Image from "next/image";
import Link from "next/link";
import { Camera } from "lucide-react";

export default function SimulationSuccess() {
  return (
    <article className="mx-auto w-full max-w-4xl rounded-[36px] border border-line bg-white p-6 text-center shadow-[0_24px_70px_rgba(13,59,102,0.12)] sm:p-10 lg:p-12">
      <Image
        alt="Caixa"
        className="mx-auto h-auto w-[min(70vw,330px)] object-contain"
        height={96}
        priority
        src="/assets/caixa-logo-cropped.jpg"
        width={360}
      />

      <h1 className="mx-auto mt-8 max-w-3xl text-[clamp(1.9rem,4.3vw,3.25rem)] font-black leading-[1.08] tracking-[-0.02em] text-navy">
        Recebemos suas informações com sucesso!
      </h1>
      <p className="mx-auto mt-6 max-w-3xl text-[clamp(1.05rem,2vw,1.35rem)] font-black leading-8 text-navy">
        Sua solicitação de simulação foi enviada para análise.
      </p>
      <p className="mx-auto mt-7 max-w-3xl text-base font-semibold leading-8 text-muted sm:text-lg">
        Seus dados serão analisados por uma correspondente credenciada da Caixa Econômica Federal.
        Assim que a análise for concluída, entraremos em contato para apresentar as melhores
        condições disponíveis para o seu perfil.
      </p>

      <div className="relative mx-auto mt-12 max-w-3xl overflow-hidden border-t border-line px-1 pt-10">
        <DecorativeBubble className="pointer-events-none absolute left-0 top-[170px] hidden h-24 w-24 text-brand sm:block" />
        <DecorativeHouse className="pointer-events-none absolute right-3 top-[155px] hidden h-28 w-28 text-brand sm:block" />
        <DecorativeArrow className="pointer-events-none absolute bottom-[88px] left-[9%] hidden h-16 w-16 text-brand sm:block" />
        <DecorativeHeart className="pointer-events-none absolute bottom-0 right-[24%] hidden h-8 w-8 text-brand sm:block" />
        <p className="text-[clamp(0.78rem,1.5vw,1rem)] font-black uppercase tracking-[0.34em] text-brand">
          Enquanto sua simulação é preparada...
        </p>
        <h2
          className="relative mt-4 inline-block pb-3 text-[clamp(2.35rem,7vw,5rem)] font-black leading-[0.9] tracking-[-0.06em] text-navy after:absolute after:bottom-0 after:left-7 after:right-7 after:h-1.5 after:-rotate-1 after:rounded-full after:bg-brand after:content-['']"
          style={{ fontFamily: '"Trebuchet MS", "Comic Sans MS", "Arial Rounded MT Bold", system-ui, sans-serif' }}
        >
          Conheça melhor o seu corretor.
          <span className="absolute -right-10 top-0 hidden text-brand sm:block" aria-hidden="true">
            <AccentMarks />
          </span>
        </h2>
        <p className="relative z-10 mx-auto mt-8 max-w-2xl text-base font-semibold leading-7 text-navy sm:text-lg">
          No meu Instagram você encontra dicas práticas, conteúdos exclusivos e novidades sobre
          financiamento imobiliário, Minha Casa Minha Vida e muito mais{" "}
          <strong className="font-black text-brand">
            para te ajudar a conquistar o seu imóvel!
          </strong>
        </p>
        <Link
          aria-label="Conhecer o Instagram de Matheus Machado"
          className="relative z-10 mt-9 inline-flex min-h-[58px] w-full max-w-md items-center justify-center rounded-full bg-[linear-gradient(90deg,#ff8a00_0%,#ff2f75_48%,#8a2be2_100%)] px-7 py-3 text-lg font-black text-white shadow-[0_18px_45px_rgba(138,43,226,0.18)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(138,43,226,0.24)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          href="https://www.instagram.com/mhm.machado/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Camera className="mr-3 h-7 w-7" aria-hidden="true" />
          Me siga no Instagram!
        </Link>
        <p className="relative z-10 mx-auto mt-5 inline-block max-w-xl pb-2 text-sm italic leading-6 text-navy after:absolute after:bottom-0 after:left-8 after:right-8 after:h-0.5 after:-rotate-1 after:rounded-full after:bg-brand after:content-[''] sm:text-base">
          Conteúdos que aproximam você do seu sonho.
        </p>
      </div>
    </article>
  );
}

function AccentMarks() {
  return (
    <svg viewBox="0 0 58 58" className="h-12 w-12" aria-hidden="true" fill="none">
      <path d="M15 33 4 44" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <path d="M28 25 30 7" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <path d="M39 37 53 30" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function DecorativeBubble({ className }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true" fill="none">
      <path d="M19 37c8-20 69-25 81 7 10 27-8 49-37 49-9 0-18-2-25-5L16 103l8-28C14 65 13 51 19 37Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M45 51c7-13 27-7 19 10 11-12 29 0 15 16-9 10-25 16-25 16s-15-12-20-24c-3-8 4-18 11-18Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 26 1 15M20 18 18 5" stroke="#FF9F1C" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function DecorativeHouse({ className }) {
  return (
    <svg viewBox="0 0 130 130" className={className} aria-hidden="true" fill="none">
      <path d="M35 59 67 31l34 28" stroke="#FF9F1C" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M43 58v43h49V58" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M61 101V78h14v23M56 67h12v12H56Z" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
      <path d="M105 28 115 14M113 40h14M96 20l-2-15" stroke="#FF9F1C" strokeWidth="5" strokeLinecap="round" />
      <path d="M88 109c9-9 23-6 25 5 2 10-9 18-18 12-8-5-8-15-7-17Zm-6 11-20 20m20-20 8 8m-18 2 8 8" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DecorativeArrow({ className }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" fill="none">
      <path d="M80 18C38 24 18 51 29 78" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M26 78 12 65m14 13 10-17" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DecorativeHeart({ className }) {
  return (
    <svg viewBox="0 0 60 60" className={className} aria-hidden="true" fill="none">
      <path d="M30 50S8 37 10 22c1-10 15-14 20-4 5-10 19-6 20 4 2 15-20 28-20 28Z" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
