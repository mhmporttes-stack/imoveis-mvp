import { ETAPAS, TOPICS } from "./catalog.mjs";
import { PERIOD_IDS } from "./periods.mjs";
import { BROKER_ALIASES } from "./broker-aliases.mjs";
import { normalizeName } from "./brokers.mjs";

// GERADOR ÚNICO do modelo de interação da skill "Central" (V1 + V2 + V3).
// Puro: sem banco. Os corretores entram como parâmetro (vindos do cadastro do
// CRM pela rota /api/admin/alexa/model, ou do arquivo local do script).
// Para incluir um corretor novo: ele já vem do cadastro; só é preciso gerar o
// modelo de novo e importar no Console (apelidos ficam em broker-aliases.mjs).

export const INVOCATION_NAME = "central";

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

// Variações faladas COM acento (o catálogo guarda aliases sem acento para o texto livre).
const SPOKEN = {
  meta_equipe: ["meta diária", "meta de hoje", "meta do dia", "percentual da meta", "porcentagem da meta"],
  meta_faltam: ["abaixo da meta", "quem está abaixo da meta", "quem não bateu a meta"],
  sem_prospeccao: ["sem atividade", "quem está sem atividade", "quem não prospectou hoje"],
  vendas: ["vendas feitas", "quem vendeu"],
  equipe_resumo: ["como está minha equipe", "como está a equipe", "como está o time", "situação da equipe", "minha equipe"],
  med_atendimentos: ["atendimentos iniciados", "atendimentos feitos"],
  med_simulacoes: ["simulações enviadas", "simulações feitas", "quem fez mais simulações"],
  med_documentacao: ["documentações", "documentação recebida", "documentos recebidos"],
  med_aprovacao: ["clientes foram para aprovação", "clientes enviados para aprovação", "aprovações enviadas"],
  med_reunioes: ["reuniões feitas", "clientes para reunião"],
  prospeccao_faltam: ["prospecções que faltam", "quantas prospecções faltam", "faltam prospecções", "prospecções restantes"],
  posicao_ranking: ["posição no ranking", "posição", "colocação no ranking", "lugar no ranking"],
  atividades_atrasadas: ["atividades atrasadas", "atividade atrasada", "tarefas atrasadas"],
  acao_pendente: ["clientes aguardando ação", "clientes aguardando atendimento", "quem tem clientes aguardando atendimento"],
  compromissos: ["compromissos", "atividades agendadas"],
  agenda: ["reunião", "reuniões marcadas", "agenda do dia", "agenda"],
  quem_reuniao: ["quem tem reunião", "quem tem reuniões"]
};

function dedupe(values) {
  const seen = new Set();
  return values.map((value) => {
    const synonyms = (value.synonyms || []).filter((s) => {
      const key = String(s).toLowerCase();
      if (!key || seen.has(key) || key === value.name.toLowerCase()) return false;
      seen.add(key);
      return true;
    });
    seen.add(value.name.toLowerCase());
    const entry = { name: { value: value.name, synonyms } };
    if (value.id) entry.id = value.id;
    return value.id ? { id: value.id, name: entry.name } : { name: entry.name };
  });
}

function topicValues() {
  const values = [];
  for (const [id, topic] of Object.entries(TOPICS)) {
    if (id === "etapa" || topic.hidden) continue;
    values.push({ id, name: topic.label, synonyms: [...(topic.aliases || []), ...(SPOKEN[id] || [])] });
  }
  for (const [id, etapa] of Object.entries(ETAPAS)) {
    values.push({ id: `etapa_${id}`, name: `clientes em ${etapa.label}`, synonyms: (ETAPA_SYNONYMS[id] || []).map((s) => `clientes ${s}`) });
  }
  const names = new Set();
  return values.filter((v) => {
    const key = v.name.toLowerCase();
    if (names.has(key)) return false;
    names.add(key);
    return true;
  });
}

const capitalize = (text) => (text ? text[0].toLocaleUpperCase("pt-BR") + text.slice(1) : "");

