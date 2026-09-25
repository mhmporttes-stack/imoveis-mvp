import "./globals.css";
import AppChrome from "@/components/AppChrome";

export const metadata = {
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
    <html lang="pt-BR">
      <body>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
