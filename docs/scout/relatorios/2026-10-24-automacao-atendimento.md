# Automação de atendimento (WhatsApp + Messenger) — 2026-10-24
PEDIDO: agente especializado em fluxo de automação de atendimento; ampliar automação do WhatsApp e começar no Messenger · ALVO: `diretor-atendimento` + equipe em docs/atendimento/EQUIPE.md
COMPETÊNCIAS: desenho de fluxo conversacional (estados, gatilhos, saída para humano, plano B quando o cliente não responde/não é entendido); regras da Meta para WhatsApp e Messenger; auditoria de fluxo (já existe); copy (já existe).
LACUNA ATUAL (evidência): a equipe tem `auditor-automacoes`, `followup-vacuo`, `copy-comercial`, `whatsapp-oficial-meta` (EQUIPE.md), mas ninguém PROJETA o fluxo como roteiro de conversa (motor em lib/whatsapp-flows.js: gatilhos palavra-chave/campanha, condições has_name/business_hours/is_client/has_broker/ad_origin, ações roulette/tag/handoff/stop/finish). Messenger: nenhum especialista; o CRM não tem integração oficial (Grep sem pages_messaging/Page token em lib/); o Chat Marketplace roda por extensão no perfil pessoal do dono (BUSINESS_RULES MKT-2).
FONTES: 1/10 doc oficial Meta (WebFetch direto), 3 MCP Registry, 6 GitHub (API deu 403 por limite; usei HTML), 7 VoltAgent, 10 busca. Nada instalado/executado. Nenhuma injeção encontrada.

## Fatos oficiais conferidos hoje (reler antes de usar; regra muda)
- Messenger só funciona para PÁGINA do Facebook, não perfil pessoal. Exige: app Meta com caso de uso Messenger; Página ligada; permissões pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement, business_management; quem gera o token precisa das tarefas MESSAGING e MODERATE; webhook. App Review dispensado se só a própria Página; Verificação da empresa exigida se pessoas sem papel no app usarem (overview.md).
- Janela de 24 h (até 7 dias após clique em anúncio Click-to-Messenger). Fora dela: tag HUMAN_AGENT = resposta MANUAL em 7 dias (automática proibida). Tags ACCOUNT_UPDATE/CONFIRMED_EVENT_UPDATE/POST_PURCHASE_UPDATE retiradas em 27/04/2026 → Utility Templates ou Marketing Messages (changelog 27/03/2026). Robô automático deve responder em até 30 s; aviso de que é automático recomendado. Violação → Página restrita, 7 dias para corrigir (policy).
- Handover Protocol em substituição por "Conversation Routing" (robô ↔ caixa da Página). Chat do Marketplace via API: só fontes de terceiros, NÃO confirmado pela Meta.
- WhatsApp: diretrizes (atualizadas 23/09/2026) proíbem automação/massa por cliente não oficial. IA de atendimento de empresa é permitida; assistente de IA de uso geral foi barrado na API (15/01/2026, imprensa; não lido no termo).
- Termos de coleta automatizada do Facebook (vigência 07/10/2024): robôs/raspagem só com permissão escrita.

## CANDIDATOS
| Nome | Tipo | URL · versão · licença · data | Nota | Classe | Custo (tokens) | Riscos |
|---|---|---|---|---|---|---|
| Doc oficial Messenger (policy, overview.md, get-started, changelog) | doc | developers.facebook.com/documentation/business-messaging/messenger-platform/ · lida 2026-10-24 | 13/14 | ADOTAR como mapa de fontes | 0 fixo (~300 por consulta) | muda sem aviso; ler na hora |
| chatbot-conversation-design (h4vzz/awesome-ai-agent-skills) | skill | skills.sh espelho; repo GitHub dá 404 hoje · licença não verificável | 7/14 | USAR COMO REFERÊNCIA (ideias: fallback em 3 níveis, fluxo que sempre termina em resolução ou humano, métricas de conclusão/fallback/escalada) | 0 | origem sumiu; instala por `npx skills add` |
| chatbot-designer (jmsktm/claude-settings) | skill | github.com/jmsktm/claude-settings · MIT · 9 estrelas | 4/14 | DESCARTAR | - | skill não localizada no repo; repo traz ~20 hooks shell (auto-commit, auto-git) |
| mcp-server-whatsapp (codechap) | MCP | github.com/codechap/mcp-server-whatsapp · "MIT (or whatever)" · 0 estrelas, 5 commits | 3/14 | DESCARTAR | - | ENVIA mensagem com token da Meta; licença informal |
| customer-support (anthropics/knowledge-work-plugins) | plugin | .../customer-support · LICENSE não lida | 8/14 | REFERÊNCIA (níveis de escalada) | 0 | traz .mcp.json (Slack, HubSpot...): NÃO ATIVAR |
Sem MCP oficial da Meta para WhatsApp/Messenger (Registry: só DarkFunnels via QR e iZap SaaS, já descartados em 03/10). VoltAgent: nada novo (só workflow-orchestrator/webhook-engineer, já usados).

## RECOMENDAÇÃO: turbinar o `diretor-atendimento`, sem agente novo
1. Novo perfil `fluxos-conversacionais` (AGENTE PRÓPRIO, executor restrito) em docs/atendimento/especialistas/: projeta fluxo como mapa de estados usando SÓ os blocos que o motor já tem (gatilho → condições → ações); checklist próprio: toda ramificação termina em humano/fim; plano B em 2 níveis antes de passar a humano; nunca mais de N automáticas sem resposta; "Pare"/Não contactar encerra; horário comercial; mesma regra para WhatsApp e Messenger. Saída: diagrama em texto + o que pedir ao crm-editor. Sempre seguido do `auditor-automacoes`.
2. Ampliar `whatsapp-oficial-meta` para "Canais Meta" (WhatsApp + Messenger): +1 seção com o mapa de fontes do Messenger acima. Um especialista só para regras da Meta.
3. Linha nova no EQUIPE.md + micro-pack docs/atendimento/contexto/messenger.md (o que existe: extensão Marketplace; o que não existe: integração oficial).
CUSTO FIXO ADICIONADO: 0 tokens por sessão (perfis lidos sob demanda); ~+60 tokens no EQUIPE.md por missão do Diretor; ~1 mil tokens por consulta ao novo perfil.

## PRÓXIMO PASSO (crm-editor, com aprovação do dono; nada foi instalado)
1. Escrever os 2 perfis + micro-pack (texto próprio, sem copiar terceiros). 2. Teste: Diretor projeta fluxo "Página do Facebook recebe mensagem de anúncio" e o auditor revisa. 3. Implementar Messenger oficial só depois da DECISÃO abaixo.

## DECISÃO NECESSÁRIA (dono)
- Messenger oficial exige Página do Facebook + app Meta com pages_messaging (e verificação da empresa se corretores usarem). O Marketplace do perfil pessoal NÃO entra nessa API.
- Não pôr resposta automática na extensão do Marketplace nem nos números pessoais (Baileys): risco de bloqueio do perfil do dono e dos números.

NÃO CONFIRMADO: licença e conteúdo atual do h4vzz (repo 404); Marketplace via API da Página; se o CRM com corretores sem papel no app exige Verificação; texto exato do termo de IA do WhatsApp; LICENSE do plugin customer-support.