// Valor do slot CORRETOR: id do cadastro (o roteador usa o id), primeiro nome como valor,
// e como sinônimos o nome completo, primeiro+último e os apelidos do catálogo central.
export function brokerSlotValues(brokers) {
  const used = new Map();
  for (const broker of brokers) {
    const first = String(broker.name || broker.fullName || "").trim().split(/\s+/)[0];
    if (first) used.set(normalizeName(first), (used.get(normalizeName(first)) || 0) + 1);
  }
  const values = [];
  for (const broker of brokers) {
    const full = String(broker.fullName || broker.name || "").trim();
    const parts = full.split(/\s+/).filter(Boolean);
    const first = capitalize(parts[0] || broker.name || "");
    if (!first) continue;
    const synonyms = [];
    const duplicatedFirst = (used.get(normalizeName(first)) || 0) > 1;
    if (parts.length > 1) {
      synonyms.push(full, `${parts[0]} ${parts[parts.length - 1]}`);
    }
    if (!duplicatedFirst) for (const alias of BROKER_ALIASES[normalizeName(first)] || []) synonyms.push(capitalize(alias));
    for (const alias of broker.aliases || []) synonyms.push(alias);
    // Dois corretores com o mesmo primeiro nome: o valor passa a ser o nome completo.
    values.push({ id: broker.id || "", name: duplicatedFirst && full ? full : first, synonyms });
  }
  return dedupe(values.map((v) => ({ ...v, id: v.id || undefined })));
}

// Snapshot local usado pelo script quando não há acesso ao cadastro (ver scripts/).
export const DEFAULT_BROKERS = ["Bencke", "Bruna", "Caroline", "Eduardo", "Izabela", "Jennyfer", "Ketlin", "Luan", "Lucas"].map((name) => ({ id: "", name, fullName: name }));

const VOICE_SLOTS = [
  { name: "assunto", type: "ASSUNTO" },
  { name: "periodo", type: "PERIODO" },
  { name: "corretor", type: "CORRETOR" }
];

