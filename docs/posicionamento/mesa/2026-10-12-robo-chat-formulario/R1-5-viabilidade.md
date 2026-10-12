# Rodada 1 — Cadeira Viabilidade no CRM (Versão 5 + Especificação)

## Código conferido
| # | Afirmação | Código | Esforço |
|---|---|---|---|
| 1 | Áudio "vazio/ignorado" no Fluxo | **Áudio nem chega ao Fluxo**: `lib/whatsapp-master.js:628` só repassa com `message_text`; `extractMessageText` (L860-866) nulo p/ áudio/imagem. Mas o áudio já solta o cliente para a roleta (`lib/whatsapp-sponsored-lead.js:308-317`) → pessoa recebe, robô calado | M |
| 2 | Respostas por tema | Sem condição por conteúdo (`CONDITION_KINDS`, `whatsapp-flow-core.mjs:29`); resposta a botão não vira variável (só "pergunta", L546) | M |
| 3 | A2 "só se não preencheu" | **Formulário não encerra a sessão viva** (só o Chat chama `endLiveFlowSession`, `lib/whatsapp-chat.js:2136`). Com A2 viva, "preenchi meu cadastro" cai na sessão (`whatsapp-flows.js:697-704`) e o Fluxo "Formulário concluído" não roda → quebra D | P |
| 4 | Cliente escreve na espera de 3 min | Mensagem descartada (`runFlow` L539 `ignored`) e `processFlowInbound` devolve "tratei" (L704), bloqueando palavra-chave; A2 depois pergunta "ficou dúvida?" a quem já perguntou | P |
| 5 | Não contactar em Fluxos/palavra-chave | Confirmado: `processFlowInbound` (L680-686), cron (L821-842), `processAutomationReply` (`whatsapp-master.js:249-273`) não checam; lembretes checam (`form-reminder-core.mjs:230,235`) | P |
| 6 | B12 marca Não contactar | Reaproveitar `isClearOptOut` (`lib/prospecting-reply-core.mjs:97`, PRO-8) e `applyAutomaticOptOut` (`lib/prospecting-reply.js:160`, exportar; `clientDoNotContactPatch`, CLI-9). Hoje só no WhatsApp pessoal | M |
| 7 | B9 encerra sessão e lembretes | **Já dá**: ação finish (`whatsapp-flows.js:576`) → lembrete pula `conversa_finalizada` (`form-reminder-core.mjs:226`) | 0 |
| 8 | B11 → roleta | Cliente segurado do anúncio: ação roulette não escolhe corretor (`whatsapp-flows.js:513-514`); quem solta é a resposta dele (WA-18) | 0 |
| 9 | Lembretes: textos/corte 23 h | Fixos em `form-reminder-core.mjs:31-36,100-105`; botão exige trocar `sendWhatsappTextMessage` (`whatsapp-form-reminder.js:10`) | P (botão M) |
| 10 | B7 "lembretes continuam" | **Falso**: resposta do cliente cancela a sequência (L210-212); só volta com link novo (L158-166, L220) | texto |
| 11 | Toque em botão = resposta | Confirmado (`whatsapp-ad-waiting-core.mjs:16-24`); mudar altera WA-18 — não proposto | — |
| 12 | Webhook 30 s | `maxDuration` em `app/api/webhooks/whatsapp-master/route.js:8`; 2 envios ≈ 8 s | ok |
| 13 | Idempotência | `event_key`; lembrete `form-reminder:<link>:<etapa>`; tirar 23 h não pendura nada | ok |

**Meta × CRM (provável, sem banco):** origem da conversa só é gravada se vazia (`supabase/migrations/20261009160000_whatsapp_private_conversations.sql:39-42`) → quem já tinha conversa fica sem ID; sem `referral` (caso Luana) o texto pré-preenchido só dispara o Fluxo, não grava origem nem segura o lead (`whatsapp-referral.mjs:70-73`) → entra como "Contato direto". Carrossel: mesma hipótese, ou anúncio para outro número (descartado, `whatsapp-master.js:683`). Teste p/ Dados: `whatsapp_master_events` 06–10/10 com texto pré-preenchido sem `referral` (~7 → Meta sem referral; 0 → conferir número no Gerenciador).

