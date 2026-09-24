import { emptyGraph } from "../../lib/whatsapp-flow-core.mjs";

// Modelos para começar um fluxo sem partir do zero. Cada um devolve
// { name, trigger, graph } já válido para ativar (o usuário só ajusta os textos).

function edge(from, port, to) {
  return { id: `${from}-${port}-${to}`, from, port, to };
}

const TEMPLATES = [
  {
    key: "blank",
    title: "Em branco",
    description: "Comece do zero e monte do seu jeito.",
    build: () => ({ name: "Novo fluxo", trigger: { type: "keyword", keywords: [], match: "contains", cooldownHours: 0 }, graph: emptyGraph() })
  },
  {
    key: "welcome",
    title: "Boas-vindas com botões",
    description: "Recebe o contato novo, oferece simular ou falar com um corretor.",
    build: () => ({
      name: "Boas-vindas",
      trigger: { type: "first_message", keywords: [], match: "contains", cooldownHours: 24 },
      graph: {
        nodes: [
          { id: "start", type: "start", x: 40, y: 120, data: {} },
          {
            id: "m1", type: "message", x: 380, y: 60,
            data: {
              mode: "buttons",
              text: "Olá, {{primeiro_nome}}! 👋 Sou da equipe do Matheus Machado Imóveis. Como posso te ajudar?",
              footer: "", imageUrl: "", listButton: "Ver opções", items: [], linkLabel: "", linkUrl: "",
              buttons: [{ id: "b1", title: "Quero simular" }, { id: "b2", title: "Falar com corretor" }],
              followUp: { enabled: false, amount: 2, unit: "hours" }
            }
          },
          { id: "a1", type: "action", x: 740, y: 20, data: { actions: [{ type: "roulette" }] } },
          {
            id: "m2", type: "message", x: 1100, y: 20,
            data: {
              mode: "link",
              text: "Perfeito! Faça sua simulação por aqui — é rápido e sem compromisso. Um corretor vai te acompanhar.",
              footer: "", imageUrl: "", buttons: [], listButton: "Ver opções", items: [],
              linkLabel: "Fazer simulação", linkUrl: "{{link_simulacao}}",
              followUp: { enabled: false, amount: 2, unit: "hours" }
            }
          },
          { id: "a2", type: "action", x: 740, y: 300, data: { actions: [{ type: "roulette" }, { type: "handoff" }] } }
        ],
        edges: [edge("start", "next", "m1"), edge("m1", "b1", "a1"), edge("a1", "next", "m2"), edge("m1", "b2", "a2")]
      }
    })
  },
  {
    key: "after-hours",
    title: "Fora do horário comercial",
    description: "Avisa que o time responde no próximo dia útil e já adianta o link de simulação.",
    build: () => ({
      name: "Fora do horário",
      trigger: { type: "any_message", keywords: [], match: "contains", cooldownHours: 12 },
      graph: {
        nodes: [
          { id: "start", type: "start", x: 40, y: 120, data: {} },
          { id: "c1", type: "condition", x: 380, y: 100, data: { kind: "business_hours", start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] } },
          {
            id: "m1", type: "message", x: 740, y: 200,
            data: {
              mode: "link",
              text: "Olá, {{primeiro_nome}}! Nosso time responde em horário comercial (seg a sex, 9h às 18h). Enquanto isso, você já pode fazer sua simulação:",
              footer: "", imageUrl: "", buttons: [], listButton: "Ver opções", items: [],
              linkLabel: "Fazer simulação", linkUrl: "{{link_simulacao}}",
              followUp: { enabled: false, amount: 2, unit: "hours" }
            }
          }
        ],
        edges: [edge("start", "next", "c1"), edge("c1", "no", "m1")]
      }
    })
  },
  {
    key: "qualify",
    title: "Qualificação por lista",
    description: "Pergunta o interesse em uma lista e encaminha para a roleta.",
    build: () => ({
      name: "Qualificação",
      trigger: { type: "ad_referral", keywords: [], match: "contains", cooldownHours: 0 },
      graph: {
        nodes: [
          { id: "start", type: "start", x: 40, y: 120, data: {} },
          {
            id: "m1", type: "message", x: 380, y: 80,
            data: {
              mode: "list",
              text: "Oi, {{primeiro_nome}}! Que bom que você chamou. Qual é o seu objetivo?",
              footer: "", imageUrl: "", buttons: [], linkLabel: "", linkUrl: "",
              listButton: "Escolher",
              items: [
                { id: "i1", title: "Comprar meu 1º imóvel", description: "Financiamento e subsídio" },
                { id: "i2", title: "Trocar de imóvel", description: "" },
                { id: "i3", title: "Investir", description: "" }
              ],
              followUp: { enabled: true, amount: 2, unit: "hours" }
            }
          },
          { id: "a1", type: "action", x: 760, y: 40, data: { actions: [{ type: "roulette" }, { type: "tag", tag: "Lead de anúncio" }] } },
          {
            id: "m2", type: "message", x: 1120, y: 40,
            data: {
              mode: "link",
              text: "Ótimo! Faça a simulação para eu já preparar as melhores opções:",
              footer: "", imageUrl: "", buttons: [], listButton: "Ver opções", items: [],
              linkLabel: "Fazer simulação", linkUrl: "{{link_simulacao}}",
              followUp: { enabled: false, amount: 2, unit: "hours" }
            }
          },
          { id: "m3", type: "message", x: 760, y: 340, data: { mode: "text", text: "Ainda por aí? Quando quiser, é só responder essa mensagem. 🙂", footer: "", imageUrl: "", buttons: [], listButton: "Ver opções", items: [], linkLabel: "", linkUrl: "", followUp: { enabled: false, amount: 2, unit: "hours" } } }
        ],
        edges: [
          edge("start", "next", "m1"), edge("m1", "i1", "a1"), edge("m1", "i2", "a1"), edge("m1", "i3", "a1"),
          edge("a1", "next", "m2"), edge("m1", "no_reply", "m3")
        ]
      }
    })
  }
];

export function listFlowTemplates() {
  return TEMPLATES.map(({ key, title, description }) => ({ key, title, description }));
}

export function buildFlowFromTemplate(key) {
  const template = TEMPLATES.find((item) => item.key === key) || TEMPLATES[0];
  return template.build();
}
