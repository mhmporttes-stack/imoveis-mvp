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
      { url: "/icons/icon-chat-192-mm.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-chat-512-mm.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/apple-touch-icon-chat-mm.png", sizes: "180x180", type: "image/png" }]
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Chat",
    "apple-mobile-web-app-status-bar-style": "black-translucent"
  },
  robots: { index: false, follow: false }
};

export default function ChatLayout({ children }) {
  return children;
}
