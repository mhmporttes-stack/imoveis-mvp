// Viewport da apresentação pública (/s/<token> → app/apresentacao/[token]). Fonte única, testada em
// tests/presentation-viewport.test.mjs.
//
// maximumScale: 1 — trava o ZOOM AUTOMÁTICO DE FOCO do iPhone (Safari e Chrome iOS, ambos WebKit): ao tocar num campo da
// folha "ESTRATÉGIA COM AMORTIZAÇÃO" a página ampliava ~1,3x e não voltava (a pinça já era bloqueada pelo
// `touch-action: pan-y` da .root). No iOS 10+ o maximum-scale NÃO impede a pinça manual (o Safari o ignora para o gesto
// do usuário), então a acessibilidade de zoom não piora. userScalable continua true (nunca emitir user-scalable=no).
// A prévia do corretor (/admin/simulacoes/[id]/apresentacao) herda o viewport do layout raiz, que já é maximumScale: 1.
// INCIDENTES.md, 2026-10-18.
export const PRESENTATION_VIEWPORT = Object.freeze({
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#071B31"
});
