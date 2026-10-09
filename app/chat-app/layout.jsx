import { Manrope } from "next/font/google";

// Terceiro ícone da tela inicial (pedido do dono, 2026-10-09): "Chat", independente do
// "Painel". Só esta rota usa o manifesto/ícone do Chat; o resto do site continua com o
// manifesto do Painel (app/manifest.js + app/layout.jsx), que não foi alterado.
export const metadata = {
  title: "Chat",
  applicationName: "Chat",
  manifest: "/chat.webmanifest",
  appleWebApp: { capable: true, title: "Chat", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/icon-chat-192-v3-mm.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-chat-512-v3-mm.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/apple-touch-icon-chat-v3-mm.png", sizes: "180x180", type: "image/png" }]
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Chat",
    "apple-mobile-web-app-status-bar-style": "black-translucent"
  },
  robots: { index: false, follow: false }
};

// Mesma tipografia do painel (app/admin/layout.jsx) e o modo "só Chat" marcado antes da pintura.
const manrope = Manrope({ subsets: ["latin"], display: "swap" });
const FONT_CSS = `:root{--font-ui:${manrope.style.fontFamily}, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;}`;

export default function ChatAppLayout({ children }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: FONT_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: 'document.documentElement.setAttribute("data-mm-app","chat")' }} />
      {children}
    </>
  );
}