## Questionamentos
1. "Uma resposta por tema, repetiu → B11": a 1ª resposta já entrega ao corretor (WA-18); robô respondendo tema após tema fala por cima dele → **uma** resposta e passa para pessoa, sem estado novo.
2. Condição "já preencheu": basta o formulário **encerrar a sessão viva** (conserta D também).
3. A1 "um especialista vai te atender" é falso para quem não responde nem preenche (fica com o dono, WA-18) → promessa condicionada ao envio.
4. B7 "lembretes continuam" só com botão.
5. Roteamento dentro do Fluxo (não ampliar palavras-chave: não rodam com sessão viva, sem horário/botão, URL reinicia lembretes sem controle).
- Lembrete de 10 h às 8 h: ~20 linhas em `currentReminderStep` + 3 testes; adia se cair 21h–8h; pior caso link + 21 h (< 23h55, janela ok). Desfaz "roda 24 h" de 09/10 → precisa "sim" do dono. Só a de 10 h.

## VERSÃO 5
Botão = link "Fazer simulação" → `/s`. Fora do horário = fora de seg–sáb 8h–19h (`business_hours`). Fala como "a equipe" (sem "eu", sem "assistente virtual"). Nada para Não contactar.

**A. Anúncio (Oficial)**
- A1 horário: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Pra montar sua simulação (quanto você pode financiar, a parcela, os benefícios e um imóvel sugerido), responde umas perguntas rápidas no link abaixo. Não pede CPF nem documento, e é sem compromisso. Assim que você enviar, um especialista da nossa equipe te chama por aqui." + Botão
- A1 fora: mesmo começo até "sem compromisso." + "Nosso atendimento é de segunda a sábado, das 8h às 19h. Se esse horário não der pra você, é só avisar que a gente combina outro. Assim que você enviar, um especialista te chama por aqui." + Botão
- Espera 3 min (3–5 na prática, cron 2 min): escreveu → B; preencheu → sessão termina (D).
- A2: "Se tiver alguma dúvida, pode mandar por aqui, escrita ou em áudio." [Tenho uma dúvida] [Falar com alguém]; 50 min → stop. Dúvida → "Pode mandar, {{primeiro_nome}}! Escreve do seu jeito que a gente te ajuda." → B; Falar → B11; outra → B.

**B. Uma resposta automática, depois pessoa.** Cada texto termina com "Qualquer outra dúvida, pode mandar por aqui que a nossa equipe te responde."
- B1–B6 e B8: textos da V4 + Botão.
- B7: "Sem pressa! Deixo o link aqui pra quando tiver uns minutinhos." + Botão
- B9: "Obrigado por avisar, {{primeiro_nome}}! Nós trabalhamos com imóveis em Marília/SP. Você quer comprar aqui em Marília?" [Sim, em Marília] [Outra cidade] → Sim: "Ótimo! Então dá pra seguir normalmente:" + Botão / Outra: "Entendi! Por enquanto a gente só trabalha com imóveis em Marília, então não vou conseguir te ajudar dessa vez. Se um dia pensar em Marília, é só chamar aqui." → tag "Outra cidade" + finish
- B10 (áudio; Fase 3): textos da V4.
- B11 horário: "Claro, {{primeiro_nome}}! Deixei seu recado com a nossa equipe, e um especialista te responde por aqui." / fora: "Claro, {{primeiro_nome}}! Nosso atendimento é de segunda a sábado, das 8h às 19h. Se esse horário não der pra você, me diz qual fica melhor que a gente combina. Enquanto isso, se quiser adiantar:" + Botão → handoff
- B12 (PRO-8; dúvida → pessoa): "Tudo bem, {{primeiro_nome}}, não vou mais te mandar mensagem. Se um dia quiser, é só chamar aqui." → Não contactar.

