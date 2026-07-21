import Link from "next/link";
import { Camera, CheckCircle2 } from "lucide-react";

export default function SimulationSuccess() {
  return (
    <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-6 text-center shadow-soft sm:p-10 lg:p-12">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand text-white shadow-[0_18px_45px_rgba(13,59,102,0.18)]">
        <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
      </span>
      <h1 className="mx-auto mt-7 max-w-2xl text-[clamp(2rem,4vw,3rem)] font-black leading-tight text-navy">
        Recebemos suas informações com sucesso!
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg font-bold leading-8 text-navy">
        Sua solicitação de simulação foi enviada para análise.
      </p>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
        Seus dados serão analisados por uma correspondente credenciada da Caixa Econômica Federal.
        Assim que a análise for concluída, entraremos em contato para apresentar as melhores
        condições disponíveis para o seu perfil.
      </p>

      <div className="mx-auto mt-9 max-w-2xl border-t border-line pt-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">
          Enquanto sua simulação é preparada...
        </p>
        <h2 className="mt-3 text-[clamp(1.5rem,3vw,2.2rem)] font-black leading-tight text-navy">
          Conheça melhor o seu corretor.
        </h2>
        <p className="mt-4 text-base leading-7 text-muted">
          No meu Instagram, compartilho dicas sobre financiamento imobiliário, informações sobre
          o Minha Casa Minha Vida, novidades dos empreendimentos e conteúdos que podem ajudar você
          a conquistar seu imóvel.
        </p>
        <Link
          aria-label="Conhecer o Instagram de Matheus Machado"
          className="mt-7 inline-flex min-h-[52px] items-center justify-center rounded-full bg-brand px-7 py-3 text-base font-black text-white shadow-[0_18px_45px_rgba(13,59,102,0.18)] transition duration-200 hover:-translate-y-0.5 hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          href="https://www.instagram.com/mhm.machado/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Camera className="mr-2 h-5 w-5" aria-hidden="true" />
          Conhecer meu Instagram
        </Link>
      </div>
    </article>
  );
}
