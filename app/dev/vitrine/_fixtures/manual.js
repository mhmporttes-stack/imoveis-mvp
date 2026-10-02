// Dados 100% fictícios e neutros para revisar o Manual do CRM (leitura e administração).
const now = Date.now();
const iso = (days) => new Date(now - days * 86400000).toISOString();

export const topics = [
  {
    slug: "primeiros-passos", title: "Primeiros passos", description: "Conheça o painel e comece o dia com o pé direito.", icon: "target", sort_order: 10, updated_at: iso(2), isNew: true,
    sections: [
      { slug: "visao-geral", title: "Visão geral do painel", sort_order: 10, last_updated_at: iso(2), isNew: true, href: "/admin/manual#primeiros-passos/visao-geral",
        body: "O painel reúne tudo o que você usa no dia a dia em um só lugar.\n\n## O que você encontra\n- Clientes: a lista de atendimentos e o funil.\n- Agenda: seus compromissos e retornos.\n- Chat: as conversas com os clientes.\n\nComece sempre pelo que está marcado como pendente." },
      { slug: "organizar-o-dia", title: "Como organizar o dia", sort_order: 20, last_updated_at: iso(30), isNew: false, href: "/admin/manual#primeiros-passos/organizar-o-dia",
        body: "1. Abra a Agenda e veja o que vence hoje.\n2. Responda as conversas novas.\n3. Registre o resultado de cada contato.\n\nTexto de exemplo com <b>marcação</b> que aparece como texto simples." }
    ]
  },
  {
    slug: "clientes", title: "Clientes", description: "Cadastro, etapas do funil e histórico de atendimento.", icon: "users", sort_order: 20, updated_at: iso(40), isNew: false,
    sections: [
      { slug: "cadastrar", title: "Cadastrar um cliente", sort_order: 10, last_updated_at: iso(40), isNew: false, href: "/admin/manual#clientes/cadastrar", body: "Use o botão de novo cliente e preencha nome e telefone. Os demais campos podem ser completados depois." },
      { slug: "etapas", title: "Mudar a etapa do funil", sort_order: 20, last_updated_at: iso(40), isNew: false, href: "/admin/manual#clientes/etapas", body: "A etapa muda direto no cartão do cliente. O sistema pede uma confirmação antes de salvar." }
    ]
  },
  {
    slug: "agenda", title: "Agenda", description: "Atividades, retornos e lembretes.", icon: "calendar", sort_order: 30, updated_at: iso(50), isNew: false,
    sections: [{ slug: "criar-atividade", title: "Criar uma atividade", sort_order: 10, last_updated_at: iso(50), isNew: false, href: "/admin/manual#agenda/criar-atividade", body: "Escolha o cliente, a data e uma nota curta. A atividade aparece na Agenda e no cartão do cliente." }]
  },
  {
    slug: "documentos", title: "Documentos", description: "Como enviar e acompanhar a documentação.", icon: "file", sort_order: 40, updated_at: iso(60), isNew: false,
    sections: [{ slug: "enviar", title: "Enviar documentos", sort_order: 10, last_updated_at: iso(60), isNew: false, href: "/admin/manual#documentos/enviar", body: "Anexe os arquivos na ficha do cliente. Cada documento mostra se está completo ou pendente." }]
  }
];

export const news = [
  { id: "00000000-0000-4000-8000-000000000001", slug: "novo-manual", title: "O Manual do CRM chegou", body: "Agora você tem um guia dentro do próprio painel.\n\n- Busque por qualquer palavra.\n- Abra o assunto e leia no seu ritmo.", important: true, requires_ack: true, published_at: iso(1), isNew: true, read: false },
  { id: "00000000-0000-4000-8000-000000000002", slug: "cartao-de-cliente", title: "Cartão de cliente mais compacto", body: "O cartão ficou menor para caber mais clientes na tela.", important: false, requires_ack: false, published_at: iso(12), isNew: false, read: true }
];

const ids = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const adminTopics = topics.map((t, i) => ({ id: ids(i + 1), slug: t.slug, title: t.title, description: t.description, icon: t.icon, sort_order: t.sort_order, audiences: ["all"], status: i === 3 ? "pending" : "published" }));
const adminSections = topics.flatMap((t, i) => t.sections.map((s, j) => ({ id: ids((i + 1) * 10 + j), topic_id: ids(i + 1), slug: s.slug, title: s.title, body: s.body, sort_order: s.sort_order, audiences: i === 1 && j === 1 ? ["manager", "admin"] : ["all"], status: i === 3 ? "pending" : "published", last_updated_at: s.last_updated_at })));
const adminNews = [
  { id: news[0].id, slug: news[0].slug, title: news[0].title, body: news[0].body, audiences: ["all"], important: true, requires_ack: true, status: "published", published_at: news[0].published_at, created_at: iso(2) },
  { id: "00000000-0000-4000-8000-000000000003", slug: "novo-aviso", title: "Aviso sobre a nova Agenda", body: "Texto do aviso em rascunho.", audiences: ["broker"], important: false, requires_ack: false, status: "pending", created_at: iso(0) },
  { id: "00000000-0000-4000-8000-000000000004", slug: "rascunho", title: "Rascunho de novidade", body: "", audiences: ["all"], important: false, requires_ack: false, status: "draft", created_at: iso(3) }
];
const pendingVersions = [{ id: "00000000-0000-4000-8000-000000000201", section_id: adminSections[1].id, version: 2, created_at: iso(0), created_by: "x", news_id: null, approved_at: null }];

export const adminOverview = { topics: adminTopics, sections: adminSections, news: adminNews, pendingVersions };

export const routes = [
  { match: /^\/api\/admin\/manual\/search\?q=/, response: ({ url }) => {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    return { results: topics.flatMap((t) => t.sections.filter((s) => `${s.title} ${s.body}`.toLowerCase().includes(q)).map((s) => ({ topicSlug: t.slug, topicTitle: t.title, sectionSlug: s.slug, title: s.title, snippet: s.body.slice(0, 110), href: s.href }))) };
  } },
  { match: /^\/api\/admin\/manual\/news\/[^/]+\/read/, method: "POST", response: { read: true } },
  { match: /^\/api\/admin\/manual\/admin\/sections\/[^/]+\/versions/, response: { versions: [{ id: pendingVersions[0].id, section_id: adminSections[1].id, version: 2, body_before: adminSections[1].body, body_after: `${adminSections[1].body}\n\nNova observação sobre a prioridade do dia.`, created_at: iso(0), approved_at: null }] } },
  { match: /^\/api\/admin\/manual\/admin\/news\/[^/]+\/reads/, response: { reads: [{ user_id: "a", name: "Ana Souza", role: "broker", read_at: iso(1) }, { user_id: "b", name: "Bruno Lima", role: "manager", read_at: iso(0) }] } },
  { match: /^\/api\/admin\/manual\/admin$/, response: adminOverview },
  { match: /^\/api\/admin\/manual\/admin\//, method: "PATCH", response: { ok: true } },
  { match: /^\/api\/admin\/manual\/admin\//, method: "POST", response: { ok: true } }
];
