# Rodada 2 — Cadeira Atendimento humanizado (Versão 7)

## Resposta às objeções contra a V2
1. Assistente virtual vetado (decisão 4) → sai "não consigo ouvir"; fica "Recebemos sua mensagem".
2. "Já avisei" → "deixamos seu recado" (plural).
3. Roteador tema a tema retirado (13/13 atendidos por pessoa, ~5 min); a empatia dos temas vai para o roteiro humano.
4. Quem conversa avança sem formulário → corretor não insiste no link (Guia já prevê os dois caminhos, `lib/attendance-guide-seed-library.mjs` L112).

## Questionamentos à V6
1. Mistura de vozes ("me diz", "não vou", "posso te ajudar") fere a decisão 4 → tudo no plural.
2. Sem roteador, o "nome sujo" fora do horário fica sem acolhimento → frase fixa "não pede CPF e não consulta seu nome" (fato: `lib/simulation-registration-format.js` L79-180).
3. B9 no anúncio fica sem gatilho sem condição por assunto → no anúncio, a pessoa faz (M5); texto B9 só no Fluxo E.
4. A1 longa (~75 palavras) e convida áudio fora do horário → enxuta; "escrita ou em áudio" só no horário.
5. Resposta fora do horário precisa cobrir áudio/imagem (áudio nem chega ao Fluxo; 6/8 com mídia começaram por áudio).

## Roteiro humano no Chat (corretor/associado)
Responder primeiro o que perguntou → dois caminhos (Guia L112) → próximo passo com data (Guia `lib-retorno`, L41-45). Nunca prometer aprovação, valor ou prazo de banco.
- M1: "Oi, [Nome]! Aqui é o(a) [seu nome], da equipe do Matheus Machado Imóveis. [Ouvi seu áudio / Vi sua mensagem] 😊 [responder a dúvida em 1–2 frases, sem número inventado]."
- M2: "Pra te mostrar quanto você pode financiar e a parcela, preciso de algumas informações rápidas. Prefere me responder aqui mesmo (pode ser por áudio) ou pelo link da simulação?"
- M3 (coleta no chat): "Então me conta: 1) Você trabalha registrado, declara imposto de renda ou é autônomo? Quanto ganha por mês, mais ou menos? 2) Vai comprar sozinho(a) ou com mais alguém? 3) Tem algum valor guardado ou FGTS? Se não tiver nada, tudo bem, pode falar. 4) Já tem algum imóvel no seu nome?" (campos do formulário; cadastro manual no CRM)
- M4 (objeção): usar o Guia — restrição `obj-restricao` (L166), autônomo `sol-renda-informal` (L134), sem entrada `obj-sem-entrada` (L50).
- M5: "Com isso eu monto sua simulação e te mando aqui [dia/período combinado]. Pode ser?" Outra cidade: "Você quer comprar aqui em Marília?" → não: "Por enquanto a gente só trabalha com imóveis em Marília. Se um dia pensar em Marília, é só chamar aqui."
- Sugestão (não aplicada): entrada no Guia "Lead de anúncio: primeira resposta (texto ou áudio)".

## VERSÃO 7
Voz única "a equipe", plural; nunca "eu", "assistente virtual", "robô". ≤ 1 emoji. Não contactar não recebe nada. Botão = "Fazer simulação" → `/s`. Fora = fora de seg–sáb 8h–19h.

**A. Anúncio (Oficial) — 1 envio, sessão termina**
- A1 horário: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Pra montar sua simulação (quanto você pode financiar e a parcela), é só responder umas perguntas rápidas no link abaixo. Não pede CPF nem documento, e é sem compromisso. Se preferir, manda sua dúvida aqui mesmo, escrita ou em áudio, que um especialista da nossa equipe te responde." + Botão
- A1 fora: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Pra montar sua simulação (quanto você pode financiar e a parcela), é só responder umas perguntas rápidas no link abaixo. Não pede CPF nem documento, e é sem compromisso. Nosso atendimento é de segunda a sábado, das 8h às 19h. Se esse horário não der pra você, é só avisar que a gente combina outro." + Botão

