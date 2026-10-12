# Rodada 2 — Cadeira WhatsApp e automação (Versão 8)

## Objeções contra a V3
Aceita: A2/espera cortadas (0 respostas durante sessão; 6/13 chegariam na espera; 5/9 preenchem entre 3–10 min); roteador na Fase 3; texto da V7 (13/13 atendidos; resposta solta para roleta pela WA-18). B7 estava errado: qualquer mensagem cancela a sequência (`lib/whatsapp-form-reminder-core.mjs:210-212`).

## Código conferido
- Áudio/imagem não chegam ao Fluxo nem à palavra-chave (`lib/whatsapp-master.js:628`; `extractMessageText` L860-866). Roleta/WA-18 rodam antes para qualquer mensagem não-reação (`lib/whatsapp-sponsored-lead.js:303-319`). → resposta fora do horário precisa de laço próprio, depois do download da mídia (L620-626) e do laço Fluxo/palavra-chave (L639-651), só se ninguém respondeu; `processAutomationReply` (L250-309) passa a devolver se enviou.
- **Ordem no webhook:** 1) Chat (L593) → 2) **B12 novo** (só texto, `isClearOptOut`; antes da liberação da roleta) → 3) Lead patrocinado/contato direto (L603-618; pula liberação se for "parar") → 4) Mídia (L620) → 5) Fluxo, palavra-chave → 6) **Resposta fora do horário nova**.
- "Uma vez" sem tabela: reserva por chave única `whatsapp_messages.meta_message_id` (como `lib/whatsapp-form-reminder.js:194-204`), chave `after-hours:<conversa>:<início do período fechado>`; só se `last_human_reply_at` vazio e nenhuma automação no período (A1/D/E fora já falam do horário).
- Lembretes: mensagem do cliente cancela a sequência (desejável). **Armadilha:** resposta fora do horário com link `/s` contaria como link novo (L150-156, L159-166) e reiniciaria a sequência → marcar `metadata.kind = "after_hours_reply"` e excluir em `isCrmSentLinkMessage`.
- Nome vazio: lembretes são texto fixo; usar `usableFirstName` (L115-121) com versão sem nome.
- 8 h: hoje vale a etapa vencida mais recente com atraso máx. 3 h (L72-98, L86) → etapa das 02 h seria pulada. Ajuste: 21h–8h → 8 h, atraso contado das 8 h, várias etapas viram **uma** mensagem (texto da última), espaço mínimo entre lembretes (sugestão 2 h); "Bom dia" via `getTimeGreeting` (`lib/daily-report.js`); pior caso cabe na janela (checada L244-247).
- B9 no E: sem gatilho (3 botões no máximo; sem condição por texto, `lib/whatsapp-flow-core.mjs:29`); cliente já está na roleta (`whatsapp-sponsored-lead.js:256-297`); tag (`lib/whatsapp-flows.js:569-575`) e finish (L576-577) **não tiram da roleta/REDISTRIBUIÇÃO**.

## Questionamentos à V7
1. B9 no E na Fase 1: sem gatilho e sem efeito na roleta → pessoa pergunta (M5) até a Fase 3; status de outra cidade = dono.
2. Resposta fora "uma vez por conversa, sempre com botão" reinicia lembretes, repete A1 fora e oferece simulação a quem já preencheu → uma vez por **período fechado**, só antes da 1ª resposta humana, sem automação no período, sem botão para quem já preencheu.
3. Lembrete 3 h "na mensagem acima" pode ficar longe após o ajuste das 8 h → risco anotado; botão na Fase 3.

## VERSÃO 8
Voz "a equipe", plural; ≤ 1 emoji. Não contactar, arquivado, Particular ou número da equipe não recebem nada. Botão = "Fazer simulação" → `/s`. Fora = fora de seg–sáb 8h–19h (Brasília).

**A.** A1 horário e fora: textos da V7. 1 envio; sessão termina.

**B. Cliente escreve/manda mídia depois**
- Horário: nada automático; pessoa (M1–M5).
- Fora (passo do webhook; só se 1ª no período fechado, ninguém da equipe respondeu, nenhuma automação no período; texto, áudio, imagem, vídeo, documento — reação e figurinha não):
  - não preencheu: "Recebemos sua mensagem{{, Nome}}! Nosso atendimento é de segunda a sábado, das 8h às 19h, e a equipe te responde assim que começar. Se esse horário não der pra você, conta pra gente qual fica melhor que a gente combina. Se quiser adiantar, a simulação não pede CPF e não consulta seu nome:" + Botão
  - já preencheu: igual até "...que a gente combina.", sem a última frase e sem botão.
