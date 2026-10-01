// Gera o modelo de interação da skill "Central Machado" (V1 + V2) a partir do
// catálogo. Uso: node scripts/build-alexa-model.mjs > docs/alexa-interaction-model.json
// Importar no Console da Alexa (Build → Interaction Model → JSON Editor).
import { ETAPAS, TOPICS } from "../lib/alexa-v2/catalog.mjs";
import { PERIOD_IDS } from "../lib/alexa-v2/periods.mjs";

const PERIOD_VALUES = {
  hoje: { name: "hoje", synonyms: ["agora", "neste momento", "no dia de hoje", "do dia"] },
  ontem: { name: "ontem", synonyms: ["dia de ontem"] },
  amanha: { name: "amanhã", synonyms: ["amanha", "dia de amanhã"] },
  esta_semana: { name: "esta semana", synonyms: ["essa semana", "na semana", "da semana", "nesta semana", "semana atual"] },
  semana_passada: { name: "semana passada", synonyms: ["na semana passada", "da semana passada", "semana anterior"] },
  este_mes: { name: "este mês", synonyms: ["esse mês", "neste mês", "no mês", "do mês", "mês atual"] },
  mes_passado: { name: "mês passado", synonyms: ["no mês passado", "do mês passado", "mês anterior"] }
};

const ETAPA_SYNONYMS = {
  simulacao: ["aguardando simulação", "esperando simulação", "simulação", "simulações"],
  documentacao: ["documentos", "com documentação pendente", "documentação pendente", "documentações"],
  aprovacao: ["aguardando aprovação", "análise de crédito", "aprovação"],
  aprovados: ["aprovado", "com crédito aprovado"],
  reuniao: ["reuniões", "marcados para reunião"],
  atendimento: ["atendimento humano", "sendo atendidos"],
  venda: ["vendas", "fase de venda"],
  prospeccao: ["prospectando", "aguardando retorno"]
};

function dedupe(values) {
  const seen = new Set();
  return values.map((value) => {
    const synonyms = (value.synonyms || []).filter((s) => {
      const key = s.toLowerCase();
      if (seen.has(key) || key === value.name.toLowerCase()) return false;
      seen.add(key);
      return true;
    });
    seen.add(value.name.toLowerCase());
    return { id: value.id, name: { value: value.name, synonyms } };
  });
}

function topicValues() {
  const values = [];
  for (const [id, topic] of Object.entries(TOPICS)) {
    if (id === "etapa") continue;
    values.push({ id, name: topic.label, synonyms: topic.aliases || [] });
  }
  for (const [id, etapa] of Object.entries(ETAPAS)) {
    values.push({ id: `etapa_${id}`, name: `clientes em ${etapa.label}`, synonyms: (ETAPA_SYNONYMS[id] || []).map((s) => `clientes ${s}`) });
  }
  // nomes únicos: o rótulo do tópico pode repetir (ex.: "vendas")
  const names = new Set();
  return values.filter((v) => {
    const key = v.name.toLowerCase();
    if (names.has(key)) return false;
    names.add(key);
    return true;
  });
}

// Plano B (nomes fixos): AMAZON.FirstName não é garantido em pt-BR. Ao entrar um
// corretor novo, acrescente o primeiro nome aqui e reimporte o modelo.
const CORRETORES = ["Bencke", "Bruna", "Caroline", "Eduardo", "Izabela", "Jennyfer", "Ketlin", "Luan", "Lucas"];