**C. Lembretes (1 h / 3 h / 10 h)**
- 1 h: "{{primeiro_nome}}, ficou alguma dúvida sobre a simulação? Pode perguntar por aqui, escrita ou em áudio."
- 3 h: "Só lembrando: a simulação é sem compromisso, não pede CPF e leva poucos minutos. Com ela o especialista já chega com os valores do seu caso. É só tocar em Fazer simulação, na mensagem acima." (Botão na Fase 3)
- 10 h: "{{primeiro_nome}}, esse é o último lembrete 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer a simulação do mesmo jeito. Se preferir, responde aqui que nossa equipe te chama." (adiar p/ 8 h = dono)

**D.** Pós-formulário: textos da V4. **E.** Sem anúncio: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis. Como posso te ajudar?" [Fazer simulação] [Já sou cliente] [Tenho uma dúvida]; Simulação → A1 sem promessa do anúncio; Já sou cliente → "Que bom falar com você de novo! Avisei quem cuida do seu atendimento, que te responde por aqui." (fora como B11) → `base_roulette` (mantém responsável); Dúvida → B. **F.** Corretor sem robô; TESTE fica.

## Especificação em fases
**Fase 1 — só configurar Fluxos (zero código):** A1 (horário/fora), D, E, B9 com finish, B11 por horário. **Ainda sem A2/espera/B** (sessão viva engoliria "preenchi meu cadastro" e a mensagem na espera). Conferir se "TESTE anúncio" tem o mesmo gatilho (ganha o mais antigo, `whatsapp-flows.js:796`). Testar só na Pré-visualização.
**Fase 2 — código pequeno (6 itens P/M, sem migration):**
1. Trava Não contactar em `processFlowInbound`/`executeSession` (`lib/whatsapp-flows.js`) e `processAutomationReply` (`lib/whatsapp-master.js`), função pura em `lib/do-not-contact-core.mjs`; teste `tests/do-not-contact-core.test.mjs`.
2. Opt-out no Oficial (B12) no webhook antes dos Fluxos: `isClearOptOut` + exportar `applyAutomaticOptOut`; testes `tests/prospecting-reply-core.test.mjs` + novo; `/registrar-regra`.
3. Formulário encerra sessão viva: `endLiveFlowSession(telefone, "formulario_preenchido")` em `lib/simulation-registrations.js:205-215`; teste.
4. Saída "Se o cliente escrever" no bloco de espera (`whatsapp-flow-core.mjs` getOutputPorts + L537-539); teste `tests/whatsapp-flow-core.test.mjs`.
5. Variável `ultima_mensagem` + condição "Assunto" com listas fixas em `lib/whatsapp-topic-match.mjs` (reusa `keywordMatchesMessage`), menu em `components/flows/FlowNodePanel.jsx`; teste novo `tests/whatsapp-topic-match.test.mjs`.
6. Lembretes: textos novos e corte de 23 h (`form-reminder-core.mjs:31-36,100-105`); testes `whatsapp-form-reminder` e `whatsapp-ad-waiting`; registrar mudança na WA-18.
Depois: `pnpm build`; `docs/WHATSAPP.md` §8/§9-C; `docs/CHANGELOG_AI.md`. Falha sempre vai para pessoa (`executeSession` L631-638); roleta e WA-18 intactas.
**Fase 3:** áudio/imagem com sessão viva (M); botão de link nos lembretes (M); 10 h → 8 h (P, com "sim"); gravar ID do anúncio mais recente em conversa existente (M, migration); medição por anúncio.

## Para a rodada 2
Dados: teste do referral do carrossel; respostas de anúncio durante sessão viva/espera; áudios sem resposta; % "Contato direto" sem ID; revalidar base 42 %. Dono: 10 h → 8 h?; B9 "Outra cidade" ainda entra na roleta (marcar?); B com link reinicia 1h/3h/10h (manter?); aprovar Fase 1 / Fase 2.
