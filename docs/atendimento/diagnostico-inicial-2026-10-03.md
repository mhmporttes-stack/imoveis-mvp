# Diagnóstico inicial do atendimento — 2026-10-03

Modo leitura. Nada foi alterado no CRM, banco, Guia ou código; nenhuma mensagem enviada; nenhuma automação criada. Banco NÃO consultado (o Diretor não tem acesso): números abaixo são os que já estão registrados em `docs/` (com data) e valem como "informado pela documentação", não como medição de hoje.
Legenda: FATO = comprovado em arquivo:linha · NÃO CONFIRMADO = depende do banco, de produção ou do dono.

## 1. Como o atendimento funciona hoje (lead → venda)

**Entrada (de onde vêm os clientes)**
- Formulário/link: link geral do site e `?ref=equipe` passam pela roleta; link pessoal do corretor atribui direto e nunca é redistribuído (ROL-5, `docs/BUSINESS_RULES.md:49`).
- Roleta só considera corretor online nos últimos 5 min; sem ninguém online o cliente fica em fila de espera sem responsável e é distribuído quando alguém entrar (ROL-2a, `BUSINESS_RULES.md:44`).
- Anúncio "Click to WhatsApp": entra na roleta (ROL-7, `BUSINESS_RULES.md:51`). Depende do número oficial (ver abaixo).
- WhatsApp individual do corretor: contato novo vira cliente direto do corretor dono da linha, sem roleta (`docs/WHATSAPP.md:48`).
- Prospecção (base antiga): Meta Diária com até 3 tentativas automáticas pelo WhatsApp do corretor (PRO-6/MD-10, `BUSINESS_RULES.md:78,97`) + "Disparar" (até 10 por ciclo, PRO-10, `:80`).
- Cadastro manual e captação.

**Etapas do funil (7)**: Atendimento → Simulação → Aguardando documentação → Aguardando aprovação → Cliente aprovado → Reunião → Venda (`docs/METRICAS_FUNIL.md:17-31`, `lib/client-status.js`). Fora do funil: Atendimento automático, Aguardando simulação, Tentando contato, Arquivado, Não contactar.

**Como o status anda**
- Cliente que veio pelo WhatsApp nasce em "Atendimento automático"; corretor responde → "Em atendimento"; preenche formulário → "Aguardando simulação"; cliente responde a "Tentando contato" → "Em atendimento" (WA-9, `BUSINESS_RULES.md:146`).
- Resposta do cliente à prospecção: cancela fila, converte rodada, vai para "Em atendimento" (PRO-8, `:77`).
- Documentação: IA classifica, motor determinístico decide o que falta; envio à CCA muda para "Aguardando aprovação" (DOC-1/DOC-4, `:158,161`).
- Venda: entrar em status de venda cria registro financeiro e marco de reunião automático (FUN-5, `:35`).

**Canal hoje**: o número oficial (Cloud API) foi banido pela Meta em 28/09/2026; o canal principal é o WhatsApp individual de cada corretor (Baileys/Railway) (`docs/WHATSAPP.md:5,28-52`). Fluxos (robô), respostas por palavra-chave e Disparo oficial continuam no código, mas dependem do número oficial: estado real NÃO CONFIRMADO (`WHATSAPP.md:203`).

**Apoio ao corretor**: Guia de Atendimento ao lado do Chat (3 guias + banco de objeções), regra central "objeção → investigar → motivo real → solucionar → testar → documentação → data de retorno" (`docs/GUIA_ATENDIMENTO.md:3-7`). Alertas: "cliente aguardando" (≥10 min atenção, ≥30 atraso) no Chat (`lib/whatsapp-chat.js:42-44,625-635`), aviso Alexa/Central quando ninguém responde em 10 min (`lib/alexa-reply-alert-core.mjs:6`; nasce desligado, `.claude/rules/automacoes-notificacoes.md:75`).

