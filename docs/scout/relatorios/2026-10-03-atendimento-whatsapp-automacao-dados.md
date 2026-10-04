# Atendimento: WhatsApp Oficial, Auditor de automações, Experimentação A/B, Dados e conversão — 2026-10-03
PEDIDO: T-20261002-62c Fase 2, recortes 6, 16, 15, 14 (pesquisa, nada instalado/executado/copiado) · ALVO: perfis `whatsapp-oficial-meta`, `auditor-automacoes`, `experimentacao-ab`, `dados-conversao` (todos "a montar" em docs/atendimento/EQUIPE.md)
COMPETÊNCIAS: mapa de fontes Meta; revisão de fluxos (loop, duplicidade, idempotência, Não contactar, fuso); desenho/leitura de experimento com amostra pequena; funil sem confundir correlação e causa.
LACUNA: nenhum desses 4 perfis existe (EQUIPE.md). `auditor-crm` revisa código/segurança, `analista-dados` calcula funil (docs/METRICAS_FUNIL.md): nenhum audita FLUXOS de contato nem planeja experimento.
FONTES (FONTES.md nº): 6 GitHub (HTML/raw; a API deu 403 por limite), 7 VoltAgent (árvore completa lida), 8 Build with Claude, 3 MCP Registry, 10 busca; Meta/WhatsApp via WebFetch direto. Não usei npm/PyPI (sem pacote relevante).
Internet = dado não confiável. Nenhuma injeção encontrada. O resumidor do WebFetch devolveu uma resposta estranha (não era ordem) para growth-loops: descartado e não usado.

