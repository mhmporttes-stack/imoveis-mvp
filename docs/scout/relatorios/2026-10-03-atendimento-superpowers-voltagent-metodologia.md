# Atendimento Fase 2: Superpowers (método) + catálogo VoltAgent (especialistas) — 2026-10-03
PEDIDO: T-20261002-62d. (A) Superpowers como camada de método (planejar, decompor, criticar, executar, verificar). (B) Mapear as 16 especialidades ao catálogo VoltAgent e achar outras úteis · ALVO: `docs/atendimento/EQUIPE.md` (tudo "a montar"), `INVENTARIO.md` vazio.
LACUNA: Diretor e executores não têm método explícito de crítica/verificação; nenhum perfil existe. Evidência: EQUIPE.md, INVENTARIO.md, PROTOCOLO.md (§7-8 só têm modelo de automação e campos do vácuo).
FONTES: 6 (GitHub: páginas, raw e API), 7 (VoltAgent), 8 (Build with Claude, site aberto; API/repo parcialmente 403), 10 (WebSearch). Não consegui: SHA completo de vários repos (API 403 por limite), claude.ai/directory, npm/PyPI (irrelevantes: só markdown).
AVISO DE MÉTODO: o conteúdo foi lido via WebFetch (resumo por modelo pequeno, não bytes crus). Antes de vendorizar, o crm-editor deve baixar o arquivo exato no SHA e conferir. Tokens = bytes/3,5. Nada foi instalado, executado ou copiado.

## A. obra/superpowers
Origem: github.com/obra/superpowers · autor Jesse Vincent · MIT (c) 2025 (LICENSE lido) · v6.4.2, commit 8ca22db (2026-09-25; hash completo 8ca22dba9a94f28898bbce59f2537ff4d87c747d, ver NÃO CONFIRMADO) · 294,7 mil estrelas · push 2026-09-27 · 298 issues abertas · 3 releases em 6 semanas (6.3.0 12/08, 6.4.1 19/09, 6.4.2 25/09) · 7,5 MB (docs/plans, RELEASE-NOTES 102 KB, 17+ plataformas).
Skills que existem (README + árvore): brainstorming, writing-plans, executing-plans, subagent-driven-development, dispatching-parallel-agents, requesting-code-review, receiving-code-review, systematic-debugging, verification-before-completion, test-driven-development, using-git-worktrees, finishing-a-development-branch, writing-skills, using-superpowers, diagnosing-superpowers (15 de 17 citadas no README; as duas restantes não identifiquei).
Plugin: `.claude-plugin/plugin.json` (sem campo hooks); o hook está em `hooks/hooks.json`: SessionStart (startup|clear|compact) roda `run-hook.cmd session-start` (bash, síncrono). O script lê `using-superpowers/SKILL.md` e injeta no contexto (sem rede; leitura local; lido). Injeta ~0,9 mil tokens em TODA sessão, com texto impositivo ("obrigatório usar a skill", "não negociável") que disputa autoridade com nosso CLAUDE.md e com a Central.
Riscos: (1) instrução permanente que manda invocar skill antes de qualquer resposta, inclusive pergunta simples: conflita com a política de autonomia (docs/DESPACHANTE.md §5) e com o roteamento da Central; (2) brainstorming exige aprovação antes de QUALQUER implementação e commita specs no git; TDD obrigatório e worktrees (não temos testes formais; `git push` main = deploy); (3) scripts bash/git nas skills (`sdd-workspace`, `task-brief`, `review-package`, `task-start/done`, `find-polluter.sh`), servidor Node local do "visual companion" (`server.cjs` 25 KB) e menção a `git clean -fdx`; (4) `diagnosing-superpowers` analisa transcrições de sessão e abre issues (pelos nomes dos arquivos: scrub, redaction, session-discovery; NÃO li o corpo): risco de privacidade com dado de cliente; (5) deriva rápida de versão.
Compatibilidade: o executor só tem Read/Grep/Glob, então tudo que depende de Bash/git/worktree/script é inútil ali. Servem só os textos puros de método.