**B. Cliente escreve ou manda áudio depois do link**
- Horário: sem automático; pessoa responde (M1–M5).
- Fora (uma vez por conversa; texto **ou áudio/imagem**): "Recebemos sua mensagem, {{primeiro_nome}}! Nosso atendimento é de segunda a sábado, das 8h às 19h, e a equipe te responde assim que começar. Se esse horário não der pra você, conta pra gente qual fica melhor que a gente combina. Se quiser adiantar, a simulação não pede CPF e não consulta seu nome:" + Botão
- B9 (só no Fluxo E): "Obrigado por avisar, {{primeiro_nome}}! Nós trabalhamos com imóveis em Marília/SP. Você quer comprar aqui em Marília?" [Sim, em Marília] [Outra cidade] → Sim: "Ótimo! Então dá pra seguir normalmente:" + Botão / Outra: "Entendi! Por enquanto a gente só trabalha com imóveis em Marília, então não vamos conseguir te ajudar dessa vez. Se um dia pensar em Marília, é só chamar aqui." → tag "Outra cidade" + finish
- B12 (pare, no webhook): "Tudo bem, {{primeiro_nome}}, não vamos mais te mandar mensagem. Se um dia quiser, é só chamar aqui." → Não contactar
- B1–B8 e B10: Fase 3.

**C. Lembretes 1 h / 3 h / 10 h** (21h–8h → 8 h)
- 1 h: "{{primeiro_nome}}, conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio."
- 3 h: "Só lembrando: com a simulação você já fica sabendo quanto pode financiar e a parcela pro seu caso. Não pede CPF e é sem compromisso. É só tocar em Fazer simulação, na mensagem acima." (Botão na Fase 3)
- 10 h: "{{primeiro_nome}}, essa é nossa última mensagem sobre a simulação 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer do mesmo jeito. Se preferir conversar, é só responder aqui que a nossa equipe te chama."

**D. Pós-formulário** — horário: "Recebemos seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Agora um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui, neste mesmo número." / fora: "Recebemos seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Nosso atendimento é de segunda a sábado, das 8h às 19h. Assim que começar, um especialista prepara sua simulação e te chama por aqui. Se esse horário não der pra você, conta pra gente qual fica melhor."

**E. Sem anúncio:** "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis. Como podemos te ajudar?" [Fazer simulação] [Já sou cliente] [Tenho uma dúvida] → Simulação: A1 sem promessa do anúncio; Já sou cliente: "Que bom falar com você de novo! Avisamos quem cuida do seu atendimento, que te responde por aqui." (fora: frase de horário de B) → `base_roulette`; Dúvida → pessoa.
**F.** Corretor sem robô; TESTE fica. **G.** Roteiro M1–M5.

## Especificação
- Fase 1: A1 horário/fora, D, E (com B9), plural.
- Fase 2: itens 1, 2, 3, 6 (textos C novos) + resposta única fora do horário à 1ª mensagem livre **incluindo áudio/imagem**.
- Fase 3: B1–B8 (se 1ª resposta humana > 15 min), botão nos lembretes, ID do anúncio em conversa existente.
- Métricas da V6 + leitura qualitativa: % de conversas com "é robô?"/reclamação.

## Decisões do dono
1. Quem dá o toque humano no grupo do silêncio (fica com o dono pela WA-18): o dono, um associado ou ninguém?
2. Aprovar entrada nova no Guia "Lead de anúncio: primeira resposta (texto ou áudio)"?

## Para WhatsApp e automação
Resposta fora do horário para áudio/imagem sem sessão; "uma vez por conversa" (por conversa ou por janela de 24 h?) sem reiniciar lembretes; {{primeiro_nome}} vazio nos lembretes e texto do 10 h movido para 8 h; ordem B12 antes da resposta fora do horário; B9 no E na Fase 1 e se a tag "Outra cidade" tira da roleta.
