import { activitiesSentence, emptySentence, firstActivitySentence, lastActivitySentence, restActivitiesSentence } from "./providers/activities-core.mjs";
import { plural } from "./text.mjs";

// "Minha agenda": atividades do usuário vinculado (qualquer tipo), por período.
// A pergunta resolve pela intenção AgendaIntent ("quais atividades eu tenho amanhã?");
// o contexto guarda o assunto para "qual é a primeira?", "e depois?" e "e depois de amanhã?".
export const AGENDA_TOPICS = {
  minha_agenda: {
    label: "minha agenda",
    hidden: true,
    provider: "agenda",
    periods: ["hoje", "amanha", "depois_amanha", "esta_semana", "data"], // "data" = dia específico (d:AAAA-MM-DD)
    kinds: ["count", "list", "first", "last", "rest"],
    defaultKind: "list",
    aliases: ["minha agenda", "minhas atividades", "meus compromissos"],
    say: {
      count: (d, q) => ((d.items || []).length ? `${q.periodoSpoken[0].toLocaleUpperCase("pt-BR")}${q.periodoSpoken.slice(1)}${/ dia \d/.test(q.periodoSpoken) ? "," : ""} você tem ${plural(d.items.length, "atividade", "atividades")}.` : emptySentence(q.periodoSpoken)),
      list: (d, q) => activitiesSentence(d.items || [], { page: q.page, periodoSpoken: q.periodoSpoken, withDay: d.multiDay }),
      first: (d, q) => firstActivitySentence(d.items || [], { periodoSpoken: q.periodoSpoken, withDay: d.multiDay }),
      last: (d, q) => lastActivitySentence(d.items || [], { periodoSpoken: q.periodoSpoken, withDay: d.multiDay }),
      rest: (d, q) => restActivitiesSentence(d.items || [], { page: q.page, periodoSpoken: q.periodoSpoken, withDay: d.multiDay })
    }
  }
};
