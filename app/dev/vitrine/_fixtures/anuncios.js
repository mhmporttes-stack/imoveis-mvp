// Área Anúncios (components/ads/AdsBoard.jsx) — dados de exemplo para a
// vitrine (somente `next dev`). Números no formato e na ordem de grandeza
// dos anúncios reais da conta (7 dias), sem nenhum dado de cliente.
// Aparência: versão B (clara), escolhida pelo dono em 2026-10-13.

const ads = [
  {
    id: "ad-1", name: "Eco Village | Vídeo aluguel | Simulação completa", campaignName: "SITE | Marília | PATROCINADO | Vídeo", campaignShort: "Site · Vídeo", adsetName: "Marília 18-55",
    status: "active", statusLabel: "Ativo na Meta", kind: "cadastro", thumbnailUrl: "/assets/hero-premium-casal.png",
    metrics: { spend: 176.93, results: 27, costPerResult: 6.55, crmLeads: 13, crmCostPerLead: 13.61, reach: 12390, impressions: 17228, frequency: 1.39, clicks: 289, linkClicks: 241, ctr: 1.68, cpm: 10.27, cpc: 0.61 },
    health: { tone: "good" },
    recommendations: [{ tone: "good", title: "Manter", detail: "Custo por lead na média da conta, com 27 cadastros e 13 clientes no CRM." }]
  },
  {
    id: "ad-2", name: "Carrossel aluguel casa própria | WhatsApp oficial", campaignName: "WHATSAPP | Marília | PATROCINADO | Carrossel", campaignShort: "WhatsApp · Carrossel", adsetName: "Marília 18-55",
    status: "active", statusLabel: "Ativo na Meta", kind: "whatsapp", thumbnailUrl: "/assets/hero-marilia.png",
    metrics: { spend: 11.08, results: 2, costPerResult: 5.54, crmLeads: 0, crmCostPerLead: null, reach: 467, impressions: 1050, frequency: 2.25, clicks: 4, linkClicks: 4, ctr: 0.38, cpm: 10.55, cpc: 2.77 },
    health: { tone: "bad" },
    recommendations: [
      { tone: "bad", title: "Mesmas pessoas vendo demais", detail: "Cada pessoa viu o anúncio 2,3 vezes. Acima de 2 o público cansa e o custo sobe." },
      { tone: "warn", title: "Pouca gente clicando", detail: "CTR de 0,38%, abaixo de 0,84% (os 25% piores da conta). Vale testar outro criativo." }
    ]
  },
  {
    id: "ad-3", name: "Eco Village | Vídeo | WhatsApp oficial", campaignName: "WHATSAPP | Marília | PATROCINADO | Vídeo", campaignShort: "WhatsApp · Vídeo", adsetName: "Marília 18-55",
    status: "paused", statusLabel: "Campanha pausada", kind: "whatsapp", thumbnailUrl: "/assets/og-simulacao-v3.png",
    metrics: { spend: 126.5, results: 28, costPerResult: 4.52, crmLeads: 15, crmCostPerLead: 8.43, reach: 3815, impressions: 5914, frequency: 1.55, clicks: 96, linkClicks: 90, ctr: 1.62, cpm: 21.39, cpc: 1.32 },
    health: { tone: "warn" },
    recommendations: [
      { tone: "good", title: "Conversa barata", detail: "R$ 4,52 por conversa e 15 clientes no CRM." },
      { tone: "warn", title: "Público começando a cansar", detail: "Frequência 1,55 e CPM o dobro da média (R$ 10,66)." }
    ]
  },
  {
    id: "ad-4", name: "Eco Village | Carrossel 10 fotos | WhatsApp", campaignName: "WHATSAPP | Marília | Ecovillage | Conversas", campaignShort: "WhatsApp · Carrossel", adsetName: "Marília 18-53",
    status: "paused", statusLabel: "Conjunto pausado", kind: "whatsapp", thumbnailUrl: "",
    metrics: { spend: 24.51, results: 3, costPerResult: 8.17, crmLeads: 0, crmCostPerLead: null, reach: 1657, impressions: 2502, frequency: 1.51, clicks: 35, linkClicks: 31, ctr: 1.4, cpm: 9.8, cpc: 0.7 },
    health: { tone: "warn" },
    recommendations: [{ tone: "warn", title: "Custo acima da média", detail: "R$ 8,17 por conversa, 47% acima da média da conta, e nenhum cliente no CRM." }]
  },
  {
    id: "ad-5", name: "Eco Village | Carrossel 10 fotos | Formulário site", campaignName: "SITE | Marília | Ecovillage | Formulário", campaignShort: "Site · Carrossel", adsetName: "Marília 18-53",
    status: "active", statusLabel: "Ativo na Meta", kind: "cadastro", thumbnailUrl: "/assets/hero-premium-casal.png",
    metrics: { spend: 10.35, results: 0, costPerResult: null, crmLeads: 0, crmCostPerLead: null, reach: 1338, impressions: 1565, frequency: 1.17, clicks: 26, linkClicks: 22, ctr: 1.66, cpm: 6.61, cpc: 0.4 },
    health: { tone: "neutral" },
    recommendations: [{ tone: "neutral", title: "Ainda aprendendo", detail: "Só 1 dia e R$ 10 investidos. Aguarde mais dados antes de decidir." }]
  },
  {
    id: "ad-6", name: "Primeiro imóvel | Vídeo Matheus | Formulário", campaignName: "SITE | Marília | PATROCINADO | Vídeo", campaignShort: "Site · Vídeo", adsetName: "Marília 18-55",
    status: "active", statusLabel: "Ativo na Meta", kind: "cadastro", thumbnailUrl: "/assets/hero-marilia.png",
    metrics: { spend: 64.2, results: 11, costPerResult: 5.84, crmLeads: 6, crmCostPerLead: 10.7, reach: 4980, impressions: 6120, frequency: 1.23, clicks: 131, linkClicks: 118, ctr: 2.14, cpm: 10.49, cpc: 0.49 },
    health: { tone: "good" },
    recommendations: [{ tone: "good", title: "Vencedor", detail: "Custo abaixo da média e 6 clientes no CRM. Candidato a mais verba (decisão sua)." }]
  },
  {
    // Caso-limite para a revisão visual: título muito longo e valores grandes.
    id: "ad-7", name: "Minha Casa Minha Vida | Vídeo depoimento família completa | Entrada facilitada | Formulário site Marília e região", campaignName: "SITE | Marília e região | PATROCINADO | Vídeo depoimento | Público amplo 18-60 | Advantage+", campaignShort: "Site · Vídeo depoimento", adsetName: "Marília e região 18-60 | Advantage+ | Interesses imóveis",
    status: "active", statusLabel: "Ativo na Meta", kind: "cadastro", thumbnailUrl: "/assets/hero-marilia.png",
    metrics: { spend: 1234.56, results: 1250, costPerResult: 0.99, crmLeads: 312, crmCostPerLead: 3.96, reach: 184320, impressions: 412870, frequency: 12.4, clicks: 9876, linkClicks: 8790, ctr: 2.39, cpm: 2.99, cpc: 0.14 },
    health: { tone: "warn" },
    recommendations: [{ tone: "warn", title: "Público vendo demais", detail: "Cada pessoa viu o anúncio 12,4 vezes. Acima de 2 o público cansa e o custo sobe." }]
  },
  {
    id: "ad-8", name: "Loteamento | Imagem única | WhatsApp oficial", campaignName: "WHATSAPP | Marília | Loteamento | Conversas", campaignShort: "WhatsApp · Imagem", adsetName: "Marília 25-60",
    status: "active", statusLabel: "Ativo na Meta", kind: "whatsapp", thumbnailUrl: "/assets/og-simulacao-v3.png",
    metrics: { spend: 987.65, results: 8, costPerResult: 123.46, crmLeads: null, crmCostPerLead: null, reach: 22140, impressions: 30115, frequency: 1.36, clicks: 210, linkClicks: 188, ctr: 0.7, cpm: 32.8, cpc: 4.7 },
    health: { tone: "bad" },
    recommendations: [{ tone: "bad", title: "Custo muito alto", detail: "R$ 123,46 por conversa, muito acima da média da conta." }]
  }
];

export const data = {
  syncedAtLabel: "hoje às 15:00",
  summary: { spend: 2635.78, results: 1329, costPerResult: 1.98, activeCount: 6 },
  ads
};

export const routes = [{ match: /^\/api\/admin\/anuncios/, response: () => data }];
