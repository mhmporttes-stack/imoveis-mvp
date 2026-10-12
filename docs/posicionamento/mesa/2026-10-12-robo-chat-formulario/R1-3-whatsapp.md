# Rodada 1 — Cadeira WhatsApp e automação (Versão 3)

## O que o sistema faz hoje (código)
- Limites (`lib/whatsapp-flow-core.mjs` L7-22): texto 1024, rodapé 60, botão de resposta 20 (máx. 3), botão de link 20, 8 envios/execução, espera ≤ 23 h. Nós: mensagem, pergunta, ação, condição, espera. **Não há roteamento pelo conteúdo do texto** (condição só horário/cliente/corretor/anúncio/nome, L114-115).
- Link + botões na mesma mensagem: **NÃO DÁ** (`cta_url` com 1 botão, L405-414; botões são outra mensagem, L374-383). A1 e A2 = 2 mensagens. (Confirmar na doc da Meta.)
- {{saudacao}}/{{primeiro_nome}}: **JÁ DÁ** (`lib/whatsapp-flows.js` L377-387; nome vazio se ajusta, core L329-335).
- Horário: **JÁ DÁ** — `business_hours` configurável por bloco (core L425-444; padrão 09–18 seg–sex, L69). Texto das mensagens é fixo e tem de bater.
- Áudio: **PRECISA DE CÓDIGO** — com sessão aberta vira texto vazio; em pergunta é **ignorado em silêncio** (L543-545); em botão vai para "Outra resposta" (L560-565). Não há condição "é mídia".
- Respostas por tema: **PRECISA DE CÓDIGO** — condição nova "texto contém palavra" reaproveitando `lib/whatsapp-keyword-match.mjs` + marca `ja_respondeu_<tema>` na sessão. Respostas por palavra-chave (§9) só rodam sem sessão viva, só texto, sem memória. Gatilho `keyword` de Fluxo não tem fronteira de palavra (P-16).
- Toque em botão conta como resposta no WA-18 (`lib/whatsapp-ad-waiting-core.mjs` L16-24 → solta para roleta) e **encerra os lembretes** do link (`whatsapp-form-reminder-core.mjs` L208-212).
- Lembretes: não sabem de "pergunta pendente"; toda nova automação com link **reinicia** a sequência (L158-166); **sessão de Fluxo viva segura o lembrete** (`fluxo_em_andamento`, L255) até vencer (L200). Textos fixos no código (L100-112); o de 10 h promete "um associado te atende agora".
- **"Não contactar": Fluxos (`processFlowInbound`, `whatsapp-flows.js` L686) e respostas por palavra-chave NÃO verificam `do_not_contact`.** Lembretes verificam (L230-235).
- 8 envios OK, mas "digitando" + 3 s por mensagem (L420-422) e webhook 30 s → máx. 3 mensagens por resposta.
- Pausar "TESTE anúncio": JÁ DÁ (com "sim" do dono).

## Questionamentos
1. V2 "sessão espera até preencher" trava os lembretes → A2 com "se não responder" 50 min → `stop` (não `finish`, que mata lembretes, L226).
2. "Lembrete das 20h"/"máx. 3 à noite": a sequência 1h/3h/10h/23h é **WA-18 oficial**, contada do link → manter 1h/3h/10h com textos novos; cortar 23h = decisão do dono.
3. "Já avisei nossa equipe" pode ser falso (fila sem corretor) → "deixei seu recado com a nossa equipe".
4. "umas 10 perguntas" (são 11) → "umas perguntas simples".

## VERSÃO 3
Botões: Fazer simulação (15), Tenho uma dúvida (16), Falar com alguém (16), Já sou cliente (14). Todo envio passa pela trava de "Não contactar" (código novo).

