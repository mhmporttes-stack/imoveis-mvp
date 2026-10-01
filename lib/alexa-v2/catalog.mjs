import { joinNames, namesSentence, pageOfNames, percentText, plural, spokenTime } from "./text.mjs";

// CATÁLOGO ÚNICO da Alexa V2: cada assunto aponta para UM provedor (que lê a
// mesma fonte da tela) e tem as frases curtas de resposta. Puro: sem banco,
// sem rede. O que o provedor devolve ("data") é descrito em cada assunto.
//
// kinds: "count" = "quantos/qual/como está"; "list" = "quem são/quais".
// Assunto sem "list" responde só um número/frase (e "quem são?" explica).
// defaultKind: o que responder quando a pergunta não define (ex.: "quanto
// falta para cada um" só faz sentido em lista).

import { ETAPAS, ETAPA_IDS } from "./catalog-etapas.mjs";
import { CORRETOR_TOPICS, etapaBrokerSentence } from "./catalog-corretor.mjs";
import { AGENDA_TOPICS } from "./catalog-agenda.mjs";
import { subjectOf } from "./medidas.mjs";
export { ETAPAS, ETAPA_IDS };

const DEFAULT_ETAPA_FOR_V1 = { simulacao: "simulacao", documentacao: "documentacao", aprovacao: "aprovacao" };
export { DEFAULT_ETAPA_FOR_V1 };

function countAre(count, singular, plurals) {
  return `${count} ${count === 1 ? singular : plurals}`;
}

function listOrNone(names, emptyText, page = 0) {
  const text = namesSentence(names, page);
  return text || emptyText;
}

function itemNames(data) {
  return (data?.items || []).map((item) => item.name).filter(Boolean);
}

function rankedLine(items, valueText, page = 0) {
  const { slice, remaining } = pageOfNames(items, page);
  if (!slice.length) return "";
  const parts = slice.map((item) => `${item.name}, ${valueText(item)}`);
  return `${parts.join("; ")}${remaining > 0 ? `; e mais ${remaining}` : ""}.`;
}

function when({ dayOffset, hours, minutes, weekdayName }) {
  const time = spokenTime(hours, minutes);
  const day = dayOffset === 0 ? "hoje" : dayOffset === 1 ? "amanhã" : `na ${weekdayName}`;
  return `${day} às ${time}`;
}

const PERIODS_TODAY = ["hoje"];
const PERIODS_DAYS = ["hoje", "ontem"];
const PERIODS_RANGE = ["hoje", "ontem", "esta_semana", "semana_passada", "este_mes", "mes_passado"];

function brokerSubject(q) {
  const name = q.corretor?.name || q.corretorName || "O corretor";
  const subject = subjectOf(name, q.corretor?.gender);
  return subject[0].toLocaleUpperCase("pt-BR") + subject.slice(1);
}

function brokerAgendaCount(d, q) {
  const who = brokerSubject(q);
  if (d.count === 0) return `${who} não tem reunião ${q.periodoSpoken}.`;
  return `${who} tem ${d.count === 1 ? "1 reunião" : `${d.count} reuniões`} ${q.periodoSpoken}.`;
}

function brokerNextMeeting(d, q) {
  const who = subjectOf(q.corretor?.name || q.corretorName || "esse corretor", q.corretor?.gender);
  if (!d.when) return `${brokerSubject(q)} não tem reuniões marcadas para os próximos dias.`;
  return `A próxima reunião ${/^[ao] /.test(who) ? `d${who}` : `de ${who}`} é ${when(d.when)}${d.client ? `, com ${d.client}` : ""}.`;
}