- B12 (webhook): "Tudo bem{{, Nome}}, não vamos mais te mandar mensagem. Se um dia quiser, é só chamar aqui." → Não contactar.
- B9, B1–B8, B10: Fase 3 (pessoa pergunta a cidade, M5).

**C. Lembretes 1 h / 3 h / 10 h** (21h–8h → uma mensagem às 8 h)
- 1 h: "{{Nome}}, conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio." (sem nome: "Conseguiu abrir o link da simulação? ...")
- 3 h: texto da V7.
- 10 h: "{{Nome}}, essa é nossa última mensagem sobre a simulação 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer do mesmo jeito. Se preferir conversar, é só responder aqui que a nossa equipe te chama." (sem nome: "Essa é nossa última mensagem...")
- Às 8 h: prefixo "Bom dia, {{Nome}}!" / "Bom dia!" e maiúscula na frase seguinte.

**D.** V7. **E.** V7 **sem B9**; "Outra resposta" → pessoa; pergunta sem resposta → stop (não finish, que mata lembretes). **F.** Corretor sem automação; TESTE fica. **G.** Roteiro M1–M5.

## Especificação
**Fase 1 (configurar):** A1 horário/fora, D, E sem B9, plural; condição de horário seg–sáb 8h–19h em **cada** bloco (padrão do sistema é seg–sex 09–18, `whatsapp-flow-core.mjs` L69); conferir disputa de gatilho com TESTE (`whatsapp-flows.js:796`); testar só na Pré-visualização.
**Fase 2 (código, sem migration):**
1. Trava Não contactar: `processFlowInbound`/`executeSession` (`lib/whatsapp-flows.js`), `processAutomationReply` (`lib/whatsapp-master.js`); `tests/do-not-contact-core.test.mjs`.
2. B12: exportar `applyAutomaticOptOut` (`lib/prospecting-reply.js:160`) ou equivalente p/ Oficial; webhook após o Chat; `processOrganicLeads` pula liberação se "parar"; `tests/prospecting-reply-core.test.mjs`; `/registrar-regra`.
3. Formulário encerra sessão viva: `lib/simulation-registrations.js:205-215` + teste.
4. Lembretes (`lib/whatsapp-form-reminder-core.mjs`): textos com versão sem nome; corte 23 h; ajuste 8 h (atraso, uma mensagem, espaço mínimo); excluir `after_hours_reply` em `isCrmSentLinkMessage`; testes `tests/whatsapp-form-reminder.test.mjs` + `whatsapp-ad-waiting`; `/registrar-regra` (decisões 6 e 8).
5. Resposta fora do horário: módulo puro `lib/whatsapp-after-hours-core.mjs` (horário, travas, chave do período, texto) + `tests/whatsapp-after-hours-core.test.mjs` (áudio, já preencheu, sáb 19h → seg 8h, A1 fora já enviada, Não contactar); envio em `lib/whatsapp-master.js` (laço após L651; `processAutomationReply` devolve se enviou).
Depois: `pnpm build`; `docs/WHATSAPP.md` §8/§9-C; `docs/CHANGELOG_AI.md`. Falha → pessoa.
**Fase 3:** condição "Assunto" + B1–B10 + B9 (com status de outra cidade); botão nos lembretes; horário configurável na tela; ID do anúncio em conversa existente.

## Decisões do dono
1. Cliente de outra cidade (que não quer Marília): que status/etapa recebe para sair da roleta e da REDISTRIBUIÇÃO?
2. Resposta fora do horário "uma vez por período fechado" e espaço mínimo de 2 h entre lembretes: aprovar?
3. Aprovar Fase 1 e Fase 2 (nada vai à produção sem "sim" e sem `auditor-automacoes`).

## Para Tráfego
Lead da noite recebe A1 fora + no máximo 1 lembrete às 8 h (avaliar programação por horário com dados, sem número); promessa = A1 ("quanto pode financiar e a parcela, sem CPF, sem compromisso"); destino sempre Oficial (decisão 9); TESTE não disputar gatilho; medir pelo ID do anúncio.
