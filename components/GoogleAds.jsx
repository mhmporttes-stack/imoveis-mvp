"use client";

import Script from "next/script";
import { GOOGLE_ADS_ID } from "@/lib/google-ads-client.mjs";

// gtag.js global do Google Ads (campanha de aplicativos, dono 2026-11-02) — montado só nas páginas PÚBLICAS (ver AppChrome.jsx:
// nunca dentro de /admin). Sem NEXT_PUBLIC_GOOGLE_ADS_ID (AW-XXXXXXXXX) não renderiza nada. A conversão em si não sai daqui:
// é disparada no sucesso do cadastro por trackGoogleAdsLead (lib/google-ads-client.mjs).
export default function GoogleAds() {
  if (!GOOGLE_ADS_ID) return null;

  return (
    <>
      <Script id="google-ads-gtag-src" src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`} strategy="afterInteractive" />
      <Script id="google-ads-gtag-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${GOOGLE_ADS_ID}');`}
      </Script>
    </>
  );
}