const BASE_TOPICS = {
  // ---------------- META DIÁRIA ----------------
  meta_equipe: {
    label: "meta da equipe",
    provider: "meta",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    aliases: ["meta da equipe", "meta do time", "meta diaria", "meta"],
    say: {
      count: (d) => `A meta da equipe está em ${percentText(d.percent)}.`
    }
  },
  meta_bateram: {
    label: "quem bateu a meta",
    provider: "meta",
    periods: PERIODS_DAYS,
    kinds: ["count", "list"],
    aliases: ["bateram a meta", "bateu a meta", "quem bateu"],
    say: {
      count: (d) => (d.count === 0 ? "Ninguém bateu a meta ainda." : `${countAre(d.count, "corretor bateu", "corretores bateram")} a meta.`),
      list: (d, q) => ({ text: listOrNone(itemNames(d), "Ninguém bateu a meta ainda.", q.page), names: itemNames(d) })
    }
  },
  meta_faltam: {
    label: "quem ainda não bateu a meta",
    provider: "meta",
    periods: PERIODS_DAYS,
    kinds: ["count", "list"],
    aliases: ["nao bateram a meta", "nao bateu a meta", "faltam bater a meta", "ainda nao bateu"],
    say: {
      count: (d) => (d.count === 0 ? "Todos os corretores já bateram a meta." : `${countAre(d.count, "corretor ainda não bateu", "corretores ainda não bateram")} a meta.`),
      list: (d, q) => ({ text: listOrNone(itemNames(d), "Todos já bateram a meta.", q.page), names: itemNames(d) })
    }
  },
  meta_cada: {
    label: "quanto falta para cada corretor",
    provider: "meta",
    periods: PERIODS_TODAY,
    kinds: ["count", "list"],
    defaultKind: "list",
    aliases: ["quanto falta para cada", "quanto falta pra cada", "falta para cada corretor"],
    say: {
      count: (d, q) => ({ text: listOrNone((d.items || []).map((i) => i.name), "Todos já bateram a meta.", q.page) }),
      list: (d, q) => {
        const text = rankedLine(d.items || [], (item) => `falta ${item.remaining}`, q.page);
        return { text: text || "Todos já bateram a meta.", names: itemNames(d) };
      }
    }
  },
  meta_corretor: {
    label: "meta de um corretor",
    provider: "meta",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    needsCorretor: true,
    aliases: ["meta do corretor"],
    say: {
      count: (d, q) => {
        const name = d.name || q.corretorName || "Esse corretor";
        if (!d.hasGoal) return `${name} não tem meta definida ${q.periodoSpoken}.`;
        return `${name} está em ${percentText(d.percent)} da meta ${q.periodoSpoken}.`;
      }
    }
  },
  meta_lider: {
    label: "maior percentual da meta",
    provider: "meta",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    aliases: ["maior percentual", "lidera a meta", "mais perto da meta"],
    say: {
      count: (d) => (d.name ? `${d.name} lidera a meta, com ${percentText(d.percent)}.` : "Ainda não há percentual de meta para comparar.")
    }
  },

  // ---------------- PROSPECÇÃO ----------------
  prospeccao_equipe: {
    label: "prospecção da equipe",
    provider: "prospeccao",
    periods: PERIODS_RANGE,
    kinds: ["count", "list"],
    aliases: ["prospeccao", "prospeccoes", "prospectaram"],
    say: {
      count: (d, q) => `A equipe fez ${plural(d.count, "prospecção", "prospecções")} ${q.periodoSpoken}.`.replace("hoje.", "hoje."),
      list: (d, q) => {
        const text = rankedLine(d.items || [], (item) => String(item.count), q.page);
        return { text: text || "Ninguém prospectou ainda.", names: itemNames(d) };
      }
    }
  },
  prospeccao_ranking: {
    label: "quem mais prospectou",
    provider: "prospeccao",
    periods: PERIODS_RANGE,
    kinds: ["count", "list"],
    aliases: ["mais prospectou", "quem prospectou mais", "prospectou"],
    say: {
      count: (d) => (d.items?.[0] && d.items[0].count > 0 ? `Quem mais prospectou foi ${d.items[0].name}, com ${d.items[0].count}.` : "Ninguém prospectou ainda."),
      list: (d, q) => {
        const ranked = (d.items || []).filter((item) => item.count > 0);
        const text = rankedLine(ranked, (item) => String(item.count), q.page);
        return { text: text || "Ninguém prospectou ainda.", names: ranked.map((i) => i.name) };
      }
    }
  },
  prospeccao_vs_meta: {
    label: "prospecção comparada à meta",
    provider: "prospeccao",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    aliases: ["prospeccao comparada", "prospeccao contra a meta", "prospeccao e meta"],
    say: {
      count: (d, q) => `A equipe fez ${d.done} de ${d.target} prospecções previstas ${q.periodoSpoken}, ${percentText(d.percent)}.`
    }
  },
  prospeccao_corretor: {
    label: "prospecção de um corretor",
    provider: "prospeccao",
    periods: PERIODS_RANGE,
    kinds: ["count"],
    needsCorretor: true,
    aliases: ["prospeccao do corretor"],
    say: {
      count: (d, q) => `${d.name || q.corretorName || "Esse corretor"} fez ${plural(d.count || 0, "prospecção", "prospecções")} ${q.periodoSpoken}.`
    }
  },
  sem_prospeccao: {
    label: "quem ainda não prospectou",
    provider: "prospeccao",
    periods: PERIODS_TODAY,
    kinds: ["count", "list"],
    aliases: ["nao prospectou", "sem prospeccao", "ainda nao prospectou"],
    say: {
      count: (d) => (d.count === 0 ? "Todos já prospectaram hoje." : `${countAre(d.count, "corretor ainda não prospectou", "corretores ainda não prospectaram")} hoje.`),
      list: (d, q) => ({ text: listOrNone(itemNames(d), "Todos já prospectaram hoje.", q.page), names: itemNames(d) })
    }
  },

  // ---------------- PRESENÇA ----------------
  online: {
    label: "corretores online",
    provider: "presenca",
    periods: PERIODS_TODAY,
    kinds: ["count", "list"],
    aliases: ["online", "conectados", "trabalhando"],
    say: {
      count: (d) => (d.count === 0 ? "Nenhum corretor online agora." : `${countAre(d.count, "corretor online", "corretores online")} agora.`),
      list: (d, q) => ({ text: listOrNone(itemNames(d), "Nenhum corretor online agora.", q.page), names: itemNames(d) })
    }
  },

  // ---------------- FUNIL / ETAPAS ----------------
  funil: {
    label: "funil",
    provider: "funil",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    aliases: ["funil", "funil de hoje"],
    say: {
      count: (d) => {
        const stages = (d.stages || []).filter((stage) => stage.count > 0).slice(0, 6);
        if (!stages.length) return "O funil está vazio no momento.";
        return `No funil: ${joinNames(stages.map((stage) => `${stage.count} em ${stage.label}`))}.`;
      }
    }
  },
  etapa: {
    label: "clientes por etapa",
    provider: "etapa",
    periods: PERIODS_DAYS,
    kinds: ["count", "list"],
    needsEtapa: true,
    corretorContext: true,
    aliases: ["clientes", "aguardando", "em"],
    say: {
      count: (d, q) => {
        if (q.corretor) return etapaBrokerSentence(q.etapa, d.count, { name: q.corretor.name, gender: q.corretor.gender });
        const etapa = ETAPAS[q.etapa];
        if (!etapa) return "De qual etapa você quer saber?";
        return d.count === 0 ? etapa.zero : `${d.count} ${d.count === 1 ? etapa.one : etapa.many}.`;
      },
      list: (d, q) => {
        const etapa = ETAPAS[q.etapa];
        const names = itemNames(d);
        return { text: names.length ? namesSentence(names, q.page) : etapa?.zero || "Não encontrei clientes nessa etapa.", names };
      }
    }
  },
  movimento: {
    label: "clientes que avançaram",
    provider: "movimento",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    aliases: ["avancaram", "avancou", "mudaram de etapa", "movimento"],
    say: {
      count: (d, q) => (d.count === 0 ? `Nenhum cliente avançou de etapa ${q.periodoSpoken}.` : `${countAre(d.count, "cliente avançou", "clientes avançaram")} de etapa ${q.periodoSpoken}.`)
    }
  },

  // ---------------- AGENDA ----------------
  agenda: {
    label: "reuniões",
    provider: "agenda",
    periods: ["hoje", "amanha", "esta_semana"],
    kinds: ["count", "list"],
    corretorContext: true,
    aliases: ["reunioes", "agenda"],
    say: {
      count: (d, q) => (q.corretor ? brokerAgendaCount(d, q) : d.count === 0 ? `Não há reuniões ${q.periodoSpoken}.` : `${q.periodoSpoken === "hoje" ? "Hoje" : q.periodoSpoken[0].toUpperCase() + q.periodoSpoken.slice(1)} ${d.count === 1 ? "temos 1 reunião" : `temos ${d.count} reuniões`}.`),
      list: (d, q) => {
        const items = d.items || [];
        const { slice, remaining } = pageOfNames(items, q.page);
        if (!slice.length) return { text: `Não há reuniões ${q.periodoSpoken}.`, names: [] };
        const parts = slice.map((item) => `${spokenTime(item.hours, item.minutes)}${item.client ? ` com ${item.client}` : ""}`);
        return { text: `${parts.join("; ")}${remaining > 0 ? `; e mais ${remaining}` : ""}.`, names: items.map((i) => i.client).filter(Boolean) };
      }
    }
  },
  proxima_reuniao: {
    label: "próxima reunião",
    provider: "agenda",
    periods: PERIODS_TODAY,
    kinds: ["count", "list"],
    defaultKind: "count",
    corretorContext: true,
    aliases: ["proxima reuniao", "proximo compromisso"],
    say: {
      count: (d, q) => {
        if (q.corretor) return brokerNextMeeting(d, q);
        if (!d.when) return "Não há reuniões marcadas para os próximos dias.";
        const who = [d.client ? `com ${d.client}` : "", d.broker ? `corretor ${d.broker}` : ""].filter(Boolean).join(", ");
        return `A próxima reunião é ${when(d.when)}${who ? `, ${who}` : ""}.`;
      },
      list: (d) => ({ text: d.client ? `O cliente é ${d.client}${d.broker ? `, do corretor ${d.broker}` : ""}.` : "A próxima reunião não tem cliente vinculado.", names: d.client ? [d.client] : [] })
    }
  },
  reunioes_atrasadas: {
    label: "reuniões atrasadas",
    provider: "agenda",
    periods: PERIODS_TODAY,
    kinds: ["count"],
    aliases: ["reunioes atrasadas", "compromissos atrasados"],
    say: {
      count: (d) => (d.count === 0 ? "Nenhuma reunião atrasada." : `${countAre(d.count, "reunião atrasada", "reuniões atrasadas")}.`)
    }
  },

  // ---------------- ATENDIMENTO / PENDÊNCIAS ----------------
  sem_atendimento: {
    label: "clientes sem atendimento",
    provider: "atendimento",
    periods: PERIODS_TODAY,
    kinds: ["count", "list"],
    aliases: ["sem atendimento", "sem atendimento humano"],
    say: {
      count: (d) => (d.count === 0 ? "Nenhum cliente sem atendimento humano." : `${countAre(d.count, "cliente sem atendimento humano", "clientes sem atendimento humano")}.`),
      list: (d, q) => ({ text: listOrNone(itemNames(d), "Nenhum cliente sem atendimento humano.", q.page), names: itemNames(d) })
    }
  },
  pendencias: {
    label: "pendências",
    provider: "pendencias",
    periods: PERIODS_DAYS,
    kinds: ["count", "list"],
    aliases: ["pendencias", "pendente", "pendentes"],
    say: {
      count: (d, q) => (d.count === 0 ? `Nenhuma pendência ${q.periodoSpoken}.` : `${countAre(d.count, "pendência", "pendências")} ${q.periodoSpoken}.`),
      list: (d, q) => ({ text: listOrNone(itemNames(d), "Nenhuma pendência no momento.", q.page), names: itemNames(d) })
    }
  },
  pendencias_ranking: {
    label: "corretor com mais pendências",
    provider: "pendencias",
    periods: PERIODS_DAYS,
    kinds: ["count", "list"],
    aliases: ["mais pendencias", "quem tem mais pendencias"],
    say: {
      count: (d) => (d.items?.[0] && d.items[0].count > 0 ? `Quem tem mais pendências é ${d.items[0].name}, com ${d.items[0].count}.` : "Ninguém tem pendências."),
      list: (d, q) => {
        const ranked = (d.items || []).filter((item) => item.count > 0);
        const text = rankedLine(ranked, (item) => String(item.count), q.page);
        return { text: text || "Ninguém tem pendências.", names: ranked.map((i) => i.name) };
      }
    }
  },
  sem_contato: {
    label: "clientes há muito tempo sem contato",
    provider: "pendencias",
    periods: PERIODS_TODAY,
    kinds: ["count", "list"],
    aliases: ["sem contato", "muito tempo sem contato"],
    say: {
      count: (d) => (d.count === 0 ? "Nenhum cliente está há muito tempo sem contato." : `${countAre(d.count, "cliente está", "clientes estão")} há mais de ${d.days || 3} dias sem contato.`),
      list: (d, q) => ({ text: listOrNone(itemNames(d), "Nenhum cliente está há muito tempo sem contato.", q.page), names: itemNames(d) })
    }
  },
  fila_roleta: {
    label: "fila da roleta",
    provider: "atendimento",
    periods: PERIODS_TODAY,
    kinds: ["count"],
    aliases: ["fila da roleta", "roleta"],
    say: {
      count: (d) => (d.count === 0 ? "Não há clientes esperando na fila da roleta." : `${countAre(d.count, "cliente esperando", "clientes esperando")} na fila da roleta.`)
    }
  },
  clientes_novos: {
    label: "clientes novos",
    provider: "movimento",
    periods: PERIODS_RANGE,
    kinds: ["count", "list"],
    aliases: ["clientes novos", "novos clientes", "cadastros"],
    say: {
      count: (d, q) => (d.count === 0 ? `Nenhum cliente novo ${q.periodoSpoken}.` : `${countAre(d.count, "cliente novo", "clientes novos")} ${q.periodoSpoken}.`),
      list: (d, q) => ({ text: listOrNone(itemNames(d), "Nenhum cliente novo.", q.page), names: itemNames(d) })
    }
  },

  // ---------------- RESULTADOS ----------------
  vendas: {
    label: "vendas",
    provider: "resultados",
    periods: PERIODS_RANGE,
    kinds: ["count", "list"],
    aliases: ["vendas", "venda", "vendeu"],
    say: {
      count: (d, q) => (d.count === 0 ? `Nenhuma venda ${q.periodoSpoken}.` : `Tivemos ${plural(d.count, "venda", "vendas")} ${q.periodoSpoken}.`),
      list: (d, q) => {
        const ranked = (d.items || []).filter((item) => item.count > 0);
        const text = rankedLine(ranked, (item) => String(item.count), q.page);
        const noOwner = d.count > 0 ? `Tivemos ${plural(d.count, "venda", "vendas")} ${q.periodoSpoken}, mas nenhuma está atribuída a um corretor da equipe.` : "";
        return { text: text || noOwner || `Nenhuma venda ${q.periodoSpoken}.`, names: ranked.map((i) => i.name) };
      }
    }
  },
  aprovacoes: {
    label: "aprovações",
    provider: "resultados",
    periods: PERIODS_RANGE,
    kinds: ["count", "list"],
    aliases: ["aprovacoes", "aprovacao no periodo", "aprovados no periodo"],
    say: {
      count: (d, q) => (d.count === 0 ? `Nenhuma aprovação ${q.periodoSpoken}.` : `Tivemos ${plural(d.count, "aprovação", "aprovações")} ${q.periodoSpoken}.`),
      list: (d, q) => {
        const ranked = (d.items || []).filter((item) => item.count > 0);
        const text = rankedLine(ranked, (item) => String(item.count), q.page);
        const noOwner = d.count > 0 ? `Tivemos ${plural(d.count, "aprovação", "aprovações")} ${q.periodoSpoken}, mas nenhuma está atribuída a um corretor da equipe.` : "";
        return { text: text || noOwner || `Nenhuma aprovação ${q.periodoSpoken}.`, names: ranked.map((i) => i.name) };
      }
    }
  },
  conversao: {
    label: "conversão",
    provider: "resultados",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    aliases: ["conversao", "taxa de conversao"],
    say: {
      count: (d) => {
        const parts = [];
        if (d.taxaAtendimento != null) parts.push(`atendimento ${percentText(d.taxaAtendimento * 100)}`);
        if (d.taxaSimulacao != null) parts.push(`simulação ${percentText(d.taxaSimulacao * 100)}`);
        return parts.length ? `Conversão: ${joinNames(parts)}.` : "Ainda não há dados para calcular a conversão.";
      }
    }
  },
  desempenho: {
    label: "desempenho da equipe",
    provider: "resultados",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    aliases: ["desempenho"],
    say: {
      count: (d, q) => {
        const parts = [];
        if (d.newClients != null) parts.push(plural(d.newClients, "cliente novo", "clientes novos"));
        if (d.prospecting != null) parts.push(plural(d.prospecting, "prospecção", "prospecções"));
        if (d.approval != null && d.approval > 0) parts.push(plural(d.approval, "aprovação", "aprovações"));
        if (d.sale != null && d.sale > 0) parts.push(plural(d.sale, "venda", "vendas"));
        return parts.length ? `${q.periodoSpoken === "hoje" ? "Hoje" : q.periodoSpoken}: ${joinNames(parts)}.` : "Ainda não há movimento para comentar.";
      }
    }
  },

  // ---------------- RANKING ----------------
  melhor_dia: {
    label: "melhor do dia",
    provider: "ranking",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    aliases: ["melhor do dia", "destaque do dia"],
    say: {
      count: (d, q) => (d.name ? `O melhor ${q.periodoSpoken === "hoje" ? "do dia" : "de " + q.periodoSpoken} é ${d.name}, com ${plural(d.points, "ponto", "pontos")}.` : "Ninguém pontuou ainda.")
    }
  },
  campeao_semana: {
    label: "campeão da semana",
    provider: "ranking",
    periods: ["semana_passada"],
    defaultPeriod: "semana_passada",
    kinds: ["count"],
    aliases: ["campeao da semana", "campea da semana"],
    say: {
      count: (d) => (d.name ? `${d.gender === "female" ? "A campeã" : d.gender === "male" ? "O campeão" : "O campeão"} da semana foi ${d.name}, com ${plural(d.points, "ponto", "pontos")}.` : "O campeão da semana ainda não foi definido.")
    }
  },
  ranking: {
    label: "ranking",
    provider: "ranking",
    periods: PERIODS_DAYS,
    kinds: ["count", "list"],
    aliases: ["ranking", "classificacao"],
    say: {
      count: (d, q) => {
        const top = (d.items || []).filter((item) => item.points > 0).slice(0, 3);
        return top.length ? `Ranking ${q.periodoSpoken}: ${joinNames(top.map((item, index) => `${index + 1}º ${item.name}`))}.` : "Ninguém pontuou ainda.";
      },
      list: (d, q) => {
        const ranked = (d.items || []).filter((item) => item.points > 0);
        const text = rankedLine(ranked, (item) => plural(item.points, "ponto", "pontos"), q.page);
        return { text: text || "Ninguém pontuou ainda.", names: ranked.map((i) => i.name) };
      }
    }
  },
  pontos: {
    label: "pontos de um corretor",
    provider: "ranking",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    needsCorretor: true,
    aliases: ["pontos"],
    say: {
      count: (d, q) => `${d.name || q.corretorName || "Esse corretor"} tem ${plural(d.points || 0, "ponto", "pontos")} ${q.periodoSpoken}.`
    }
  },

  // ---------------- RESUMOS ----------------
  resumo: {
    label: "resumo",
    provider: "resumo",
    periods: PERIODS_TODAY,
    kinds: ["count"],
    aliases: ["resumo", "como esta o escritorio", "como esta o dia"],
    say: { count: (d) => d.text }
  },
  atencao: {
    label: "o que precisa de atenção",
    provider: "resumo",
    periods: PERIODS_TODAY,
    kinds: ["count"],
    aliases: ["atencao", "precisa de atencao"],
    say: {
      count: (d) => (d.items?.length ? `Precisa de atenção: ${joinNames(d.items.slice(0, 4))}.` : "Nada urgente no momento.")
    }
  }
};

