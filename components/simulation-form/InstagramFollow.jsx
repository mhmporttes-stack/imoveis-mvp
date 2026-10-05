import Link from "next/link";
import { Camera } from "lucide-react";

// Convite para seguir o Instagram do Matheus (telas finais da simulação). Só o botão usa o degradê do Instagram;
// o resto segue a identidade azul e branca.
export default function InstagramFollow({ eyebrow = "", heading = "Acompanhe Matheus Machado no Instagram", compact = false }) {
  return (
    <div className={compact ? "mt-7 border-t border-line pt-6" : "mt-8 border-t border-line pt-7"}>
      {eyebrow ? <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand sm:text-xs">{eyebrow}</p> : null}
      <h2 className={`${eyebrow ? "mt-3" : ""} text-[clamp(1.2rem,4.4vw,1.6rem)] font-black leading-tight tracking-[-0.01em] text-navy`}>
        {heading}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm font-semibold leading-6 text-muted sm:text-base">
        Conteúdos sobre primeiro imóvel, financiamento e Minha Casa Minha Vida.
      </p>
      <Link
        aria-label="Seguir Matheus Machado no Instagram"
        className="mx-auto mt-5 inline-flex min-h-[54px] w-full max-w-sm items-center justify-center gap-2.5 rounded-full bg-[linear-gradient(90deg,#f58529_0%,#dd2a7b_40%,#8134af_75%,#515bd4_100%)] px-6 py-3 text-base font-black text-white shadow-[0_10px_24px_rgba(221,42,123,0.25)] transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        href="https://www.instagram.com/mhm.machado/"
        rel="noopener noreferrer"
        target="_blank"
      >
        <Camera className="h-6 w-6" aria-hidden="true" />
        Seguir no Instagram
      </Link>
    </div>
  );
}
