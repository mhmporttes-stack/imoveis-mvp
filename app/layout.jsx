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
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
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
  themeColor: "#0D3B66"
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
