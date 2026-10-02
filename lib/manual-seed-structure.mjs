// Manual do CRM — ESTRUTURA inicial (tópicos/subtópicos). Sem texto final: o
// conteúdo é escrito depois e tudo entra como "pending" (o dono aprova).
// Slugs são estáveis (âncoras da ajuda contextual): nunca renomeie depois de publicar.
const s = (slug, title, audiences = ["all"]) => ({ slug, title, audiences });

export const MANUAL_SEED_STRUCTURE = Object.freeze([
  { slug: "clientes", title: "Clientes", icon: "users", description: "Cadastro, funil, etiquetas e acompanhamento dos clientes.", audiences: ["all"], sections: [
    s("cadastrar-cliente", "Cadastrar e encontrar clientes"),
    s("funil-e-etapas", "Funil e etapas de atendimento"),
    s("etiquetas", "Etiquetas e observações"),
    s("transferir-responsavel", "Transferir responsável", ["manager"])
  ] },
  { slug: "prospeccao-meta-diaria", title: "Prospecção e Meta Diária", icon: "target", description: "Lista de contatos, tentativas e a meta do dia.", audiences: ["all"], sections: [
    s("prospeccao", "Como funciona a Prospecção"),
    s("meta-diaria", "Meta Diária e carteira ativa"),
    s("roleta-de-leads", "Roleta de leads"),
    s("meta-da-equipe", "Meta da equipe", ["manager"])
  ] },
  { slug: "chat-whatsapp", title: "Chat e WhatsApp", icon: "message", description: "Conversas com clientes e envio de mensagens.", audiences: ["all"], sections: [
    s("conectar-whatsapp", "Conectar o WhatsApp"),
    s("responder-clientes", "Responder clientes"),
    s("mensagens-prontas", "Mensagens prontas e disparo")
  ] },
  { slug: "agenda", title: "Agenda", icon: "calendar", description: "Compromissos, visitas e lembretes.", audiences: ["all"], sections: [
    s("compromissos", "Criar e acompanhar compromissos"),
    s("lembretes", "Lembretes e alertas")
  ] },
  { slug: "simulacao-jornada", title: "Simulação e Jornada", icon: "calculator", description: "Simulação de financiamento e a jornada pública do cliente.", audiences: ["all"], sections: [
    s("simulacao-financiamento", "Simulação de financiamento"),
    s("jornada-do-cliente", "Jornada do cliente"),
    s("links-de-captacao", "Links de captação")
  ] },
  { slug: "documentacao", title: "Documentação", icon: "file", description: "Documentos do cliente e envio para análise.", audiences: ["all"], sections: [
    s("documentos-do-cliente", "Documentos do cliente"),
    s("pendencias", "Pendências e devolutiva"),
    s("envio-a-cca", "Envio à CCA")
  ] },
  { slug: "ranking-desempenho", title: "Ranking e Desempenho", icon: "trophy", description: "Pontuação, ranking e indicadores de desempenho.", audiences: ["all"], sections: [
    s("pontuacao", "Como a pontuação funciona"),
    s("ranking", "Ranking"),
    s("indicadores-da-equipe", "Indicadores da equipe", ["manager"]),
    s("indicadores-financeiros", "Financeiro e comissões")
  ] },
  { slug: "outros", title: "Outros", icon: "more", description: "Notificações, alertas, instalação do app e dúvidas gerais.", audiences: ["all"], sections: [
    s("central-de-alertas", "Central de Alertas"),
    s("instalar-aplicativo", "Instalar o aplicativo"),
    s("novidades-do-crm", "Novidades do CRM")
  ] }
]);