## 2. Pontos fortes (preservar)
1. "Não contactar" bem protegido: mantém responsável, barra Disparo e fila, motivo obrigatório + trava anti-abuso, cliente que volta a escrever gera pendência humana, nunca reativa sozinho (CLI-9/PRO-8, `BUSINESS_RULES.md:23,77`; Disparo `WHATSAPP.md:163`).
2. Prospecção com travas fortes: uma tentativa por contato por dia (MD-3), hibernação de 24 h e +30 dias (PRO-3/PRO-6), revalidação completa antes de cada envio, um envio por vez por número, resposta real cancela a fila, status travado sem resposta real (PRO-9) (`BUSINESS_RULES.md:78-80`).
3. Anti-ban/variação: 4+4+10 modelos de mensagem com anti-repetição, saudação pela hora real, tratamento correto de quem atende (MD-10, WA-8; `lib/daily-goal-auto-messages.mjs:10`, `BUSINESS_RULES.md:97,145`).
4. Resposta do cliente é tratada em dois consumidores independentes (Prospecção e Chat), com idempotência por `wa_message_id` (PRO-8).
5. Mudança de status automática pelo Chat e pontuação atribuída a quem fez (WA-9, MET-11).
6. Guia de Atendimento com disciplina "próximo passo + data de retorno", que cria atividade na agenda; aviso contra "me chama / fico aguardando" (`GUIA_ATENDIMENTO.md:7`, `lib/attendance-guide-core.mjs:58,173`); banco de ~16 objeções.
7. Privacidade por escopo: Chat por perfil, conversa de WhatsApp pessoal só do dono da linha/gestor/admin, alertas privados (WA-11, WA-14, AL-PRIV).
8. Transferência rastreada: histórico da roleta e evento `responsible_transferred` na jornada; conversa acompanha o cliente (CLI-7/CLI-8, `BUSINESS_RULES.md:21-22`).
9. Métricas com definições canônicas e regras de apresentação (n, período, fonte) (`METRICAS_FUNIL.md`).
10. Roteamento de documentação determinístico (IA classifica, código decide).

## 3. Gargalos
- **Dependência do corretor e do celular**: sessão depende do celular ligado e com internet; perda de `SESSION_ENCRYPTION_KEY` derruba todas; número pessoal pode ser banido por volume (`WHATSAPP.md:54-58`).
- **Roleta sem ninguém online = lead espera**: o cliente (e o botão "Receber minha simulação") fica aguardando até 10 min na tela do cliente (WA-10, `BUSINESS_RULES.md:148`). Tempo real de espera na fila: NÃO CONFIRMADO.
- **Tempo de resposta não é medido oficialmente**: "fora do escopo" (`METRICAS_FUNIL.md:54`). Só há indicadores visuais no Chat.
- **Pós-documentação sem processo escrito**: o Guia não tem roteiro para aprovação, aprovado, reunião/visita, venda e pós-venda (ver §4/§9; FATO por busca nos seeds).
- **Histórico de status incompleto** em ações da Prospecção (P-02, `SYSTEM_ARCHITECTURE.md:171`).
- **Dados curtos**: primeiro cliente em 2026-07-21; ~96% dos eventos de status desde 2026-09-07 (`METRICAS_FUNIL.md:96`).
- **Sem opt-out geral**: PARAR/SAIR só existe para cliente em prospecção; fora disso depende de humano marcar Não contactar (`WHATSAPP.md:201`).
- **Mídia do cliente**: no número oficial só áudio é baixado; foto/documento viram rótulo (P-14). No individual passou a baixar a partir de 2026-10-02.
- Lembrete de atividade por modelo WhatsApp depende de modelo aprovado na WABA (0 aprovados registrado em 2026-09-24; hoje NÃO CONFIRMADO) (`WHATSAPP.md:203`).