export const TOPICS = { ...BASE_TOPICS, ...CORRETOR_TOPICS, ...AGENDA_TOPICS };
export const TOPIC_IDS = Object.keys(TOPICS);

export function topicSupportsKind(topicId, kind) {
  return Boolean(TOPICS[topicId]?.kinds?.includes(kind));
}

export function topicSupportsPeriod(topicId, periodId) {
  return Boolean(TOPICS[topicId]?.periods?.includes(periodId));
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Reconhece assunto/etapa a partir do texto falado (quando o slot não trouxe
// o id canônico). Os ids canônicos virão do modelo de interação (etapa 5).
export function topicFromText(text) {
  const value = normalize(text);
  if (!value) return "";
  if (TOPICS[value]) return value;
  let best = "";
  let bestLength = 0;
  for (const [id, topic] of Object.entries(TOPICS)) {
    for (const alias of topic.aliases || []) {
      if (value.includes(alias) && alias.length > bestLength) {
        best = id;
        bestLength = alias.length;
      }
    }
  }
  return best;
}

export function etapaFromText(text) {
  const value = normalize(text);
  if (!value) return "";
  if (ETAPAS[value]) return value;
  if (value.includes("simul")) return "simulacao";
  if (value.includes("document")) return "documentacao";
  if (value.includes("aprovad")) return "aprovados";
  if (value.includes("aprova")) return "aprovacao";
  if (value.includes("reuni")) return "reuniao";
  if (value.includes("atendimento")) return "atendimento";
  if (value.includes("venda") || value.includes("vendas")) return "venda";
  if (value.includes("prospec")) return "prospeccao";
  return "";
}
