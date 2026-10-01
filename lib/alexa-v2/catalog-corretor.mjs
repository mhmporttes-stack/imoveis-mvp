import { ETAPAS } from "./catalog-etapas.mjs";
import {
  MEDIDAS,
  composeBrokerSummary,
  measureSentence,
  metaHitSentence,
  metaSentence,
  subjectOf
} from "./medidas.mjs";
import { joinNames, percentText, plural } from "./text.mjs";

// Assuntos POR CORRETOR (Alexa V3). Todos leem o provedor "corretor", que usa
// o cache de Desempenho/Meta Diária (as mesmas funções das telas). Sem corretor
// falado nem no contexto, a resposta é da EQUIPE (mesma fonte, nível time).
const PERIODS_RANGE = ["hoje", "ontem", "esta_semana", "semana_passada", "este_mes", "mes_passado"];
const PERIODS_DAYS = ["hoje", "ontem"];
const PERIODS_TODAY = ["hoje"];

const cap = (text) => (text ? text[0].toLocaleUpperCase("pt-BR") + text.slice(1) : "");
const who = (d, q) => ({ name: d?.name || q.corretorName || "", gender: d?.gender || "" });

function rankedLine(items, valueText) {
  const shown = items.slice(0, 5);
  const rest = items.length - shown.length;
  const parts = shown.map((item) => `${item.name}, ${valueText(item.count)}`);
  return `${parts.join("; ")}${rest > 0 ? `; e mais ${rest}` : ""}.`;
}

function measureTopic(key, { label, aliases, hidden = false, listEmpty }) {
  const measure = MEDIDAS[key];
  return {
    label,
    provider: "corretor",
    periods: PERIODS_RANGE,
    kinds: ["count", "list"],
    corretorContext: true,
    hidden,
    aliases,
    say: {
      count: (d, q) => {
        const { name, gender } = who(d, q);
        return measureSentence(key, d.value, { name, gender, periodoSpoken: q.periodoSpoken });
      },
      list: (d, q) => {
        const items = d.items || [];
        if (!items.length) return { text: listEmpty || `Ninguém ${measure.zero.replace("não ", "")} ${q.periodoSpoken}.`, names: [] };
        return { text: rankedLine(items, (n) => String(n)), names: items.map((item) => item.name) };
      }
    }
  };
}