const model = {
  interactionModel: {
    languageModel: {
      invocationName: "central machado",
      intents: [
        { name: "AMAZON.CancelIntent", samples: [] },
        { name: "AMAZON.HelpIntent", samples: [] },
        { name: "AMAZON.StopIntent", samples: [] },
        { name: "AMAZON.NavigateHomeIntent", samples: [] },
        { name: "AMAZON.FallbackIntent", samples: [] },
        { name: "AMAZON.NextIntent", samples: [] },
        { name: "AMAZON.RepeatIntent", samples: [] },
        // --- V1 (preservada) ---
        {
          name: "ResumoDoDiaIntent",
          samples: ["resumo do dia", "me dê um resumo", "me dê um resumo do dia", "como está o dia", "como estão as coisas", "resumo"]
        },
        {
          name: "AguardandoSimulacaoIntent",
          samples: ["quantos clientes aguardam simulação", "quantos clientes estão aguardando simulação", "clientes aguardando simulação", "tem cliente aguardando simulação"]
        },
        {
          name: "AguardandoDocumentacaoIntent",
          samples: ["quantos clientes aguardam documentação", "quantos clientes estão aguardando documentação", "documentações pendentes", "tem documentação pendente"]
        },
        {
          name: "AguardandoAprovacaoIntent",
          samples: ["quantos clientes aguardam aprovação", "quantos clientes estão aguardando aprovação", "clientes aguardando aprovação", "tem cliente para aprovar"]
        },
        { name: "ProximaReuniaoIntent", samples: ["qual é minha próxima reunião", "minha próxima reunião", "qual é meu próximo compromisso", "qual é a próxima reunião"] },
        // --- V2 ---
        {
          name: "ConsultarIntent",
          slots: [
            { name: "assunto", type: "ASSUNTO" },
            { name: "periodo", type: "PERIODO" },
            { name: "corretor", type: "CORRETOR" },
            { name: "etapa", type: "ETAPA" }
          ],
          samples: [
            "{assunto}",
            "como está {assunto}",
            "como estão {assunto}",
            "quantos {assunto}",
            "quantas {assunto}",
            "qual {assunto}",
            "qual é {assunto}",
            "me fale {assunto}",
            "{assunto} {periodo}",
            "{assunto} de {periodo}",
            "{assunto} na {periodo}",
            "quantos {assunto} {periodo}",
            "quantas {assunto} {periodo}",
            "como foi {assunto} {periodo}",
            "{assunto} do {corretor}",
            "{assunto} da {corretor}",
            "{assunto} do {corretor} {periodo}",
            "{assunto} da {corretor} {periodo}",
            "quantos clientes em {etapa}",
            "quantos clientes estão em {etapa}",
            "quantos clientes em {etapa} {periodo}",
            "quantos",
            "quantas",
            "quantos são",
            "quantas são",
            "qual o total"
          ]
        },
        {
          name: "ListarIntent",
          slots: [
            { name: "assunto", type: "ASSUNTO" },
            { name: "periodo", type: "PERIODO" },
            { name: "corretor", type: "CORRETOR" }
          ],
          samples: [
            "quem são",
            "quem são eles",
            "quem foram",
            "quais são",
            "quais são eles",
            "me diga os nomes",
            "quem são {assunto}",
            "quais são {assunto}",
            "quem são {assunto} {periodo}",
            "liste {assunto}",
            "liste {assunto} {periodo}",
            "me diga {assunto}",
            "quem são os clientes de {assunto}",
            "quem aguarda {assunto}",
            "quem são {assunto} do {corretor}",
            "quem são {assunto} da {corretor}"
          ]
        },
        {
          name: "ContinuaIntent",
          slots: [
            { name: "assunto", type: "ASSUNTO" },
            { name: "periodo", type: "PERIODO" },
            { name: "corretor", type: "CORRETOR" }
          ],
          samples: [
            "e {periodo}",
            "e {assunto}",
            "e {assunto} {periodo}",
            "e o {corretor}",
            "e a {corretor}",
            "e {corretor}",
            "e do {corretor}",
            "e da {corretor}",
            "e para {periodo}",
            "e quanto a {assunto}",
            "e sobre {assunto}",
            "e na {periodo}",
            "e no {periodo}",
            "agora {periodo}",
            "agora {assunto}"
          ]
        },
        {
          name: "MaisIntent",
          samples: ["mais", "mais nomes", "continue", "continua", "pode continuar", "quais mais", "tem mais", "e os outros", "o resto", "próximos"]
        },
        {
          name: "ResumoIntent",
          samples: ["resumo geral", "como estamos", "me dê um panorama", "panorama do escritório", "como está o escritório"]
        }
      ],
      types: [
        { name: "ASSUNTO", values: dedupe(topicValues()) },
        {
          name: "PERIODO",
          values: dedupe(PERIOD_IDS.map((id) => ({ id, ...PERIOD_VALUES[id] })))
        },
        { name: "CORRETOR", values: CORRETORES.map((name) => ({ name: { value: name, synonyms: [] } })) },
        {
          name: "ETAPA",
          values: dedupe(Object.entries(ETAPAS).map(([id, etapa]) => ({ id, name: etapa.label, synonyms: ETAPA_SYNONYMS[id] || [] })))
        }
      ]
    }
  }
};

process.stdout.write(JSON.stringify(model, null, 2) + "\n");
