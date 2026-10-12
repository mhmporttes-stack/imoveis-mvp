# Rodada 2 — Cadeira Viabilidade no CRM (Versão 10 + Especificação final)

> Escrita antes de receber a decisão 12 (aprovação das recomendações). Itens que ela resolve: opção A, uma vez por período fechado, 2 h entre lembretes.

## Respostas à V5
Aceita corte de A2/espera (item 4 sai; item 3 fica, protege botões de E); roteador → Fase 3; B9 → pessoa (M5); plural — resto em 1ª pessoa no lembrete único WA-17 (`lib/whatsapp-form-reminder-core.mjs:111`, "posso te ajudar") entra na Fase 2.

## Código conferido
| Item | Código | Esforço | Migration |
|---|---|---|---|
| Silêncio → roleta | Lugar certo: `reconcileAdWaitingClients` (`lib/whatsapp-sponsored-lead.js:569-596`, cron `scheduled-activities` `route.js:117`), que já chama o único caminho de liberação `releaseAdWaitingClient` (L459). 3º caso "silêncio". | M | não |
| Dupla roleta | Liberação só grava se ainda segurado (L485-492); formulário reaproveita corretor sorteado (L495-497). | 0 | — |
| Presença/fila/REDISTRIBUIÇÃO | `assignRoundRobinLead` (L496-497); sem ninguém on-line → fila com o dono (L498-500), entregue 1 por corretor por rodada; REDISTRIBUIÇÃO já vale para anúncio (`lib/simulation-deadline-core.mjs:33-38`). | 0 | — |
| Aviso ao corretor | `afterRelease` (L514-566) já notifica + push; falta texto "não respondeu às mensagens automáticas" e marca `anuncio_silencio`. | P | — |
| Madrugada | `notifyStaff` (L58-70) avisa todos admins/gestores a cada cliente → barulho às 8 h. | — | — |
| Regras | Função pura `decideSilenceTransfer` em `lib/whatsapp-ad-waiting-core.mjs`, contada da **A1**; não transfere se respondeu, preencheu, equipe escreveu/mexeu (ROL-4d), Particular/excluída/finalizada; `canReleaseAdWaitingClient` com `via: "silence"`; não retroativo (data de corte). | M | não |
| Fora do horário | Laço próprio após `lib/whatsapp-master.js:639-651` (mídia não entra no atual, L628/L860-866); reserva `after-hours:<conversa>:<período>` em `meta_message_id` (índice único `20260923210000_whatsapp_chat.sql:78`), como `lib/whatsapp-form-reminder.js:194-213`; botão via `sendWhatsappMessagePayload` (L200) montado como `whatsapp-flow-core.mjs:408`; segurado recebe `/s` genérico (`whatsapp-flows.js:359`); horário `isWithinBusinessHours` (L425). | M | não |
| Não reiniciar lembretes | `isCrmSentLinkMessage` (L150-156) só exclui `form_reminder` → marcar/excluir `after_hours_reply`. | P | não |
| 8 h | `currentReminderStep` (L72-98): 21h–8h → 8 h, atraso das 8 h, uma mensagem (já natural), espaço mínimo via `firstSentAtFor` (L98); "Bom dia" fixo; pior caso link 11h01 → 8h (21 h, janela ok, L244-247). Corte 23 h: `AD_REMINDER_STEPS` (L31-36), textos (L100-105). | M | não |
| "Não sai se pessoa escreveu" | Já existe (L214, L223). | 0 | — |
| B12 | `isClearOptOut` (`lib/prospecting-reply-core.mjs:97`); `applyAutomaticOptOut` não exportada (`lib/prospecting-reply.js:160`) → versão p/ Oficial com `clientDoNotContactPatch`. Ordem: Chat (L593) → parar → liberação (L603-618, pula quem pediu) → Fluxo/palavra-chave (com trava) → fora do horário. | M | não |
| Guia | **Não por seed**: `ensureSeedGuides` só roda com tabela vazia (`lib/attendance-guides.js:62-95`) → cadastrar e publicar **pela tela** (Gestão > Guia de Atendimento). | P (tela) | não |
| `interest_rate_annual` | Campo opcional e recente (`20261005150000_simulations_interest_rate.sql`; `lib/simulation-mapper.js:173`): vazio = não informado. | — | — |

## Questionamentos à V9
1. Uma A1 só desde a Fase 1: "te manda o resultado" já é verdade hoje para quem preenche (formulário libera para a roleta, `lib/simulation-registrations.js:205-218`; 1ª mensagem do corretor = simulação, ROL-4c; prazo 10 min). Fora do horário com prazo verdadeiro ("no nosso horário de atendimento").
2. Transferência não deve depender do lembrete de 3 h (janela fechada/falha/Chat desativado, L245-255, travariam; e o link só é relido às 10 h, `linkMayBeDue` L108-115) → horário próprio (A1 + 3 h; 21h–8h → 8 h) com a mesma função de horário, dentro da liberação WA-18.
3. Lembrete de 10 h "alguém vai te chamar" não é garantido (REDISTRIBUIÇÃO pode girar) → texto condicional da V8.