## 4. Vácuos de automação (cliente sem próxima ação)
Resumo: o sistema **detecta e avisa o corretor**, mas quase não **retoma o cliente** fora da prospecção.
- Lead novo: gatilho `no_first_contact` existe no motor (`lib/crm-automation-options.js:7`); se há regra ativa e o que ela faz: NÃO CONFIRMADO (regras vivem no banco, `BUSINESS_RULES.md:124`).
- Em atendimento, Simulação, Documentação, Aprovação, Aprovado, Reunião: só há critérios genéricos (cliente aguardando ação >3 dias sem atividade futura, CLI-13; `no_future_activity`; `activity_overdue`). **Não existe gatilho "parado na etapa há X dias"** (gatilhos em `crm-automation-options.js:4-16`).
- Pós-reunião sem próximo passo: só `activity_overdue/upcoming`; nada específico.
- "Nós falamos por último e o cliente sumiu": só indicador visual "contato em silêncio" ≥180 min (`whatsapp-chat.js:631`); não age.
- "Cliente aguardando resposta nossa": alerta Alexa/Central existe, mas nasce **desligado** (liga em Automações › Alertas; estado atual NÃO CONFIRMADO).
- Cliente em Aguardando aprovação/Restrição/Reprovado: sem rotina de acompanhamento documentada.
- Cliente frio/sem resposta depois da 3ª tentativa: vai para +30 dias e fica sem responsável (PRO-6); **não há reativação 30/60/90** no sistema nem no Guia (Guia: lacuna).
- Fluxos de robô e Disparo para recuperar lead: parados enquanto não houver número oficial.
- Guia pede próximo passo + data, mas **não há checagem automática** de que o corretor definiu (disciplina de preenchimento).

## 5. Conflitos (disputa pelo mesmo cliente / duplicidade)
Parecer do auditor: **nenhuma duplicidade comprovada de mensagem ao cliente**; travas fortes dentro da prospecção, fracas nas fronteiras.
Confirmados no desenho:
1. **P-11**: resposta pelo Chat não atualiza `last_whatsapp_contact_at`; regras "sem primeiro atendimento", "aguardando ação" e o tier "lead aguardando" da roleta ainda veem o cliente como não contatado (`SYSTEM_ARCHITECTURE.md:180`). Risco de cobrar o corretor à toa ou tirar lead dele (ROL-4 exige `last_whatsapp_contact_at` vazio e olha `last_human_reply_at`, `BUSINESS_RULES.md:48`).
2. **P-05 x CLI-9/PRO-6**: cliente devolvido à fila fica sem responsável e o cron `reassignOrphanedClientsToOwner` o devolve ao dono (`SYSTEM_ARCHITECTURE.md:174`, `BUSINESS_RULES.md:20`). Pode anular o "sem responsável" da hibernação; agendamento do cron A CONFIRMAR.
3. **Quatro "devoluções" com critérios diferentes**: ROL-4 (prazo A CONFIRMAR: 5 ou 10 min), PRO-4 (7 dias), hibernação PRO-6 (24 h + 30 dias), ROL-8 (manual) (`BUSINESS_RULES.md:48,52,73,78`).
4. **Sem opt-out geral** (item §3): fere a saída obrigatória "Não contactar" para qualquer cadência futura fora da prospecção.
Possíveis (precisam do banco):
- Regras ativas de `crm_automation_rules` com `send_whatsapp_template` coincidindo com Meta Diária/Disparar: idempotência só protege dentro da mesma regra (`BUSINESS_RULES.md:124`).
- ROL-4 contra cliente em rodada ativa da Meta (tentativa automática pode não preencher `last_whatsapp_contact_at`).
- Alertas somados para a mesma resposta: Alexa, push (PRO-8), `prospecting_reply_alerts`, Central de Alertas, `crm_notifications`, supervisão — sem trava comum documentada.
- Se o número oficial voltar: Fluxos/palavra-chave/Disparo voltam a disputar com a prospecção individual; reauditar nesse momento.
Travas que protegem hoje: PRO-8/9/10, ROL-4 (para ao completar uma volta e avisa o dono), CLI-9, ROL-5/6 (link pessoal e cliente existente não trocam de responsável).