export const CORRETOR_TOPICS = {
  corretor_resumo: {
    label: "resumo do corretor",
    hidden: true,
    provider: "corretor",
    periods: PERIODS_RANGE,
    kinds: ["count"],
    needsCorretor: true,
    corretorContext: true,
    aliases: ["resumo do corretor", "dia do corretor", "desempenho do corretor"],
    say: {
      count: (d, q) =>
        composeBrokerSummary({
          name: d.name || q.corretorName,
          gender: d.gender,
          periodId: q.periodo,
          periodoSpoken: q.periodoSpoken,
          row: d.row,
          meta: d.meta,
          position: d.position,
          meetings: d.meetings
        })
    }
  },

  med_atendimentos: measureTopic("atendimentos", { label: "atendimentos", aliases: ["atendimentos", "atendimentos iniciados"] }),
  med_simulacoes: measureTopic("simulacoes", { label: "simulações", aliases: ["simulacoes", "simulacoes enviadas"] }),
  med_documentacao: measureTopic("documentacao", { label: "documentações recebidas", aliases: ["documentacoes", "documentacao recebida", "documentacoes recebidas"] }),
  med_aprovacao: measureTopic("aprovacao", { label: "clientes para aprovação", aliases: ["clientes para aprovacao", "foram para aprovacao", "enviados para aprovacao"] }),
  med_reunioes: measureTopic("reunioes", { label: "reuniões realizadas", aliases: ["reunioes realizadas", "reunioes feitas", "clientes para reuniao"] }),
  // Só alcançados pelo corretor falado em assuntos de equipe (remap); sem valor próprio no modelo de voz.
  med_prospeccoes: measureTopic("prospeccoes", { label: "prospecções feitas", aliases: ["prospeccoes feitas"], hidden: true }),
  med_vendas: measureTopic("vendas", { label: "vendas do corretor", aliases: ["vendas do corretor"], hidden: true }),
  med_aprovados: measureTopic("aprovados", { label: "aprovados do corretor", aliases: ["aprovados do corretor"], hidden: true }),
  med_clientes_novos: measureTopic("clientes_novos", { label: "clientes novos do corretor", aliases: ["clientes novos do corretor"], hidden: true }),

  meta_corretor: {
    label: "meta de um corretor",
    hidden: true,
    provider: "corretor",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    needsCorretor: true,
    corretorContext: true,
    aliases: ["meta do corretor", "meta diaria do corretor", "percentual da meta"],
    say: {
      count: (d, q) => {
        const { name, gender } = who(d, q);
        return metaSentence(d.meta || d, { name, gender, periodoSpoken: q.periodoSpoken, periodId: q.periodo });
      }
    }
  },
  meta_bateu: {
    label: "se o corretor bateu a meta",
    hidden: true,
    provider: "corretor",
    periods: PERIODS_DAYS,
    kinds: ["count"],
    needsCorretor: true,
    corretorContext: true,
    aliases: ["corretor bateu a meta"],
    say: {
      count: (d, q) => {
        const { name, gender } = who(d, q);
        return metaHitSentence(d.meta || d, { name, gender, periodoSpoken: q.periodoSpoken });
      }
    }
  },
  prospeccao_faltam: {
    label: "prospecções que faltam",
    provider: "corretor",
    periods: PERIODS_TODAY,
    kinds: ["count"],
    needsCorretor: true,
    corretorContext: true,
    aliases: ["prospeccoes que faltam", "faltam prospeccoes", "quantas prospeccoes faltam"],
    say: {
      count: (d, q) => {
        const { name, gender } = who(d, q);
        const subject = cap(subjectOf(name || "esse corretor", gender));
        const meta = d.meta;
        if (!meta || !(meta.prospectingTarget > 0)) return `${subject} não tem meta de prospecção definida hoje.`;
        if (meta.prospectingRemaining === 0) return `${subject} já cumpriu a meta de prospecção de hoje: ${meta.prospectingDone} de ${meta.prospectingTarget}.`;
        return `Faltam ${plural(meta.prospectingRemaining, "prospecção", "prospecções")} para ${subjectOf(name, gender)} cumprir a meta de hoje: ${meta.prospectingDone} de ${meta.prospectingTarget}.`;
      }
    }
  },
  posicao_ranking: {
    label: "posição no ranking",
    provider: "corretor",
    periods: PERIODS_RANGE,
    kinds: ["count"],
    needsCorretor: true,
    corretorContext: true,
    aliases: ["posicao no ranking", "colocacao no ranking", "posicao"],
    say: {
      count: (d, q) => {
        const { name, gender } = who(d, q);
        const subject = cap(subjectOf(name || "esse corretor", gender));
        if (!d.position) return `${subject} não está no ranking ${q.periodoSpoken}.`;
        return `${subject} está em ${d.position.position}º lugar no ranking ${q.periodo === "hoje" ? "de hoje" : `de ${q.periodoSpoken}`}, com ${plural(d.position.points, "ponto", "pontos")}.`;
      }
    }
  },
  atividades_atrasadas: {
    label: "atividades atrasadas",
    provider: "corretor",
    periods: PERIODS_TODAY,
    kinds: ["count", "list"],
    corretorContext: true,
    aliases: ["atividades atrasadas", "atividade atrasada", "tarefas atrasadas"],
    say: {
      count: (d, q) => {
        const { name, gender } = who(d, q);
        const subject = name ? cap(subjectOf(name, gender)) : "A equipe";
        return d.value === 0 ? `${subject} não tem atividade atrasada.` : `${subject} tem ${plural(d.value, "atividade atrasada", "atividades atrasadas")}.`;
      },
      list: (d) => {
        const items = d.items || [];
        return { text: items.length ? rankedLine(items, (n) => String(n)) : "Ninguém tem atividade atrasada.", names: items.map((item) => item.name) };
      }
    }
  },
  acao_pendente: {
    label: "clientes aguardando ação",
    provider: "corretor",
    periods: PERIODS_TODAY,
    kinds: ["count", "list"],
    corretorContext: true,
    aliases: ["clientes aguardando acao", "aguardando acao", "clientes aguardando atendimento"],
    say: {
      count: (d, q) => {
        const { name, gender } = who(d, q);
        const subject = name ? cap(subjectOf(name, gender)) : "A equipe";
        return d.value === 0 ? `${subject} não tem cliente aguardando ação.` : `${subject} tem ${plural(d.value, "cliente aguardando ação", "clientes aguardando ação")}.`;
      },
      list: (d) => {
        const items = d.items || [];
        return { text: items.length ? rankedLine(items, (n) => String(n)) : "Ninguém tem cliente aguardando ação.", names: items.map((item) => item.name) };
      }
    }
  },
  compromissos: {
    label: "compromissos",
    provider: "corretor",
    periods: ["hoje", "amanha"],
    kinds: ["count"],
    corretorContext: true,
    aliases: ["compromissos", "atividades agendadas"],
    say: {
      count: (d, q) => {
        const { name, gender } = who(d, q);
        const subject = name ? cap(subjectOf(name, gender)) : "A equipe";
        return d.value === 0 ? `${subject} não tem compromisso ${q.periodoSpoken}.` : `${subject} tem ${plural(d.value, "compromisso", "compromissos")} ${q.periodoSpoken}.`;
      }
    }
  },
  quem_reuniao: {
    label: "quem tem reunião",
    provider: "corretor",
    periods: ["hoje", "amanha", "esta_semana"],
    kinds: ["count", "list"],
    defaultKind: "list",
    aliases: ["quem tem reuniao"],
    say: {
      count: (d, q) => (d.value === 0 ? `Ninguém tem reunião ${q.periodoSpoken}.` : `${plural(d.value, "corretor tem", "corretores têm")} reunião ${q.periodoSpoken}.`),
      list: (d, q) => {
        const items = d.items || [];
        return { text: items.length ? rankedLine(items, (n) => plural(n, "reunião", "reuniões")) : `Ninguém tem reunião ${q.periodoSpoken}.`, names: items.map((item) => item.name) };
      }
    }
  },
  equipe_resumo: {
    label: "como está minha equipe",
    provider: "corretor",
    periods: PERIODS_TODAY,
    kinds: ["count"],
    aliases: ["minha equipe", "como esta minha equipe", "como esta a equipe", "como esta o time", "situacao da equipe"],
    say: {
      count: (d) => {
        const parts = [];
        if (d.metaPercent != null) parts.push(`A equipe está com ${percentText(d.metaPercent)} da meta de hoje.`);
        if (d.hit != null) parts.push(d.hit === 0 ? "Ninguém bateu a meta ainda." : `${plural(d.hit, "corretor já bateu", "corretores já bateram")} a meta.`);
        const flows = [];
        if (d.prospeccoes > 0) flows.push(`${plural(d.prospeccoes, "prospecção", "prospecções")}`);
        if (d.simulacoes > 0) flows.push(`${plural(d.simulacoes, "simulação", "simulações")}`);
        if (d.vendas > 0) flows.push(`${plural(d.vendas, "venda", "vendas")}`);
        if (flows.length) parts.push(`Hoje foram ${joinNames(flows)}.`);
        if (d.online != null) parts.push(d.online === 0 ? "Nenhum corretor online agora." : `${plural(d.online, "corretor online", "corretores online")} agora.`);
        if (d.semProspeccao > 0) parts.push(`${plural(d.semProspeccao, "corretor ainda não prospectou", "corretores ainda não prospectaram")}.`);
        return parts.join(" ") || "Ainda não tenho dados da equipe hoje.";
      }
    }
  },
  comparar: {
    label: "comparar corretores",
    hidden: true,
    provider: "corretor",
    periods: PERIODS_RANGE,
    kinds: ["count"],
    aliases: ["comparar"],
    say: {
      count: (d, q) => {
        const lines = (d.entries || []).map((entry) => `${entry.name}: ${entry.text}`);
        if (!lines.length) return "Não consegui comparar esses corretores agora.";
        return `${cap(q.periodoSpoken)}, ${lines.join(". ")}.`;
      }
    }
  }
};

// Frase de estoque por corretor (etapa + corretor): "A Izabela tem 4 clientes aguardando aprovação."
export function etapaBrokerSentence(etapaId, count, { name, gender }) {
  const etapa = ETAPAS[etapaId];
  const subject = cap(subjectOf(name || "Esse corretor", gender));
  if (!etapa) return `${subject} tem ${plural(count, "cliente", "clientes")}.`;
  return count === 0 ? `${subject} não tem cliente ${etapa.one.replace(/^cliente /, "")}.` : `${subject} tem ${count} ${count === 1 ? etapa.one : etapa.many}.`;
}

