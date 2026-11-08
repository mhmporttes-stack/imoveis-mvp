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
    // Zips das extensões do dono (EXT-1): baixados pela tela Extensões (rota lê o arquivo do disco).
    outputFileTracingIncludes: {
      "/api/admin/extensoes/download": ["./ferramentas/*.zip"]
    },
    // Telas de entrada do painel: o endereço público é /admin/login e /admin/reset-password, o código mora em
    // app/painel-acesso. Na Vercel quem reescreve é o proxy.js; no servidor local (MM_PRODUCTION_HOST=1, atrás do túnel)
    // o proxy não reescreve (o Next trata rewrite do proxy como chamada HTTP a si mesmo e entra em ciclo) — vale este.
    async rewrites() {
      return {
        beforeFiles: ["login", "reset-password"].flatMap((name) => [
          { source: `/admin/${name}`, destination: `/painel-acesso/${name}` },
          { source: `/admin/${name}/:path*`, destination: `/painel-acesso/${name}/:path*` }
        ])
      };
    },
    pageExtensions:
      phase === PHASE_DEVELOPMENT_SERVER ? ["dev.jsx", ...DEFAULT_PAGE_EXTENSIONS] : DEFAULT_PAGE_EXTENSIONS
  };
}
