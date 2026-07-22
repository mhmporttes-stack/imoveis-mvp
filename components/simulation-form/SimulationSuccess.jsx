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

      <div className="mx-auto mt-12 max-w-3xl border-t border-line pt-10">
        <p className="text-[clamp(0.78rem,1.5vw,1rem)] font-black uppercase tracking-[0.34em] text-brand">
          Enquanto sua simulação é preparada...
        </p>
        <h2 className="relative mt-4 inline-block pb-2 text-[clamp(2.35rem,6vw,4.75rem)] font-black leading-none tracking-[-0.05em] text-navy after:absolute after:bottom-0 after:left-8 after:right-8 after:h-1 after:rounded-full after:bg-brand after:content-['']">
          Conheça melhor o seu corretor.
        </h2>
        <p className="mx-auto mt-8 max-w-2xl text-base font-semibold leading-7 text-navy sm:text-lg">
          No meu Instagram você encontra dicas práticas, conteúdos exclusivos e novidades sobre
          financiamento imobiliário, Minha Casa Minha Vida e muito mais{" "}
          <strong className="font-black text-brand">
            para te ajudar a conquistar o seu imóvel!
          </strong>
        </p>
        <Link
          aria-label="Conhecer o Instagram de Matheus Machado"
          className="mt-9 inline-flex min-h-[58px] w-full max-w-md items-center justify-center rounded-full bg-[linear-gradient(90deg,#ff8a00_0%,#ff2f75_48%,#8a2be2_100%)] px-7 py-3 text-lg font-black text-white shadow-[0_18px_45px_rgba(138,43,226,0.18)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(138,43,226,0.24)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          href="https://www.instagram.com/mhm.machado/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Camera className="mr-3 h-7 w-7" aria-hidden="true" />
          Me siga no Instagram!
        </Link>
        <p className="mx-auto mt-5 max-w-xl text-sm italic leading-6 text-navy sm:text-base">
          Conteúdos que aproximam você do seu sonho.
        </p>
      </div>
    </article>
  );
}