export function buildInteractionModel({ brokers = DEFAULT_BROKERS } = {}) {
  const roster = brokers.length ? brokers : DEFAULT_BROKERS;
  return {
    interactionModel: {
      languageModel: {
        invocationName: INVOCATION_NAME,
        intents: [
          { name: "AMAZON.CancelIntent", samples: [] },
          { name: "AMAZON.HelpIntent", samples: [] },
          { name: "AMAZON.StopIntent", samples: [] },
          { name: "AMAZON.NavigateHomeIntent", samples: [] },
          { name: "AMAZON.FallbackIntent", samples: [] },
          { name: "AMAZON.NextIntent", samples: [] },
          { name: "AMAZON.RepeatIntent", samples: [] },
          // --- V1 (preservada) ---
          { name: "ResumoDoDiaIntent", samples: ["resumo do dia", "me dê um resumo", "me dê um resumo do dia", "como está o dia", "como estão as coisas", "resumo"] },
          { name: "AguardandoSimulacaoIntent", samples: ["quantos clientes aguardam simulação", "quantos clientes estão aguardando simulação", "clientes aguardando simulação", "tem cliente aguardando simulação"] },
          { name: "AguardandoDocumentacaoIntent", samples: ["quantos clientes aguardam documentação", "quantos clientes estão aguardando documentação", "documentações pendentes", "tem documentação pendente"] },
          { name: "AguardandoAprovacaoIntent", samples: ["quantos clientes aguardam aprovação", "quantos clientes estão aguardando aprovação", "clientes aguardando aprovação", "tem cliente para aprovar"] },
          { name: "ProximaReuniaoIntent", samples: ["qual é minha próxima reunião", "minha próxima reunião", "qual é meu próximo compromisso", "qual é a próxima reunião"] },
          // --- V2/V3: consulta, lista, continuidade ---
          {
            name: "ConsultarIntent",
            slots: [...VOICE_SLOTS, { name: "etapa", type: "ETAPA" }],
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
              "qual o total",
              // por corretor
              "como está a {assunto} da {corretor}",
              "como está a {assunto} do {corretor}",
              "como está o {assunto} da {corretor}",
              "como está o {assunto} do {corretor}",
              "qual a {assunto} da {corretor}",
              "qual a {assunto} do {corretor}",
              "qual é a {assunto} da {corretor}",
              "qual é a {assunto} do {corretor}",
              "me fale sobre a {assunto} da {corretor}",
              "me fale sobre a {assunto} do {corretor}",
              "me fala sobre a {assunto} da {corretor}",
              "me fala sobre a {assunto} do {corretor}",
              "me fale sobre {assunto} da {corretor}",
              "quantas {assunto} a {corretor} fez",
              "quantas {assunto} o {corretor} fez",
              "quantas {assunto} a {corretor} fez {periodo}",
              "quantas {assunto} o {corretor} fez {periodo}",
              "quantas {assunto} a {corretor} teve",
              "quantas {assunto} o {corretor} teve",
              "quantos {assunto} a {corretor} tem",
              "quantos {assunto} o {corretor} tem",
              "quantos {assunto} a {corretor} teve",
              "quantos {assunto} o {corretor} teve",
              "quanto da {assunto} a {corretor} bateu",
              "quanto da {assunto} o {corretor} bateu",
              "quantos por cento da {assunto} a {corretor} bateu",
              "quantos por cento da {assunto} o {corretor} bateu",
              "quantos por cento a {corretor} fez da {assunto}",
              "quantos por cento o {corretor} fez da {assunto}",
              "a {corretor} {assunto}",
              "o {corretor} {assunto}",
              "{corretor} {assunto}",
              "a {corretor} {assunto} {periodo}",
              "o {corretor} {assunto} {periodo}",
              "quantos clientes da {corretor} estão em {etapa}",
              "quantos clientes do {corretor} estão em {etapa}",
              "quantos clientes a {corretor} tem em {etapa}",
              "quantos clientes o {corretor} tem em {etapa}",
              // pronomes (usam o corretor da conversa)
              "quantas {assunto} ela fez",
              "quantas {assunto} ele fez",
              "quantas {assunto} ela fez {periodo}",
              "quantas {assunto} ele fez {periodo}",
              "quantos {assunto} ela tem",
              "quantos {assunto} ele tem",
              "ela tem {assunto}",
              "ele tem {assunto}",
              "ela fez {assunto}",
              "ele fez {assunto}",
              "ela tem {assunto} {periodo}",
              "ele tem {assunto} {periodo}",
              "{assunto} dela",
              "{assunto} dele",
              "quantos por cento ela fez",
              "quantos por cento ele fez",
              "quanto da meta ela bateu",
              "quanto da meta ele bateu",
              "qual a {assunto} dela",
              "qual a {assunto} dele"
            ]
          },
          {
            name: "CorretorIntent",
            slots: [{ name: "corretor", type: "CORRETOR" }, { name: "periodo", type: "PERIODO" }],
            samples: [
              "como foi o dia da {corretor}",
              "como foi o dia do {corretor}",
              "como foi o dia da {corretor} {periodo}",
              "como foi o dia do {corretor} {periodo}",
              "como foi a {corretor}",
              "como foi o {corretor}",
              "como foi a {corretor} {periodo}",
              "como foi o {corretor} {periodo}",
              "como está {corretor}",
              "como está a {corretor}",
              "como está o {corretor}",
              "como está a {corretor} {periodo}",
              "como está o {corretor} {periodo}",
              "me fale sobre {corretor}",
              "me fale sobre a {corretor}",
              "me fale sobre o {corretor}",
              "me fala sobre {corretor}",
              "me fala sobre a {corretor}",
              "me fala sobre o {corretor}",
              "qual o desempenho da {corretor}",
              "qual o desempenho do {corretor}",
              "qual o desempenho da {corretor} {periodo}",
              "qual o desempenho do {corretor} {periodo}",
              "desempenho da {corretor}",
              "desempenho do {corretor}",
              "me dê um resumo da {corretor}",
              "me dê um resumo do {corretor}",
              "resumo da {corretor}",
              "resumo do {corretor}",
              "resumo da {corretor} {periodo}",
              "resumo do {corretor} {periodo}",
              "como foi {corretor} {periodo}"
            ]
          },
          {
            name: "CompararIntent",
            slots: [{ name: "corretor", type: "CORRETOR" }, { name: "outro_corretor", type: "CORRETOR" }, { name: "assunto", type: "ASSUNTO" }, { name: "periodo", type: "PERIODO" }],
            samples: [
              "compare a {corretor} com a {outro_corretor}",
              "compare o {corretor} com o {outro_corretor}",
              "compare a {corretor} com o {outro_corretor}",
              "compare o {corretor} com a {outro_corretor}",
              "compare {corretor} com {outro_corretor}",
              "compare {corretor} e {outro_corretor}",
              "compare a {corretor} e a {outro_corretor}",
              "compare a {corretor} com a {outro_corretor} {periodo}",
              "compare o {corretor} com o {outro_corretor} {periodo}",
              "compare {corretor} com {outro_corretor} {periodo}",
              "compare {corretor} com {outro_corretor} em {assunto}",
              "compare {corretor} com {outro_corretor} nas {assunto}",
              "quem fez mais {assunto} {corretor} ou {outro_corretor}",
              "quem fez mais {assunto} a {corretor} ou a {outro_corretor}",
              "quem fez mais {assunto} o {corretor} ou o {outro_corretor}",
              "quem teve mais {assunto} {corretor} ou {outro_corretor}",
              "como estão {corretor} e {outro_corretor}",
              "como estão a {corretor} e a {outro_corretor}",
              "como estão {corretor} e {outro_corretor} na {assunto}",
              "como estão a {corretor} e a {outro_corretor} na {assunto}",
              "{assunto} da {corretor} e da {outro_corretor}",
              "{assunto} do {corretor} e do {outro_corretor}"
            ]
          },
          {
            name: "ListarIntent",
            slots: VOICE_SLOTS,
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
              "quem são {assunto} da {corretor}",
              "quem fez mais {assunto}",
              "quem fez mais {assunto} {periodo}",
              "quem teve mais {assunto}",
              "quem teve mais {assunto} {periodo}",
              "quem {assunto}",
              "quem {assunto} {periodo}"
            ]
          },
          {
            name: "ContinuaIntent",
            slots: VOICE_SLOTS,
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
              "agora {assunto}",
              "e a {assunto}",
              "e o {assunto}",
              "e {assunto} dela",
              "e {assunto} dele",
              "e {assunto} da {corretor}",
              "e {assunto} do {corretor}",
              "e a {corretor} {periodo}",
              "e o {corretor} {periodo}"
            ]
          },
          { name: "MaisIntent", samples: ["mais", "mais nomes", "continue", "continua", "pode continuar", "quais mais", "tem mais", "e os outros", "o resto", "próximos"] },
          { name: "ResumoIntent", samples: ["resumo geral", "como estamos", "me dê um panorama", "panorama do escritório", "como está o escritório"] }
        ],
        types: [
          { name: "ASSUNTO", values: dedupe(topicValues()) },
          { name: "PERIODO", values: dedupe(PERIOD_IDS.map((id) => ({ id, ...PERIOD_VALUES[id] }))) },
          { name: "CORRETOR", values: brokerSlotValues(roster) },
          { name: "ETAPA", values: dedupe(Object.entries(ETAPAS).map(([id, etapa]) => ({ id, name: etapa.label, synonyms: ETAPA_SYNONYMS[id] || [] }))) }
        ]
      }
    }
  };
}