## 6. Qualidade do atendimento (o que permite / impede avaliar)
Permite: cronologia completa por conversa (`whatsapp_messages`: direção, tipo de remetente cliente/usuário/automação, entrega/leitura, por sessão) (`WHATSAPP.md:97`); mensagens enviadas pelo celular do corretor também são gravadas (`:49`); `last_human_reply_at` separa humano de robô; `changed_by` no histórico de status; progresso do Guia por cliente (`GUIA_ATENDIMENTO.md:24`); escopo por perfil.
Impede:
1. Tempo de resposta/1º contato não tem definição oficial (`METRICAS_FUNIL.md:54`).
2. Cobertura incerta: histórico do celular importado vem desligado (`WHATSAPP.md:51`); quem não conectou o WhatsApp não tem conversa gravada.
3. Progresso do Guia é autodeclarado; aderência real exige ler as mensagens; mensagens não têm rótulo de passo do Guia.
4. Pontos/ranking medem uso do sistema, não qualidade; taxa de conversão de rodada varia por uso — não ranquear pessoas (`METRICAS_FUNIL.md:77,101`).
5. `source` nulo em ~82% das linhas de status (`:97`).
6. Horário de expediente por corretor, tipo de lead (quente/frio) e promessas de retorno cumpridas: NÃO CONFIRMADO que existam.
7. Privacidade/LGPD: conversas pessoais podem aparecer; auditoria em massa exige recorte mínimo.
Recomendação do especialista: por ora só avaliação qualitativa por amostra, com devolutiva individual e sem ranking; comparar corretores só depois de definir métrica e medir cobertura.

## 7. Dados que já temos (utilizáveis)
- Funil cumulativo, coorte por criação, tempo entre etapas (mediana/p75/n), perdidos, origem (`METRICAS_FUNIL.md` MET-2 a MET-8). Etapas 1–7 do histórico são confiáveis (MET-13.1).
- Timing: `whatsapp_messages` (data/hora, direção, remetente), `whatsapp_conversations` (`last_inbound_at`, `last_human_reply_at`, origem), `daily_goal_attempts/rounds` (tentativas, conversão da rodada), `prospecting_history`, `lead_distribution_history`, `client_journey_events`.
- Qualidade/Guia: `attendance_guide_progress` (cobertura de preenchimento: NÃO CONFIRMADO).
- Campanhas/Disparo: `whatsapp_broadcast_messages` (entregue/lido/custo por categoria) (`WHATSAPP.md:166`), origem do cliente por campanha.
- Perda estruturada: `do_not_contact` com motivo (cliente solicitou, número inválido, já adquiriu, sem interesse, contato incorreto, outro — `lib/do-not-contact-reasons.js:6-13`). Em 2026-10-02 havia 807 clientes em Não contactar (informado em `BUSINESS_RULES.md:23`).
- Volume: 3.079 clientes em 2026-10-01 (`METRICAS_FUNIL.md:95`; reconferir).

## 8. Dados que estão faltando (começar a registrar)
1. Definição oficial de "1º contato" e "tempo de resposta" (horário útil, fuso, excluir automação) — decisão do dono.
2. Motivo de perda do **Arquivado** (não encontrado campo estruturado; só do Não contactar). NÃO CONFIRMADO no banco.
3. Resultado de cada tentativa de contato (atendeu, pediu retorno, sem interesse) e horário preferido do cliente: não identificado campo.
4. Promessa de retorno cumprida ou não (o Guia gera atividade, mas o cumprimento não é medido como indicador).
5. Uso do Guia: qual card/objeção foi usado, onde o corretor parou, resultado do nó final; ligação do Guia com mudança de status.
6. Tempo parado em cada etapa e motivo da parada (aprovação, documentos, reunião).
7. Opt-out espontâneo fora da prospecção (palavras de parar) e sinal de descontentamento.
8. Cobertura por corretor: quem tem WhatsApp conectado e desde quando.
9. Qualidade percebida (nota do cliente / auditoria de conversa) e motivo de reprovação padronizado.
10. Quais regras do motor de automação estão ativas e com que atraso (está só no banco).

