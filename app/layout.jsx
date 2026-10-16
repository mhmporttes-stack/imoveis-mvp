import "./globals.css";
import "./admin-theme-auto.css";
import "./admin-theme.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import AppChrome from "@/components/AppChrome";
import { CANONICAL_SITE_URL } from "@/lib/site-url.mjs";
import { ADMIN_THEME_BOOT_SCRIPT } from "@/components/admin-theme";

export const metadata = {
  // Base das URLs relativas de metadados (canônica, Open Graph): sempre o domínio da marca.
  metadataBase: new URL(CANONICAL_SITE_URL),
  title: "Matheus Machado - Corretor de Imóveis",
  description: "Empreendimentos imobiliários em Marília com atendimento consultivo.",
  applicationName: "Painel Matheus",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Painel Matheus",
    statusBarStyle: "black-translucent"
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32-mm.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192-mm.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512-mm.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/apple-touch-icon-mm.png", sizes: "180x180", type: "image/png" }]
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Matheus Machado Imóveis",
    images: [{ url: "https://www.matheusmachadoimoveis.com.br/assets/og-matheus-machado-v2.png", width: 1200, height: 630, alt: "Matheus Machado - Corretor de Imóveis" }]
  },
  twitter: {
    card: "summary_large_image",
    images: ["https://www.matheusmachadoimoveis.com.br/assets/og-matheus-machado-v2.png"]
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Painel Matheus",
    "apple-mobile-web-app-status-bar-style": "black-translucent"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#031D3A"
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        {/* Apps "Financeiro"/"Chat" (components/pwaHome.js): marca antes da pintura para esconder menus/ranking sem piscar. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var h=sessionStorage.getItem("mm_pwa_home")||"";var s=navigator.standalone===true||matchMedia("(display-mode: standalone)").matches;var a=h.indexOf("/admin/financeiro")===0?"financeiro":(h.indexOf("/admin/chat")===0||h.indexOf("/chat-app")===0)?"chat":"";if(location.pathname.indexOf("/chat-app")===0){a="chat";s=true}if(s&&a)document.documentElement.setAttribute("data-mm-app",a)}catch(e){}` }} />
        {/* Modo escuro do painel (components/admin-theme.js): só /admin, /chat-app e /dev, antes da pintura. */}
        <script dangerouslySetInnerHTML={{ __html: ADMIN_THEME_BOOT_SCRIPT }} />
        <AppChrome>{children}</AppChrome>
        {/* Instrumentação pura (zero HTML/CSS visível) — baseline de Core
            Web Vitals real (LCP/INP/CLS/TTFB/FCP) para a auditoria de
            performance 2026-10-01 e futuras repetições dela. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
