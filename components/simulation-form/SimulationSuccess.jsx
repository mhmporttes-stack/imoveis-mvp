import Image from "next/image";
import Link from "next/link";
import { Camera, CheckCircle2 } from "lucide-react";

// Tela final da simulação: um bloco de confirmação + convite para o Instagram. Visual limpo, azul e branco;
// só o botão do Instagram usa o degradê da rede.
export default function SimulationSuccess() {
  return (
    <article className="mx-auto w-full max-w-xl rounded-[28px] border border-line bg-white px-6 py-8 text-center shadow-[0_24px_70px_rgba(13,59,102,0.12)] sm:px-10 sm:py-10">
      <div className="relative mx-auto h-12 w-44 sm:h-14 sm:w-52">
        <Image
          alt="Caixa"
          className="object-contain"
          fill
          priority
          sizes="208px"
          src="/assets/caixa-logo-transparent.png"
        />
      </div>

      <div className="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-brand">
        <CheckCircle2 aria-hidden="true" className="h-8 w-8" />
      </div>

      <h1 className="mt-5 text-[clamp(1.55rem,5.5vw,2.1rem)] font-black leading-tight tracking-[-0.02em] text-navy">
        Estamos adicionando seu atendimento
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base font-semibold leading-7 text-muted">
        Em instantes, um associado entrará em contato para apresentar os valores da sua simulação e orientar os próximos passos.
      </p>

      <div className="mt-8 border-t border-line pt-7">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand sm:text-xs">
          Enquanto sua simulação é preparada...
        </p>
        <h2 className="mt-3 text-[clamp(1.35rem,4.6vw,1.75rem)] font-black leading-tight tracking-[-0.01em] text-navy">
          Acompanhe Matheus Machado no Instagram
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm font-semibold leading-6 text-muted sm:text-base">
          Conteúdos sobre primeiro imóvel, financiamento e Minha Casa Minha Vida.
        </p>
        <Link
          aria-label="Seguir Matheus Machado no Instagram"
          className="mx-auto mt-6 inline-flex min-h-[54px] w-full max-w-sm items-center justify-center gap-2.5 rounded-full bg-[linear-gradient(90deg,#f58529_0%,#dd2a7b_40%,#8134af_75%,#515bd4_100%)] px-6 py-3 text-base font-black text-white shadow-[0_10px_24px_rgba(221,42,123,0.25)] transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          href="https://www.instagram.com/mhm.machado/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Camera className="h-6 w-6" aria-hidden="true" />
          Seguir no Instagram
        </Link>
        <p className="mt-3 text-sm font-bold text-navy">@mhm.machado</p>
      </div>
    </article>
  );
}