## VERSÃO 10
Voz "a equipe", plural, ≤ 1 emoji; nada para Não contactar/arquivado/Particular/equipe. Botão = "Fazer simulação" → `/s` (segurado: `/s` genérico). Fora = fora de seg–sáb 8h–19h. Sem nome: tira vírgula e nome.

**A. Anúncio (Oficial), 1 envio**
- A1 horário: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Pra montar sua simulação (quanto você pode financiar e a parcela), é só responder umas perguntas rápidas no link abaixo. Não pede CPF nem documento, e é sem compromisso. Assim que você enviar, um especialista da nossa equipe te manda o resultado por aqui. Se preferir, manda sua dúvida aqui mesmo, escrita ou em áudio." + Botão
- A1 fora: igual até "...sem compromisso." + "Depois que você enviar, um especialista da nossa equipe te manda o resultado por aqui, no nosso horário de atendimento: segunda a sábado, das 8h às 19h. Se esse horário não der pra você, é só avisar que a gente combina outro." + Botão

**B.** Horário: nada automático (M1–M5). Fora (travas V8; texto, áudio, imagem, vídeo, documento; não reação/figurinha):
- Não preencheu: "Recebemos sua mensagem{{, Nome}}! Nosso horário de atendimento é de segunda a sábado, das 8h às 19h; fora dele, a equipe te responde assim que possível. Se esse horário não der pra você, conta pra gente qual fica melhor que a gente combina. Se quiser adiantar, a simulação não pede CPF e não consulta seu nome:" + Botão
- Já preencheu: até "...que a gente combina.", sem botão.
- B12 (antes da liberação): "Tudo bem{{, Nome}}, não vamos mais te mandar mensagem. Se um dia quiser, é só chamar aqui." → Não contactar. B1–B10/B9: Fase 3.

**C. Lembretes do anúncio 1 h / 3 h / 10 h** (21h–8h → uma às 8 h; 2 h mínimas)
- 1 h: "{{Nome}}, conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio."
- 3 h: "Só lembrando: com a simulação você já fica sabendo quanto pode financiar e a parcela pro seu caso. Não pede CPF e é sem compromisso. É só tocar em Fazer simulação, na mensagem acima."
- 10 h: "{{Nome}}, essa é nossa última mensagem sobre a simulação 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer do mesmo jeito. Se preferir conversar, é só responder aqui que a nossa equipe te chama."
- 8 h: "Bom dia{{, Nome}}! " + texto da etapa (sem nome inicial, maiúscula).
- Lembrete único (não anúncio, WA-17): "Oi{{, Nome}}, tudo bem? Vimos que você ainda não preencheu o formulário. Ficou com alguma dúvida ou teve alguma dificuldade? Se preferir, a gente te ajuda por aqui."
- **Transferência:** A1 + 3 h (21h–8h → 8 h), sem resposta, sem formulário, sem equipe → roleta (WA-18), sem mensagem ao cliente.

**D.** Horário: "Recebemos seu cadastro{{, Nome}}! Obrigado pela confiança. Agora um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui, neste mesmo número." / fora: "Recebemos seu cadastro{{, Nome}}! Obrigado pela confiança. Um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui. Nosso atendimento é de segunda a sábado, das 8h às 19h; fora dele, a gente responde assim que possível. Se esse horário não der pra você, conta pra gente qual fica melhor."

**E.** "{{saudacao}}{{, Nome}}! Aqui é da equipe do Matheus Machado Imóveis. Como podemos te ajudar?" [Fazer simulação] [Já sou cliente] [Tenho uma dúvida] → Simulação: A1 sem frase do anúncio; Já sou cliente: "Que bom falar com você de novo! Avisamos quem cuida do seu atendimento, que te responde por aqui." (+ frase de horário de B se fora) → `base_roulette`; Dúvida/outra → pessoa; sem resposta → stop.
**F.** Corretor sem automação; TESTE fica.
**G. Guia (tela):** "Lead de anúncio: primeira resposta (texto ou áudio)" com M1–M5 + abertura do silêncio: "Oi, [Nome]! Aqui é o(a) [seu nome], da equipe do Matheus Machado Imóveis. Vi que você chamou pelo anúncio da simulação. Posso te ajudar por aqui mesmo?"