// Verificações de consistência do modelo (usadas nos testes e na rota).
export function auditModel(model) {
  const problems = [];
  const language = model.interactionModel.languageModel;
  const seen = new Map();
  const typeNames = new Set([...language.types.map((type) => type.name), "AMAZON.FirstName"]);
  const SLOT_NAME = /^[A-Za-z][A-Za-z._]*$/;
  // Frases: só letras, espaços, apóstrofo, hífen, ponto e {slots} (sem dígitos nem pontuação).
  const SAMPLE_CHARS = /^[\p{L}\s'.{}_-]+$/u;
  for (const intent of language.intents) {
    const declared = new Set((intent.slots || []).map((slot) => slot.name));
    for (const slot of intent.slots || []) {
      if (!SLOT_NAME.test(slot.name)) problems.push(`nome de slot inválido: "${slot.name}" (${intent.name})`);
      if (!typeNames.has(slot.type)) problems.push(`tipo de slot inexistente: "${slot.type}" (${intent.name})`);
    }
    for (const sample of intent.samples) {
      if (!SAMPLE_CHARS.test(sample)) problems.push(`caractere inválido na frase: "${sample}" (${intent.name})`);
      for (const used of sample.match(/\{[^}]*\}/g) || []) {
        if (!declared.has(used.slice(1, -1))) problems.push(`frase usa slot não declarado ${used}: "${sample}" (${intent.name})`);
      }
    }
  }
  for (const intent of language.intents) {
    for (const sample of intent.samples) {
      if (seen.has(sample) && seen.get(sample) !== intent.name) problems.push(`amostra repetida em duas intenções: "${sample}" (${seen.get(sample)} e ${intent.name})`);
      seen.set(sample, intent.name);
    }
  }
  for (const type of language.types) {
    const names = new Set();
    for (const value of type.values) {
      for (const text of [value.name.value, ...value.name.synonyms]) {
        const key = String(text).toLowerCase();
        if (names.has(key)) problems.push(`valor/sinônimo repetido em ${type.name}: "${text}"`);
        names.add(key);
      }
    }
  }
  return problems;
}