## 9. Oportunidades (sem ranking numérico; não implementar)
**ALTO impacto**
- Corrigir/neutralizar o P-11 e a definição de "último contato" antes de qualquer automação nova (hoje contamina vácuo e cobrança).
- Definir "primeiro contato" e "tempo de resposta" e medir cobertura de conversas por corretor (base para qualidade e vácuo).
- Motor de vácuo por etapa (parado há X dias) com saída obrigatória: respondeu, mudou de etapa, Não contactar, mudou de responsável.
- Roteiros do Guia para Aguardando aprovação, Aprovado, Reunião/visita, Venda e pós-venda (conteúdo financeiro/documental validado pelo dono/Base Mestra).
- Opt-out geral reconhecido como Não contactar em qualquer conversa.
**MÉDIO impacto**
- Reativação 30/60/90 para base fria (exemplos configuráveis; fora Não contactar; mensagem por modelo do canal vigente).
- Ligar o alerta "cliente aguardando resposta" (já pronto, desligado) com horário definido pelo dono.
- Registrar uso do Guia e resultado dos nós finais.
- Painel de saúde da carteira por etapa (parados, sem próxima ação).
- Reconciliar as quatro "devoluções" (ROL-4, PRO-4, PRO-6, P-05) em uma tabela única de regras.
**BAIXO impacto**
- Motivo estruturado para Arquivado.
- Revisão de português/tom dos modelos e do Guia.
- Experimentos A/B de mensagem (só com amostra suficiente).
- Unificar canais de alerta para evitar aviso duplicado.

## 10. Visão futura (direção, sem compromisso)
Operação em que o **corretor continua humano no seu WhatsApp**; o CRM mostra a cada manhã "quem precisa de você agora" e por quê; o futuro **WhatsApp Oficial** (conjunto de linhas oficiais, planejado ~6 — não confirmado no código, `docs/atendimento/contexto/whatsapp-oficial.md:6`) faz aquisição, pré-atendimento determinístico, cadências e reativação 30/60/90, sem substituir o corretor; um **motor de vácuo** (evento → contexto → condições → etapa → comportamento → origem → horário provável → regras do canal → histórico → tentativa → ação → espera → saída) com horário provável como sinal probabilístico; análise de comportamento (quando o lead costuma responder) por dados de `whatsapp_messages`; **auditoria de conversas** por amostra com devolutiva, aderência ao Guia e sugestões de melhoria do Guia (sempre sugestão, nunca alteração); **dados de conversão** por coorte ligando origem, primeiro contato, cadência e venda; toda automação nova passando pelo auditor antes do dono aprovar, com "Não contactar" como saída absoluta. Regras da Meta (templates, janela, qualidade, limites) só de documentação oficial atual.

## Equipe consultada
Consultados: followup-vacuo (vácuos), qualidade-atendimento (avaliar corretores), dados-conversao (dados existentes/faltantes), auditor-automacoes (conflitos), atendimento-imobiliario (cobertura do Guia).
Deliberadamente NÃO consultados: whatsapp-oficial-meta (nenhuma regra da Meta é necessária para diagnosticar; fica para o desenho do WhatsApp Oficial), compliance-lgpd (opt-out e retenção entram como risco aqui; parecer quando houver proposta de contato automático/reativação), copy-comercial, portugues-comunicacao, vendas-conversao, comportamento-lead, reativacao-30-60-90, simulacao, documentacao, primeiro-imovel-mcmv, customer-success-jornada, experimentacao-ab (são de projeto, não de diagnóstico). `analista-dados` não é acionável pelo Diretor: pedir à Central.

## Informações que ainda faltam
1. Regras ativas em `crm_automation_rules` (gatilho, atraso, ações) e se alguma envia WhatsApp ao cliente.
2. Estado real do número/WABA oficial, modelos aprovados e plano para o WhatsApp Oficial (quantidade de linhas, distribuição).
3. Quantos corretores têm WhatsApp individual conectado e desde quando; cobertura de mensagens por corretor.
4. Versão PUBLICADA do Guia no banco (`attendance_guides.published_graph`) e uso real (`attendance_guide_progress`).
5. Volume por etapa de clientes "aguardando ação" >3 dias e quantos depois avançam; mediana de 1º contato por origem.
6. Se `reply_waiting` (alerta de cliente aguardando) está ligado e com qual horário.
7. Agendamento do cron que devolve órfãos ao dono (P-05) e prazo gravado da ROL-4.
8. Preenchimento do motivo em Arquivado e ranking de motivos de Não contactar.
9. Definições do dono: 1º contato, tempo de resposta, horário de expediente.