## Especificação final
**Fase 1 (configurar):** A1, D, E sem B9, plural; horário seg–sáb 8h–19h em cada bloco (padrão seg–sex 9–18, `whatsapp-flow-core.mjs:69`); TESTE sem disputa (`whatsapp-flows.js:796`); só Pré-visualização. Desfazer: texto anterior na tela.
**Fase 2 (código, sem migration; 1 commit por item; `git revert` por item; `auditor-automacoes` antes de publicar):**
1. Trava Não contactar — `lib/whatsapp-flows.js`, `lib/whatsapp-master.js:250`; `tests/do-not-contact-core.test.mjs`. P.
2. B12 no webhook antes de `processSponsoredLeads`/`processOrganicLeads`; opt-out Oficial com `clientDoNotContactPatch`; testes `prospecting-reply-core` + novo; `/registrar-regra`. M (falso positivo → PRO-8 opção B).
3. Formulário encerra sessão viva — `lib/simulation-registrations.js:205-218` + teste. P.
4. Lembretes — `lib/whatsapp-form-reminder-core.mjs`/`.js`: textos sem nome, plural no único, corte 23 h, 8 h (função de horário exportada), 2 h mínimas, excluir `after_hours_reply`; `tests/whatsapp-form-reminder.test.mjs` (madrugada, sáb 22h, várias etapas → uma, janela 24 h) + `whatsapp-ad-waiting`; `/registrar-regra` (6 e 8). M.
5. Fora do horário — `lib/whatsapp-after-hours-core.mjs` + `tests/whatsapp-after-hours-core.test.mjs`; laço após `lib/whatsapp-master.js:651`. M.
6. Guia pela tela (despublicar para desfazer).
7. Transferência do silêncio — `decideSilenceTransfer` + `via: "silence"` (`lib/whatsapp-ad-waiting-core.mjs`); 3º caso em `reconcileAdWaitingClients`; texto em `afterRelease`; corte não retroativo; `tests/whatsapp-ad-waiting.test.mjs` (madrugada → 8 h, equipe já escreveu, Particular, corrida); `/registrar-regra` (10). M.
Depois: `pnpm build`, testes, `docs/WHATSAPP.md` §8/§9-B/§9-C, `docs/BUSINESS_RULES.md` WA-17/18, `docs/CHANGELOG_AI.md`.
**Fase 3:** "Assunto" + B1–B10/B9 (status de outra cidade); botão nos lembretes; horário na tela; ID do anúncio em conversa existente (migration); gasto por hora.

## Em aberto (após decisão 12)
Retroativo (recomendação: não); 8 h vale também para o lembrete único (mesa: sim, pela decisão 8); quem publica no Guia (dono ou gestor); status de outra cidade (rodada 3); aprovar Fases 1 e 2.

## Para a rodada 3
Dados: segurados > 3 h por janela; fila às 8 h e tempo de entrega; avisos `notifyStaff`/dia. Humanizado: abertura do silêncio e texto de 10 h. WhatsApp: ordem do webhook com mídia. Tráfego: meta com transferência.

---
## Adendo (mesma cadeira, já com a decisão 12)
- **H. Outra cidade = status "Tentando contato" + tag "Outra cidade"**, marcado pela pessoa após o M5. Sem código.
  - Sai da REDISTRIBUIÇÃO: só "Atendimento automático" de anúncio é exceção (`lib/simulation-deadline-core.mjs:33-45`); mensagem do corretor já segura (L13-16).
  - Fora da roleta: não está na fila de espera.
  - Não perde o contato: se voltar a escrever, passa sozinho para "Em atendimento" (`lib/whatsapp-client-status-core.mjs:25`); conversa continua no Chat (não é arquivado, WA-13); responsável mantido.
  - Sem cobrança automática: "sem atividade futura" ignora esse status (`lib/crm-automations.js:269`).
  - Ressalva: o nome não descreve o caso (a tag identifica); status próprio exigiria código em `lib/client-status.js` e `ROULETTE_INELIGIBLE_STATUSES` (`lib/client-distribution-core.mjs:58`).
- A1 fora do horário (ajuste): igual à do horário até "...te manda o resultado por aqui." + "Nosso atendimento é de segunda a sábado, das 8h às 19h; fora dele, a equipe te responde assim que possível. Se esse horário não der pra você, é só avisar que a gente combina outro." + Botão
- D fora (ajuste): "Recebemos seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Nosso atendimento é de segunda a sábado, das 8h às 19h; fora dele, um especialista prepara sua simulação assim que possível e te chama por aqui. Se esse horário não der pra você, conta pra gente qual fica melhor."
- E → [Tenho uma dúvida]: "Pode mandar sua dúvida por aqui, escrita ou em áudio, que a nossa equipe te responde." → pessoa.
- Guia: no guia "Lead — patrocinado", pela tela (admin ou gestor). Fase 1 inclui a entrada do Guia.
- Ordem da Fase 2 revisada: 1 trava Não contactar → 2 B12 → 3 formulário encerra sessão (`endLiveFlowSession`, `lib/whatsapp-flows.js:337`) → 4 lembretes → 5 transferência do silêncio → 6 resposta fora do horário. Testes de lembrete: lead às 20h → uma mensagem às 8 h com texto de 10 h; lead 11h01 dentro da janela; 2 h mínimas; chave de 23 h nunca gerada; resposta fora do horário não reinicia. Riscos: avisos "aguardando corretor" às 8 h; 2 mensagens no mesmo webhook (chave única segura); link do dono vazando para segurado.
- `interest_rate_annual` existe só desde 05/10 → separar antes/depois.
- Em aberto: transferência só daqui para frente (rec.: sim); 8 h e 2 h também no lembrete único WA-17 (rec.: sim); outra cidade = "Tentando contato" + tag?; quem cria a entrada do Guia; aprovar Fases 1 e 2; tráfego H1–H4.
