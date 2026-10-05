// Prévia de compartilhamento (WhatsApp, Instagram, Facebook, X) do link /s/<token> da apresentação interativa.
// REGRA OFICIAL (dono, 2026-10-05, PRES-18): título e imagem levam SÓ o PRIMEIRO NOME do cliente; nunca sobrenome,
// valores, imóvel, telefone nem outro dado. Token inválido/revogado = sem nome (e a página responde 404).
import { readFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { ImageResponse } from "next/og.js";
import { firstNameOf } from "./simulation-presentation-core.mjs";
import { BRAND_NAME, BRAND_ROLE } from "./simulation-presentation-documents.mjs";

const h = React.createElement;
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };
const GENERIC_TITLE = "Sua simulação de financiamento está pronta";
const SUBTITLE = "Matheus Machado · Corretor de imóveis";
const IMAGE_ALT = "Sua simulação de financiamento está pronta | Matheus Machado, Corretor de Imóveis";

export function shareFirstName(dto) {
  const scene = dto?.scenes?.find?.((item) => item?.id === "abertura");
  return firstNameOf(scene?.firstName);
}

export function shareTitleFor(firstName) {
  const name = firstNameOf(firstName);
  return name ? `${name}, sua simulação de financiamento está pronta` : GENERIC_TITLE;
}

/** Metadata do Next para a página /s/<token>. `origin` fixo do site; a imagem é a rota por token (/s/<token>/og). */
export function buildShareMetadata({ token, firstName, origin = "https://www.matheusmachadoimoveis.com.br" }) {
  const title = shareTitleFor(firstName);
  const image = `${origin}/s/${token}/og`;
  return {
    title,
    description: SUBTITLE,
    robots: { index: false, follow: false, nocache: true, noarchive: true },
    referrer: "no-referrer",
    openGraph: {
      type: "website",
      title,
      description: SUBTITLE,
      siteName: "Matheus Machado Imóveis",
      locale: "pt_BR",
      images: [{ url: image, secureUrl: image, width: 1200, height: 630, type: "image/png", alt: IMAGE_ALT }]
    },
    twitter: { card: "summary_large_image", title, description: SUBTITLE, images: [{ url: image, alt: IMAGE_ALT }] }
  };
}

let symbolPromise = null;
function loadSymbol() {
  if (!symbolPromise) {
    symbolPromise = readFile(path.join(process.cwd(), "public", "assets", "matheus-machado-symbol.png"))
      .then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`)
      .catch((error) => {
        symbolPromise = null;
        throw error;
      });
  }
  return symbolPromise;
}

const box = (style, ...children) => h("div", { style: { display: "flex", ...style } }, ...children);
// A fonte padrão do next/og só tem peso regular: "negrito" por sombra sem desfoque (como nas outras imagens).
const text = (value, { size, color, bold = false, spacing = 0, style = {} }) =>
  h("div", { style: { display: "flex", fontSize: size, color, letterSpacing: spacing, lineHeight: 1.15, ...(bold ? { textShadow: `${Math.max(0.6, size * 0.025)}px 0 0 ${color}, -${Math.max(0.6, size * 0.025)}px 0 0 ${color}` } : {}), ...style } }, value);

export async function renderShareImage(firstName) {
  const symbol = await loadSymbol();
  const title = shareTitleFor(firstName);
  const size = title.length > 46 ? 62 : 72;
  const tree = box(
    { width: 1200, height: 630, flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", backgroundImage: "linear-gradient(135deg, #0B2C57 0%, #071B31 70%)" },
    box(
      { alignItems: "center" },
      h("img", { src: symbol, width: 96, height: 76, style: { width: 96, height: 76, marginRight: 28 } }),
      box({ flexDirection: "column" }, text(BRAND_NAME, { size: 44, color: "#E4E6EA", bold: true, spacing: 6 }), text(BRAND_ROLE, { size: 22, color: "#B8C2D0", spacing: 8, style: { marginTop: 6 } }))
    ),
    box({ flexDirection: "column" }, text(title, { size, color: "#FFFFFF", bold: true, style: { maxWidth: 1056 } }), box({ width: 150, height: 6, backgroundColor: "#3A78C9", marginTop: 36 })),
    text(SUBTITLE, { size: 38, color: "#9CC3F5" })
  );
  return new ImageResponse(tree, {
    ...SHARE_IMAGE_SIZE,
    headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "Content-Disposition": 'inline; filename="previa.png"' }
  });
}