**A. Anúncio (Oficial)** — 2 envios (~6–8 s)
- A1 [link "Fazer simulação" → /s público]: texto da V2 (JÁ DÁ).
- A2 [botões; "se não responder" 50 min → stop]: "Se tiver alguma dúvida, pode me mandar por aqui, escrita ou em áudio." [Tenho uma dúvida] [Falar com alguém]
  - Tenho uma dúvida → pergunta "Pode mandar, {{primeiro_nome}}! Escreve do seu jeito que eu te ajudo." (50 min → stop) → roteador B (CÓDIGO)
  - Falar com alguém → B11 (JÁ DÁ)
  - Outra resposta (texto/áudio) → roteador B (CÓDIGO)

**B. Por tema** (uma vez por tema; ≤ 2 mensagens; repetiu tema → B11). Textos da V2, exceto:
- B1: "É uma simulação sem compromisso, {{primeiro_nome}}. São umas perguntas simples (renda, filhos, estado civil, se tem algum valor guardado). Com elas, um especialista da nossa equipe calcula quanto você pode financiar e qual parcela cabe no seu bolso. Não é aprovação, é pra você saber onde está pisando." + link
- B2–B9 como V2 (link via botão "Fazer simulação"; B7 e B9 sem link).
- B10 (CÓDIGO "é mídia") — horário: "Recebi seu áudio! Como sou assistente virtual, não consigo ouvir, então deixei seu recado com a nossa equipe, que te responde por aqui." / fora: texto da V2 → "Se quiser adiantar, a simulação está aqui:" + link
- B11 — horário: "Claro, {{primeiro_nome}}! Deixei seu recado com a nossa equipe, e um especialista te responde por aqui." / fora: texto da V2 → "Enquanto isso, se quiser adiantar:" + link → ação roleta; sessão termina.
- B12: texto da V2; encerra sessão e bloqueia lembretes da conversa (CÓDIGO); "Não contactar" automático = decisão do dono.

**C. Lembretes WA-18** (CÓDIGO: textos novos e sequência por conversa, não por link)
- 1 h: "{{primeiro_nome}}, ficou alguma dúvida sobre a simulação? Pode me perguntar por aqui, escrita ou em áudio."
- 3 h: "Só lembrando: a simulação é sem compromisso, não pede CPF e leva poucos minutos. O link está logo acima, é só tocar em Fazer simulação."
- 10 h: "{{primeiro_nome}}, esse é meu último lembrete 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer a simulação do mesmo jeito. Se preferir, me responde aqui que nossa equipe te chama."
- 23 h: corte proposto (decisão do dono). Botão de link no lembrete = código.

**D.** Pós-formulário: texto da V2 no modelo "Formulário concluído" com condição de horário (JÁ DÁ).
**E.** Sem anúncio: V2, gatilho 1ª mensagem; Já sou cliente → "tem corretor" → roleta (mantém responsável) + B11 (JÁ DÁ).
**F.** Número do corretor sem robô. Pausar "TESTE anúncio".

## Decisões do dono
1. Horário real (seg–sáb 8h–19h?). 2. Cortar lembrete de 23 h (muda WA-18)? 3. "Pare" → "Não contactar" automático? 4. Outra cidade. 5. "Assistente virtual"?

## Para Tráfego
Texto pré-preenchido do anúncio reconhecido por `isAdPrefillText`; promessa do anúncio = A1 ("sem CPF, sem compromisso, quanto pode financiar"); ID de anúncio sincronizado por campanha; pausar TESTE.

## Confirmação na documentação oficial da Meta (consultada em 2026-10-12, Graph API v25.0)
- Botão de resposta: máx. 20 caracteres, títulos distintos, máx. 3; corpo 1024, rodapé 60 — https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages
- `cta_url` `display_text`: máx. 20 — https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-cta-url-messages
- `cta_url` + botões de resposta na mesma mensagem: estrutura só tem 1 `action` com 1 botão → mensagens separadas (proibição não escrita).
- Janela de 24 h: abre/renova a cada mensagem ou ligação do cliente; fora dela só template aprovado com opt-in — https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages. Toque em botão provavelmente conta (gera webhook `messages`), não confirmado.
- "Digitando": permitido, vai com `status: read`, some em 25 s; não estende a janela — https://developers.facebook.com/documentation/business-messaging/whatsapp/typing-indicators