| Skill (arquivo, bytes, tokens) | Sobreposição nossa | Classe | Forma segura |
|---|---|---|---|
| verification-before-completion (3.646 B, ~1,0 mil) | /verificar-correcao (cobre código; este é regra geral "evidência antes de afirmar") | ORIGINAL + EXTENSÃO LOCAL | vendorizar; local: evidência = arquivo/linha/saída citada, sem rodar comando |
| requesting-code-review/code-reviewer.md (6.449 B, ~1,8 mil) | auditor-crm (código); nada para plano/automação | ORIGINAL + EXTENSÃO LOCAL | molde de crítico independente (só leitura, Forças/Problemas Crítico-Importante-Menor/Veredito); local troca "diff" por "projeto de automação" e liga ao `auditor-automacoes` |
| receiving-code-review (6.203 B, ~1,8 mil) | nenhuma | ORIGINAL (opcional) | Diretor ao consolidar pareceres: verificar antes de aceitar, discordar com motivo, sem bajulação |
| writing-plans (10.335 B, ~3,0 mil) | /nova-funcionalidade | REFERÊNCIA | tirar ideias: "sem placeholder", lista de 5 modos de falha ("Review Focus"), autorrevisão; escrever em 8 linhas no PROTOCOLO (texto próprio) |
| brainstorming (17.548 B, ~5,0 mil) | /nova-funcionalidade | REFERÊNCIA | só a ideia do roteador 3 caminhos (sondagem/limitado/arquitetura); resto tem git, spec e servidor visual |
| systematic-debugging (9.465 B, ~2,7 mil) | /diagnosticar-bug | REFERÊNCIA | não é tema de atendimento; manter o nosso |
| executing-plans (20.405 B, ~5,8 mil), subagent-driven-development (32.577 B +26,9 KB de prompts), dispatching-parallel-agents (6.078 B) | crm-editor, Diretor §3 | DESCARTAR | dependem de Bash/git/worktree; o Diretor já delega em paralelo. Ideia útil: relatório com status DONE/CONCERNS/BLOCKED e lista de "decisões tomadas" devolvida ao dono |
| using-superpowers, hook, plugin inteiro, TDD, worktrees, finishing-branch, writing-skills, diagnosing-superpowers | -- | DESCARTAR | ver riscos |
Nota curiosa para o `claude-code-guide`: o doc `claude-code-tools.md` deles afirma que subagentes podem aninhar até 3 níveis (variável `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). Isso mudaria o "MODO PLANO" (PROTOCOLO §6). NÃO verificado na doc oficial: pedir conferência antes de contar com isso.
Conclusão A: NÃO instalar o plugin. Adotar só 3 textos como "metodologia" lida sob demanda em `docs/atendimento/metodologia/` (verificacao, critico, receber-parecer, cada um com `.original.md` intacto + cópia do LICENSE MIT + `.local.md`). Custo fixo: 0. Por uso: 1,0 a 1,8 mil tokens (os 3 juntos ~4,6 mil, nunca todos). Instalando o plugin: custo fixo estimado ~1,8 mil tokens/sessão (0,9 mil do bootstrap + descrições das skills, estimativa) mais hook bash e conflito de autoridade.
Nota rubrica (fonte/manut./licença/segurança/compat./custo/ganho): plugin 2/2/2/0/0/0/1 (reprova em segurança e compat.); 3 textos selecionados 2/2/2/2/1/2/1.

## B. VoltAgent/awesome-claude-code-subagents
Origem: github.com/VoltAgent/awesome-claude-code-subagents · MIT (c) VoltAgent 2025 (LICENSE lido; nenhum aviso de licença por arquivo nos que abri; `ai-writing-auditor` declara derivar de skill MIT de terceiro) · commit 82b73821baa7a911d5b14cfb6da238b7f0db6b42 (2026-09-21) · 25,5 mil estrelas · 2 issues · não arquivado · 10 categorias, ~160 arquivos. Catálogo é 100% de engenharia de software: NÃO há agente de vendas B2C, atendimento, WhatsApp, imobiliário, MCMV, follow-up ou reativação. Redistribuição: MIT permite copiar com aviso; vendorizar exige levar LICENSE + origem. Frontmatter só name/description/tools(/model); métricas do corpo são ilustrativas (ex.: "NPS acima de 50"), não evidência. Agentes citam um "context-manager" por JSON: irrelevante aqui.
`agent-installer.md` (3.559 B; tools Bash, WebFetch, Read, Write, Glob): consulta a API do GitHub, baixa com `curl -s` e grava em `~/.claude/agents/` ou `.claude/agents/`, sem verificação de integridade; mais `install-agents.sh` (18 KB, NÃO lido). Só REFERÊNCIA de mecânica; não usar.

| # | Especialidade | Mais próximo no catálogo (arquivo · categoria · bytes · tools) | Decisão |
|---|---|---|---|
| 1 | atend-imobiliario | sem equivalente | AGENTE PRÓPRIO (Guia de Atendimento) |
| 2 | vendas-conversao | sales-engineer · 08 · 6.990 · Read,Write,Edit,Glob,Grep,WebFetch,WebSearch (pré-venda técnica B2B) | REJEITADO; melhor original é da Anthropic: `handle-objection` + `lead-triage` (ver C) |
| 3 | followup-vacuo | sem equivalente | PRÓPRIO (PROTOCOLO §8); referência: Anthropic `deal-signals` |
| 4 | copy-comercial | landing-page-copywriter · 08 · 7.199 (página, não WhatsApp) | ver relatório 2026-10-03-atendimento-copy-lead-qualidade |
| 5 | comportamento-lead | nlp-engineer · 05 · 6.635 · pede Bash (constrói pipelines ML) | REJEITADO; PRÓPRIO |
| 6 | whatsapp-oficial-meta | email-deliverability-engineer · 07 · 7.474 · pede Bash (só e-mail) | REJEITADO; PRÓPRIO + executor web (doc oficial da Meta) |
| 7 | primeiro-imovel-mcmv | sem equivalente (fintech-engineer = pagamentos) | PRÓPRIO (regras em docs/BUSINESS_RULES.md) |
| 8 | simulacao | sem equivalente | PRÓPRIO (motor em lib/simulacao-entrada; não inventar regra) |
| 9 | documentacao | sem equivalente | PRÓPRIO (liga ao analista-documental existente) |
| 10 | reativacao-30-60-90 | sem equivalente (cohort-analysis cobre só leitura de retenção) | PRÓPRIO; referência: cohort-analysis |
| 11 | customer-success-jornada | customer-success-manager · 08 · 6.908 (SaaS B2B) | REFERÊNCIA (ver relatório irmão) |
| 12 | qualidade-atendimento | sem equivalente | PRÓPRIO (ver relatório irmão) |
| 13 | portugues-comunicacao | ai-writing-auditor · 04 · 4.235 · pede Bash, só inglês | REJEITADO (ver relatório irmão) |
| 14 | dados-conversao | cohort-analysis · 10 · 3.929 · Read,Grep,Glob,WebFetch,WebSearch (data-analyst pede Bash+SQL: rejeitado) | ORIGINAL + EXTENSÃO LOCAL (opcional, baixa prioridade) |
| 15 | experimentacao-ab | ab-test-analysis · 10 · 4.347 (~1,2 mil tokens) · Read,Grep,Glob,WebFetch,WebSearch | ORIGINAL + EXTENSÃO LOCAL (melhor encaixe do catálogo) |
| 16 | auditor-automacoes | workflow-orchestrator · 09 · 5.429 · Read,Write,Edit,Glob,Grep (projeta máquinas de estado: erro, retry, compensação) | COMBINAR: original + molde de crítico do Superpowers + extensão local (Não contactar, volume, loops) |
Detalhes 15: frontmatter traz `model: Claude` (valor inválido; o executor ignora). Critério p<0,05 e "ship/no-ship" é de produto com volume; nossa amostra é pequena: a extensão local deve exigir amostra mínima, janela e "sem vencedor" como resultado legítimo; teste só de mensagem aprovada e sem violar Não contactar.
Detalhes 16: workflow-orchestrator "projeta, não executa" e marca lacunas em vez de inventar (bate com nosso protocolo); a extensão local traz o checklist: parada ao responder/mudar de estágio/Não contactar (PROTOCOLO §7), teto por número e horário configuráveis (exemplos numéricos nunca regra), laços, reenvio duplicado, auditor distinto de quem projetou.
`agent-organizer` (09 · 5.631 · Read,Write,Edit,Glob,Grep): decompõe tarefa, casa com agentes lendo frontmatter e sinaliza lacuna. É a função do nosso Diretor: REFERÊNCIA apenas.

## C. Outras coleções verificadas
| Fonte | Licença · SHA · data · estrelas | Útil para nós | Classe |
|---|---|---|---|
| anthropics/knowledge-work-plugins | Apache-2.0 (raiz e `sales/LICENSE` lidos) · 8444efcd48f7012f09797778a36a33e73d0861f4 (2026-10-01; houve push em 10-03 não inspecionado) · 26 mil | Plugins `sales` (36 skills), `customer-support` (5), com `.mcp.json` (HubSpot, Slack, Intercom, M365...). Skills puras em markdown, conteúdo externo tratado como dado | ver abaixo |
| gtmagents/gtm-agents | Apache-2.0 (só pela página) · SHA não capturado · 412 | 92 agentes B2B GTM (cold outreach, objeção, churn); tem scripts Python e Husky | REFERÊNCIA (não auditado arquivo a arquivo) |
| wshobson/agents | MIT (página) · SHA não capturado · 40,2 mil | 202 agentes de engenharia, sem atendimento | DESCARTAR p/ este tema |
| anthropics/skills | licença mista (Apache; skills de documento "source-available") · SHA não capturado · 179,5 mil | docx/pdf/pptx; nada de atendimento | DESCARTAR p/ este tema |
| louisblythe/Sales-Skills | CONFLITO: a página disse MIT, o relatório irmão achou SPDX nulo | objeção, follow-up, qualificação (122 skills) | tratar como sem licença: só REFERÊNCIA lida, nada copiado |
| Build with Claude (site + davepoon/buildwithclaude) | MIT no repo (3,6 mil estrelas) · SHA não capturado (403) | Índice: site diz 108 plugins/180 skills/117 subagentes/177 comandos/33 hooks; README do repo diz 117 agentes/175 comandos/28 hooks/26 skills/51 plugins (contagens autodeclaradas e discrepantes). Cada item mostra título, descrição, categoria e repo de origem; licença só no nível do repo; instalação por `/plugin marketplace add` | REFERÊNCIA como índice de descoberta; sempre ir à fonte primária (licença por item não aparece); sem agente de atendimento/vendas B2C visto |

Anthropic: candidatos por especialidade (tokens estimados por nº de palavras x1,4; arquivos não medidos em bytes):
- `sales/skills/handle-objection` (tamanho não medido): classifica objeção (preço/valor, momento, concorrência, risco, autoridade, status quo), ancora em evidência, responde com reconhecimento + prova + pergunta. Apache-2.0, sem shell. ORIGINAL + EXTENSÃO LOCAL para `vendas-conversao` (extensão: comprador pessoa física, WhatsApp, sem promessa de aprovação/parcela, Não contactar absoluto). Apache exige manter LICENSE e avisos; a extensão em arquivo separado já marca as mudanças.
- `sales/skills/lead-triage` (~1,1 mil palavras, ~1,5 mil tokens): ajuste/intenção, prioridade P0-P2, descarte. ORIGINAL + EXTENSÃO LOCAL para qualificação (extensão: critérios do CRM/MCMV, etapa do funil). Conectores são opcionais (funciona com texto colado).
- `sales/skills/deal-signals` (~1,2 mil palavras): alerta de "negócio quieto" por limiares. REFERÊNCIA para `followup-vacuo` (limiar vem do histórico real, via `analista-dados`).
- `sales/skills/schedule-meeting` (~1,8 mil palavras): cria evento e envia convite via calendário/e-mail. REFERÊNCIA apenas (age; nosso executor não age); agendamento de visita = lacuna, PRÓPRIO.
- `customer-support/skills/draft-response` (~3 mil palavras, ~4,2 mil tokens): tom por situação, checagens de compromisso. Pesado; REFERÊNCIA (tom já em relatório irmão).

## Outras especialidades úteis (fora das 16)
1. `qualificacao-lead` -> ORIGINAL + EXTENSÃO LOCAL (Anthropic lead-triage). Vale incorporar.
2. `objecoes-negociacao` -> ORIGINAL + EXTENSÃO LOCAL (handle-objection); pode ser o mesmo perfil de vendas-conversao: recomendo juntar para não inflar a equipe.
3. `compliance-lgpd-mensagens` (consentimento, opt-out, Não contactar, dado pessoal em mensagem) -> AGENTE PRÓPRIO leve. VoltAgent `gdpr-ccpa-compliance` (4.683 B, Read,Grep,Glob,WebFetch,WebSearch) e `compliance-auditor` (6.868 B, Read,Grep,Glob) NÃO citam LGPD; só REFERÊNCIA de estrutura do checklist. Não vira parecer jurídico; ponto de partida e validação com profissional do dono. Executor web (lei muda). Valor alto: toca o risco real de disparo.
4. `agendamento-visita` -> PRÓPRIO leve (roteiro de proposta de horário, confirmação, lembrete, falta); só se o dono tiver esse fluxo.
5. `sentimento-conversa` -> não criar: o próprio modelo faz; dobrar em `comportamento-lead`.
6. `onboarding-pos-venda` -> dobrar em `customer-success-jornada`.
Prioridade sugerida: auditor-automacoes (antes de qualquer automação), whatsapp-oficial-meta, compliance-lgpd, followup-vacuo, vendas-conversao (com original), experimentacao-ab.

## REJEITADOS (nome: motivo)
- obra/superpowers como plugin: hook global, bootstrap impositivo, bash/git/worktree, `diagnosing-superpowers` lê sessões.
- VoltAgent agent-installer / install-agents.sh: baixa e grava arquivos, sem integridade.
- ai-writing-auditor (Bash, só inglês), content-quality-editor (Bash + `npm install` de terceiro), data-analyst (Bash + SQL), nlp-engineer (Bash), email-deliverability-engineer (Bash, só e-mail), legal-advisor (GDPR/CCPA, Write/WebFetch, "parecer jurídico"), sales-engineer (pré-venda técnica B2B), content-marketer, landing-page-copywriter, ux-researcher.
- gtm-agents inteiro, wshobson/agents, anthropics/skills: fora do tema ou não auditados.
- Sales-Skills (louisblythe): licença contraditória.

## RECOMENDAÇÃO E CUSTO
Vendorizar (SHA fixo, LICENSE junto, extensão local separada, INVENTARIO preenchido): ab-test-analysis, workflow-orchestrator (+ molde de crítico), cohort-analysis (opcional), handle-objection, lead-triage, e os 3 textos de método do Superpowers. Criar como próprios: atend-imobiliario, followup-vacuo, whatsapp-oficial-meta, primeiro-imovel-mcmv, simulacao, documentacao, reativacao, compliance-lgpd-mensagens, agendamento-visita (se houver fluxo). Tudo como perfis em docs/atendimento; nenhuma skill nem agente novo registrado.
CUSTO FIXO ADICIONADO: 0 tokens (antes -> depois igual). Custo por uso: 1,0 a 2,0 mil tokens por original (ab-test 1,2 mil; workflow-orchestrator 1,6 mil; lead-triage ~1,5 mil); Diretor convoca 1 a 4 por missão.
PRÓXIMO PASSO (crm-editor, com aprovação do dono): (1) baixar cada arquivo no SHA citado e conferir contra este relatório; (2) criar `docs/atendimento/metodologia/` e os perfis com `.original.md` intacto, LICENSE e `.local.md`; (3) preencher INVENTARIO.md e EQUIPE.md; (4) pedir ao `claude-code-guide` para checar aninhamento de subagentes; (5) dono decide as perguntas abaixo. Nada foi instalado.
DECISÃO DO DONO: (a) aceita vendorizar originais Apache-2.0/MIT de terceiros dentro do repositório (com aviso de licença)? (b) existe fluxo de agendamento de visita para modelar? (c) quer parecer jurídico externo para o perfil de LGPD?
NÃO CONFIRMADO: commit completo do Superpowers (a API mostrou o mesmo hash para árvore e commit; confirmar no clone); SHAs de gtm-agents, wshobson, anthropics/skills, Build with Claude; corpo de `diagnosing-superpowers`, `run-hook.cmd`, `install-agents.sh` e skills do Superpowers além das listadas; bytes exatos dos arquivos da Anthropic; descrições (frontmatter) das skills do Superpowers (custo fixo do plugin é estimativa); datas de último commit por arquivo; conteúdo por item no Build with Claude (só índice e README); aninhamento de subagentes; texto da LGPD; se há sobreposição com conteúdo do Scout irmão além do citado.