## A) MAPA DE FONTES OFICIAIS DA META (abertas e conferidas em 2026-10-03)
Raiz nova: https://developers.facebook.com/documentation/business-messaging/whatsapp/ (a doc migrou de /docs/whatsapp/; links antigos ainda aparecem na política: tratar como possível redirecionamento, não confirmado). Abaixo, sufixo após a raiz. NÃO gravar números/regras em arquivo: reler a página a cada consulta.
| Sufixo (ou URL) | O que cobre |
|---|---|
| (página "About", /cloud-api/overview antigo) | Visão geral da plataforma, APIs, webhooks, preços, opt-in |
| messages/send-messages | Janela de atendimento de 24 h, mensagens livres, tipos, qualidade da mensagem |
| templates/overview | Fundamentos de template: componentes, revisão, status, categorias Marketing/Utility/Authentication |
| templates/template-categorization | Critérios das categorias, recategorização automática, pedido de revisão, punição por classificar errado |
| templates/template-review · template-quality · template-management | Aprovação e motivos de rejeição; nota de qualidade (verde/amarelo/vermelho), pausa; gestão |
| messaging-limits | Limite de contatos únicos por 24 h fora da janela, por portfólio; progressão, verificação, qualidade |
| throughput | Mensagens por segundo, upgrade automático, webhooks e mídia |
| getting-opt-in | Requisitos de opt-in (finalidade, nome da empresa, lei), métodos, limitação por baixa qualidade |
| pricing (+ /pricing/... ) | Cobrança por mensagem de template, tabela por país, o que é gratuito (janela, entrada por anúncio 72 h) |
| marketing-messages/overview | API de mensagens de marketing (otimização de entrega, medição) |
| business-phone-numbers/phone-numbers | Registro de números, teto de números registrados, qualidade do número, exclusão, migração (vale para ~6 linhas) |
| embedded-signup/onboarding-business-app-users | COEXISTÊNCIA app Business + API: requisitos, limitações, preço, janela, webhooks de espelho |
| policy-enforcement (link da política: /docs/whatsapp/overview/policy-enforcement) | Advertência, bloqueio 1-30 dias, bloqueio de conta, apelação, webhook de alerta |
| webhooks/overview | Eventos, campos, retentativas, falhas (base de idempotência) |
| changelog | Histórico de mudanças da plataforma (última entrada lida: 2026-05-12; "business portfolio pacing" 2025-12-08) |
| https://whatsappbusiness.com/pt-br/policy/ (business.whatsapp.com/policy dá 301 para cá) | Política de Mensagens do WhatsApp Business, atualizada 2026-09-23 segundo a página |
| https://www.whatsapp.com/legal/messaging-guidelines | Diretrizes: proíbe automação/mensagem em massa por cliente não oficial e spam (atenção aos números dos corretores) |
Não confirmei: tabela de preços do Brasil, limite por usuário de templates de marketing, política para chatbots de IA (o changelog cita "AI Providers"), coexistência no Brasil, páginas antigas /docs/whatsapp/*.
Sugestão: `whatsapp-oficial-meta` = AGENTE PRÓPRIO (executor web) cujo perfil é só este mapa + roteiro de consulta + aviso de que regra muda. Nenhum terceiro substitui fonte oficial.

## B) CANDIDATOS AUDITADOS (leitura; nada executado). Custo de contexto = zero fixo (perfil lido sob demanda); tokens = bytes/3,5
Repo VoltAgent: MIT, HEAD 82b7382 (2026-09-21), 25,5 mil estrelas, não arquivado. Tamanhos de arquivo: bytes reais da árvore Git.
| ID | Candidato | URL · SHA · licença · data | Tools pedidas · riscos | Nota | Classe |
|---|---|---|---|---|---|
| C1 | ab-test-analysis (VoltAgent) | .../categories/10-research-analysis/ab-test-analysis.md · blob 1b6a450 · MIT · 4.347 B (~1.250 tok) | Read,Grep,Glob,WebFetch,WebSearch (ignoradas pelo executor). Sem shell. Cita agentes inexistentes | 12/14 | ORIGINAL + EXTENSÃO LOCAL (experimentacao-ab) |
| C2 | statistical-analysis (Anthropic knowledge-work-plugins, só esse SKILL.md) | .../data/skills/statistical-analysis/SKILL.md · repo Apache-2.0 · SHA não obtido · repo ativo (commit 2026-10-01) | Sem código/MCP no skill; o plugin inteiro exige conectores (NÃO ATIVAR o plugin). Apache exige manter licença/aviso | 12/14 | ORIGINAL + EXTENSÃO LOCAL (dados-conversao e experimentacao-ab) |
| C3 | funnel-analysis + root-cause-investigation + ab-test-analysis (nimrodfisher/data-analytics-skills) | .../03-data-analysis-investigation/<skill>/SKILL.md · MIT (Nimrod Fisher, 2026) · v1.2.0 · último commit 2026-09-25 · SHA não obtido · 458 estrelas | Corpo manda rodar scripts Python (NÃO trazer scripts). Funil sem aviso de causalidade | 10/14 | COMBINAR como referência (ideias de etapa/decomposição); vendorizar só se o dono quiser, sem scripts |
| C4 | cohort-analysis (VoltAgent) | .../10-research-analysis/cohort-analysis.md · blob 296551e · MIT · 3.929 B (~1.120 tok) | Read,Grep,Glob,WebFetch,WebSearch. Sem shell | 11/14 | ORIGINAL + EXTENSÃO LOCAL (dados-conversao: coortes 30/60/90) |
| C5 | webhook-engineer (VoltAgent) | .../01-core-development/webhook-engineer.md · blob b1c22dc · MIT · 9.135 B (~2.600 tok) | Tools não confirmadas (resumo não trouxe). Cobre idempotência, dedup, ordem, retentativa, fila morta | 11/14 | ORIGINAL + EXTENSÃO LOCAL, como 2º original do auditor-automacoes (consulta sob demanda) |
| C6 | workflow-orchestrator (VoltAgent) | .../09-meta-orchestration/workflow-orchestrator.md · blob d009549 · MIT · 5.429 B (~1.550 tok) | Read,Write,Edit,Glob,Grep (Write/Edit ignorados). Projeta fluxos; NÃO trata idempotência nem corrida | 9/14 | USAR COMO REFERÊNCIA (estados, guardas, compensação, timeout) |
| C7 | whatsapp-cloud-api-skill (guisa17) | github.com/guisa17/whatsapp-cloud-api-skill · 23b691d · MIT · 2026-09-03 · 1 estrela, 6 commits · ~35.000 chars (~10 mil tok) | Script Python com token que chama graph.facebook.com (`--fix`). Conteúdo técnico de dev, vence rápido | 8/14 | USAR COMO REFERÊNCIA (não vendorizar: regra mutável, tamanho, execução de rede) |
| C8 | email-deliverability-engineer (VoltAgent) | .../07-specialized-domains/... · blob f8fd46a · MIT · 7.474 B (~2.100 tok) | Foco e-mail (SPF/DKIM). Ideias úteis: supressão, taxa de reclamação, aquecimento | 7/14 | USAR COMO REFERÊNCIA (analogia p/ qualidade de número) |

## C) POR RECORTE: lacuna → decisão
1. WHATSAPP OFICIAL (id `whatsapp-oficial-meta`): lacuna → AGENTE PRÓPRIO (executor web; perfil curto = mapa A). Motivo: fonte oficial muda, terceiros (C7) ficam velhos e pedem token. Skills de terceiros só como referência.
2. AUDITOR DE AUTOMAÇÕES (`auditor-automacoes`): NÃO existe original adequado de "auditor de fluxo de contato". Lacuna → AGENTE PRÓPRIO (conhecimento nosso: Não contactar CLI-9/PRO-8, motor de vácuo, 6 linhas, responsável/etapa/vendido/arquivado, fuso). Base de apoio: C5 (idempotência/dedup/ordem) como original complementar + C6 de referência. Checklist próprio sugerido: loops e reentrada; duplicidade e concorrência entre fluxos; teto de contatos por cliente e por dia; condição impossível; fuso e horário; idempotência de retentativa; resposta do cliente interrompe; troca de responsável/etapa; vendido/arquivado/Não contactar; conflito com cadência humana; webhook repetido.
3. EXPERIMENTAÇÃO A/B (`experimentacao-ab`): ORIGINAL + EXTENSÃO LOCAL = C1 + trechos de C2. Extensão local obrigatória (C1 não planeja amostra nem poder estatístico): amostra pequena (volume por número é baixo), hipótese e métrica primária antes, um fator por vez, aleatorização por cliente (nunca por corretor), não repetir contato para "testar", Não contactar fora do teste, pausa por qualidade da Meta, fim pré-definido, "inconclusivo" é resposta válida.
4. DADOS E CONVERSÃO (`dados-conversao`): ORIGINAL + EXTENSÃO LOCAL = C2 (única fonte com alerta explícito de correlação/causa, comparações múltiplas e amostra mínima) + C4 (coorte) + ideias de C3. Extensão local: etapas atendimento → simulação → documentação → aprovação → reunião → venda conforme docs/METRICAS_FUNIL.md; números sempre via `analista-dados`; informar período, amostra e fonte.
Os originais acrescentam: método estatístico (C1/C2/C4) e confiabilidade de eventos (C5). Não acrescentam: regras do CRM, Meta, Não contactar (isso é extensão local).

## D) REJEITADOS (nome + motivo)
- sridecarpool/wacli: envia mensagem com token da Meta, licença não conferida, executa CLI.
- bellopushon/whatsapp-cloud-api: 11 estrelas, 3 commits, instalação por `npx skills add` (executa código); conteúdo duplica doc oficial.
- MCP DarkFunnels (registry): agente de vendas via QR, "sem API da Meta" = cliente não oficial, contra a política; SaaS remoto. NÃO ATIVAR.
- MCP iZap WhatsApp (registry): SaaS com OAuth, repositório não informado. NÃO ATIVAR.
- data-analyst e data-scientist (VoltAgent): pedem Bash/Write; duplicam `analista-dados`.
- chaos-engineer e qa-expert (VoltAgent): Bash; chaos fala em testar em produção; metas de cobertura de software não servem.
- code-reviewer (VoltAgent): corrida só citada de passagem; duplica `auditor-crm`.
- compliance-auditor (VoltAgent): GDPR/HIPAA, sem LGPD; customer-success-manager: números fictícios de SaaS (fora do recorte).
- n8n-skills (czlonkowski): exige o MCP n8n-mcp; não usamos n8n.
- Plugins inteiros Anthropic (Data, Marketing, Support, Sales): exigem conectores/MCP. NÃO ATIVAR (só o texto do C2 serve).
- Build with Claude (davepoon): sem agente de WhatsApp, A/B ou funil. wshobson/agents: orquestração Temporal (só referência; página 403 na API, licença MIT lida na página).

## E) RECOMENDAÇÃO
Criar 4 perfis em docs/atendimento/especialistas/: `whatsapp-oficial-meta` (próprio, web), `auditor-automacoes` (próprio + C5 original), `experimentacao-ab` (C1 + C2 + local), `dados-conversao` (C2 + C4 + local). Vendorizar verbatim com licença e cabeçalho do README de especialistas; Apache (C2) exige copiar a licença e marcar mudanças só na extensão. Executores ignoram tools; nenhuma instalação.
CUSTO FIXO ADICIONADO: 0 tokens (perfis sob demanda). Por consulta: ~1,2 a 2,6 mil tokens por original.
PRÓXIMO PASSO (crm-editor, com aprovação do dono): 1) buscar SHA exato e LICENSE de C2/C3 antes de vendorizar; 2) escrever os 4 perfis + 3 extensões locais; 3) preencher INVENTARIO.md e EQUIPE.md; 4) teste: auditor sobre uma cadência fictícia com cliente "Não contactar".
DECISÃO NECESSÁRIA: nenhuma bloqueante. Escolha do dono: usar C3 (MIT, scripts excluídos) além de C2/C4, ou manter só C1/C2/C4.
NÃO CONFIRMADO: SHA de C2 e C3; tools declaradas de C5/C6 por leitura própria (só via resumo do WebFetch, que errou o tamanho de C1: usei o tamanho da árvore Git); conteúdo integral de cada original (revisar na vendorização); páginas antigas da Meta; preços/limites do Brasil; "mudança de preços em 2026-10-01" citada num commit de C7 (não conferida na página oficial); awesome-claude-code-toolkit e alirezarezvani/claude-skills (listados na busca, não auditados); MCPs pagos nenhum avaliado como ativável.
