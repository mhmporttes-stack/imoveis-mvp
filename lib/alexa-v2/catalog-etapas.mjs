// Etapas do funil com as frases curtas de resposta (compartilhado pelo catálogo e pelos assuntos por corretor).
export const ETAPAS = {
  simulacao: {
    label: "simulação",
    one: "cliente aguardando simulação",
    many: "clientes aguardando simulação",
    zero: "Nenhum cliente aguardando simulação."
  },
  documentacao: {
    label: "documentação",
    one: "cliente com documentação pendente",
    many: "clientes com documentação pendente",
    zero: "Nenhum cliente com documentação pendente."
  },
  aprovacao: {
    label: "aprovação",
    one: "cliente aguardando aprovação",
    many: "clientes aguardando aprovação",
    zero: "Nenhum cliente aguardando aprovação."
  },
  aprovados: { label: "aprovados", one: "cliente aprovado", many: "clientes aprovados", zero: "Nenhum cliente aprovado no momento." },
  reuniao: { label: "reunião", one: "cliente em reunião", many: "clientes em reunião", zero: "Nenhum cliente em reunião." },
  atendimento: { label: "atendimento", one: "cliente em atendimento", many: "clientes em atendimento", zero: "Nenhum cliente em atendimento." },
  venda: { label: "venda", one: "cliente em fase de venda", many: "clientes em fase de venda", zero: "Nenhum cliente em fase de venda." },
  prospeccao: { label: "prospecção", one: "cliente em prospecção", many: "clientes em prospecção", zero: "Nenhum cliente em prospecção." }
};
export const ETAPA_IDS = Object.keys(ETAPAS);
