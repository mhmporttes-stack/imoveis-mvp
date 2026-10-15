// Fundo da abertura da home (2026-10-15). Três opções para o dono escolher — troque em app/page.jsx (HERO_BACKGROUND).
// Todas usam só os azuis da marca (#08112E → #1F4CB3, destaque #4C8DF6) e ficam atrás de tudo (decorativas, aria-hidden).
//  A — degradê da marca + grão fino + brilho atrás do Matheus (profundidade sem imagem extra).
//  B — cidade desfocada (public/assets/hero-fundo-cidade.webp, gerada de hero-marilia.png) sob véu azul-marinho;
//      o véu é mais forte do lado do texto para o título continuar com contraste alto.
//  C — degradê + traço azul de baixa opacidade: grade de planta e uma fileira de casinhas na base, longe do título.

const BASE_GRADIENT =
  "bg-[radial-gradient(900px_760px_at_50%_86%,#1F4CB3_0%,#173A8E_30%,#0E2257_62%,#08112E_100%)] md:bg-[radial-gradient(900px_760px_at_74%_46%,#1F4CB3_0%,#173A8E_30%,#0E2257_62%,#08112E_100%)]";

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.6 -0.55'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Brilho atrás da foto: no celular a foto fica embaixo e centralizada; no computador, à direita.
const PHOTO_GLOW =
  "bg-[radial-gradient(260px_300px_at_50%_80%,rgba(76,141,246,0.42),transparent_72%)] md:bg-[radial-gradient(420px_460px_at_76%_55%,rgba(76,141,246,0.38),transparent_72%)]";

function Houses() {
  // Fileira de casas em traço simples (desenho próprio, sem marca). Baixa: fica abaixo dos selos, sem encostar no texto.
  return (
    <svg className="absolute bottom-0 left-0 h-[90px] w-[540px] max-w-none lg:h-[96px] lg:w-[576px]" viewBox="0 0 1140 190" fill="none" stroke="#4C8DF6" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M0 189 H1140" />
      <path d="M30 189 V120 L95 70 L160 120 V189 M70 189 V150 H120 V189 M48 122 H142" />
      <path d="M190 189 V100 H300 V189 M190 100 L245 62 L300 100 M212 128 H240 V152 H212 Z M258 128 H286 V152 H258 Z" />
      <path d="M330 189 V132 L380 96 L430 132 V189 M365 189 V160 H395 V189" />
      <path d="M460 189 V60 H560 V189 M480 80 H500 V96 H480 Z M520 80 H540 V96 H520 Z M480 112 H500 V128 H480 Z M520 112 H540 V128 H520 Z M480 144 H500 V160 H480 Z M520 144 H540 V160 H520 Z" />
      <path d="M590 189 V126 L650 84 L710 126 V189 M625 189 V156 H675 V189" />
      <path d="M740 189 V108 H860 V189 M740 108 L800 70 L860 108 M762 134 H790 V160 H762 Z M810 134 H838 V160 H810 Z" />
      <path d="M890 189 V136 L940 100 L990 136 V189 M925 189 V162 H955 V189" />
      <path d="M1020 189 V90 H1110 V189 M1040 110 H1060 V126 H1040 Z M1070 110 H1090 V126 H1070 Z M1040 142 H1060 V158 H1040 Z M1070 142 H1090 V158 H1070 Z" />
    </svg>
  );
}

function FloorPlan() {
  // Planta baixa esquemática atrás da foto (lado direito no computador).
  return (
    <svg className="absolute right-[-60px] top-[60px] hidden h-[560px] w-[560px] md:block" viewBox="0 0 400 400" fill="none" stroke="#4C8DF6" strokeWidth="1.2">
      <rect x="20" y="20" width="360" height="360" />
      <path d="M20 170 H170 V20 M170 120 V170 M230 20 V230 H380 M230 290 V380 M20 260 H120 M160 260 H230 V380 M300 230 V260" />
      <path d="M170 120 A50 50 0 0 1 120 170" strokeDasharray="4 4" />
      <path d="M230 260 A30 30 0 0 0 260 290" strokeDasharray="4 4" />
    </svg>
  );
}

export default function HeroBackground({ variant = "A" }) {
  if (variant === "B") {
    return (
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute inset-0 bg-[url('/assets/hero-fundo-cidade.webp')] bg-cover bg-[position:70%_center]" />
        {/* Véu: no celular escurece de cima (texto) para baixo; no computador, da esquerda (texto) para a direita (foto). */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,17,46,0.94)_0%,rgba(8,17,46,0.86)_50%,rgba(14,34,87,0.62)_100%)] md:bg-[linear-gradient(90deg,rgba(8,17,46,0.96)_0%,rgba(8,17,46,0.90)_42%,rgba(14,34,87,0.72)_100%)]" />
        <div className="absolute inset-0 bg-[#1F4CB3]/20 mix-blend-color" />
        <div className={`absolute inset-0 ${PHOTO_GLOW}`} />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#08112E]/70 to-transparent" />
      </div>
    );
  }

  if (variant === "C") {
    return (
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className={`absolute inset-0 ${BASE_GRADIENT}`} />
        {/* Grade de planta: some perto do título (máscara) para não poluir a leitura. */}
        <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(#4C8DF6_1px,transparent_1px),linear-gradient(90deg,#4C8DF6_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(70%_80%_at_80%_50%,#000_10%,transparent_75%)]" />
        <div className="absolute inset-0 opacity-[0.16]">
          <FloorPlan />
        </div>
        <div className="absolute inset-0 hidden opacity-[0.18] [mask-image:linear-gradient(90deg,#000_0%,#000_45%,transparent_70%)] md:block">
          <Houses />
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      <div className={`absolute inset-0 ${BASE_GRADIENT}`} />
      <div className={`absolute inset-0 ${PHOTO_GLOW}`} />
      <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: GRAIN }} />
    </div>
  );
}
