# Padrões de interface para CRM

Padrões de partida, não regras cegas — adapte à intenção da tela. Antes de mudar o que uma tela mostra, confira a rule do módulo (tabela em `CLAUDE.md`): várias "esquisitices" têm razão de negócio.

## Navegação

- **Mobile (PWA, maioria dos corretores):** barra inferior fixa — **implementada** (`AdminBottomNav`, detalhes em `sistema-visual.md` §4.1). Tela redesenhada não repete o menu no topo no celular e não cria barra fixa própria no rodapé sem somar `--admin-bottom-nav-space`.
- **Desktop:** navegação lateral ou superior estável com agrupamento (CRM · Operação · Gestão), item ativo inequívoco. Hoje o menu é `components/AdminMenu.jsx` (grupos por perfil: owner/manager/broker/associate) — preserve quem vê o quê.
- Uma tela = um título + no máximo uma linha de contexto. Ações primárias da tela no cabeçalho dela, não espalhadas.

## Listas de clientes / tabelas densas

- **Desktop:** tabela ou lista em linhas (44–52px) com colunas escaneáveis: nome + telefone · status (badge semântico) · responsável · próxima atividade/atraso · última interação · ações. Cabeçalho fixo, números alinhados à direita com `tabular-nums`.
- **Mobile:** card compacto por cliente, uma linha de título (nome), uma de status/próxima ação, ações primárias (WhatsApp, abrir) com alvo ≥44px; o resto atrás de "mais".
- **Filtros:** busca sempre visível; filtros frequentes como chips/segmentos com contagem; avançados em sheet. Mostre os filtros ativos e "limpar". Busca/filtro/paginação são do servidor (`.claude/rules/frontend-pwa.md`) — o design não cria filtro local.
- **Ação em linha** só para o que se faz muitas vezes ao dia; o resto no detalhe. Linha inteira clicável abre o detalhe (com `<a>`/`<button>` real dentro, não `<div onClick>`).
- Detalhe do cliente: sheet lateral (desktop) / tela cheia (mobile) preserva o contexto da lista melhor que trocar de página.
- Paginação clara ("1–25 de 312"); estado vazio diferente para "nenhum cliente" e "nenhum resultado para este filtro".

## Chat

- Desktop: 3 colunas quando houver espaço (conversas · mensagens · contexto do cliente/guia), contexto recolhível. Mobile: uma coluna por vez, com voltar.
- Lista de conversas: nome, prévia de 1 linha, horário, não lidas (contador), estado de espera e responsável — estado mais importante primeiro, no máximo 2 badges por item.
- Thread: bolhas com contraste suficiente, horário discreto, datas como separadores, mídia com proporção reservada (sem pulo de layout), nota interna claramente diferente de mensagem ao cliente.
- Compositor fixo no rodapé, seguro com teclado virtual (iOS) e safe-area; ações secundárias (anexo, atalhos, áudio) agrupadas.
- Status de conexão do WhatsApp sempre visível e honesto (conectado / reconectando / desconectado com ação).

## Funil, métricas e dashboards

- **Um número-herói por painel** (o que responde "como estou hoje?"), depois 3–4 métricas de apoio, depois detalhe. Não 12 cards iguais.
- Métrica = valor + rótulo + comparação (meta, ontem, semana) — sem comparação o número não diz nada.
- Funil: etapas em sequência horizontal (desktop) / vertical (mobile) com contagem e taxa de passagem; a etapa com gargalo é a que recebe destaque.
- Gráficos: poucos, com título que diz a conclusão; cor semântica; rótulos legíveis no mobile ou trocar por lista.
- Período (hoje/semana/mês) como segmento visível, com o período ativo inequívoco.

## Ranking e Meta Diária

- O usuário precisa ver **a própria posição e o que falta** antes do pódio dos outros.
- Progresso como barra/anel com valor numérico e meta ("7 de 10"), nunca só a forma.
- Celebração (Top 1, meta batida): expressiva, curta, pulável e respeitando movimento reduzido — já há componentes; não duplique.
- Corretor atrasado / sem atividade: sinal claro e acionável (atalho para a ação), sem constranger.

## Formulários

- Uma coluna no mobile; agrupamento por assunto com título de seção; rótulo sempre visível (placeholder não é rótulo); input ≥16px.
- Validação ao sair do campo e no envio; mensagem junto do campo dizendo como corrigir; foco vai para o primeiro erro.
- Botão principal com o verbo da ação ("Salvar cliente", "Enviar à CCA"), não "OK"; estado de envio no próprio botão; impedir envio duplo.
- Formulário longo: progresso e salvamento visível; nada se perde ao fechar sem querer (confirmar).

## Modais, sheets e confirmações

- **Modal** só para decisão curta e bloqueante (confirmar exclusão, escolher responsável). **Sheet/drawer** para editar/consultar sem perder o contexto. **Página** para fluxo longo.
- `<dialog>` nativo ou primitiva acessível: foco preso, `Esc` fecha, foco volta ao gatilho, rolagem do fundo travada, título associado (`aria-labelledby`).
- Mobile: sheet de baixo com alça, alvo de fechar ≥44px, conteúdo rolável e ações fixas no rodapé.
- Ação destrutiva: confirmação diz exatamente o que será perdido; botão de perigo com o verbo.

## Estados (obrigatórios em toda tela com dado)

- **Carregando:** skeleton com o formato do conteúdo (sem pulo de layout); spinner só para ação pontual. Após ~10s, mensagem de "está demorando".
- **Vazio:** convite à ação ("Nenhum cliente hoje. Compartilhe seu link de simulação" + botão), diferente de "filtro sem resultado".
- **Erro:** o que aconteceu, em linguagem simples, e como resolver (tentar de novo / falar com o administrador). Nunca mensagem técnica crua como texto principal.
- **Sucesso/feedback:** toda ação responde em <100ms (estado pressionado, otimista ou spinner no botão) e confirma o resultado (toast curto ou mudança visível).
- **Offline/PWA:** indicar sem conexão e o que não vai funcionar (ver `docs/pwa-admin.md`).

## Texto da interface

Português do Brasil, voz ativa, frases curtas. O mesmo verbo no botão, no toast e no histórico ("Transferir cliente" → "Cliente transferido"). Sem jargão técnico (Supabase, migration, ID) para corretor. Datas/horas em `America/Sao_Paulo`, valores em BRL (`.claude/rules/frontend-pwa.md`). Caixa alta só em micro-rótulos.

## Acessibilidade (piso, não diferencial)

Elementos interativos reais (`button`, `a`, `input`); foco visível (anel `brand` com contraste) em tudo; ordem de tabulação lógica; ícone sem texto tem `aria-label`; cor nunca é o único sinal (status com texto/ícone); contraste AA; alvo ≥44px; `prefers-reduced-motion` respeitado; conteúdo dinâmico importante anunciado (`aria-live` em toasts/erros).
