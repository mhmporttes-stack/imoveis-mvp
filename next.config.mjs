import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Arquivos `*.dev.jsx` (ex.: a vitrine de componentes em app/dev/vitrine)
// só viram rota no `next dev`. No `next build` (Vercel/produção) eles não
// são compilados nem expostos — ver .claude/skills/design-crm/references/revisao-visual.md.
const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

/** @type {(phase: string) => import('next').NextConfig} */
export default function nextConfig(phase) {
  return {
    images: {
      unoptimized: true
    },
    pageExtensions:
      phase === PHASE_DEVELOPMENT_SERVER ? ["dev.jsx", ...DEFAULT_PAGE_EXTENSIONS] : DEFAULT_PAGE_EXTENSIONS
  };
}
