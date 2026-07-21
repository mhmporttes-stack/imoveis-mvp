export default function manifest() {
  return {
    name: "Painel Matheus",
    short_name: "Painel",
    description: "Painel administrativo de imóveis, cadastros, depoimentos e simulações.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#F5F7FA",
    theme_color: "#0D3B66",
    categories: ["business", "productivity"],
    lang: "pt-BR",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/icon-maskable-512.png",
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
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }]
      },
      {
        name: "Simulações",
        short_name: "Simulações",
        description: "Abrir gerador de simulações",
        url: "/admin/simulacoes",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }]
      }
    ]
  };
}
