export default function manifest() {
  return {
    name: "Painel Matheus",
    short_name: "Painel",
    description: "Painel administrativo de imóveis, cadastros, depoimentos e simulações.",
    start_url: "/admin/simulacoes",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#031D3A",
    theme_color: "#031D3A",
    categories: ["business", "productivity"],
    lang: "pt-BR",
    icons: [
      {
        src: "/icons/icon-192-mm.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512-mm.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-maskable-192-mm.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/icon-maskable-512-mm.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ],
    shortcuts: [
      {
        name: "Cadastros",
        short_name: "Cadastros",
        description: "Abrir cadastros de simulação",
        url: "/admin/cadastros",
        icons: [{ src: "/icons/icon-192-mm.png", sizes: "192x192" }]
      },
      {
        name: "Simulações",
        short_name: "Simulações",
        description: "Abrir gerador de simulações",
        url: "/admin/simulacoes",
        icons: [{ src: "/icons/icon-192-mm.png", sizes: "192x192" }]
      }
    ]
  };
}
