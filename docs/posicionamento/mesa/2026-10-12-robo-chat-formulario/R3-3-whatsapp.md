# Rodada 3 — Cadeira WhatsApp e automação (Versão 13 = V12 + mudanças abaixo)

## Objeções à V8
Aceita: transferência em `reconcileAdWaitingClients` (WA-18 só por `releaseAdWaitingClient`) — logo transferência (`scheduled-activities`) e lembrete (`whatsapp-flows`) **sem ordem garantida**; sem aviso à gestão; A1 única; texto fixo das 8 h.

## Código conferido
- **8 h:** não existe; `currentReminderStep` (`lib/whatsapp-form-reminder-core.mjs:72-98`), textos fixos L100-105 (inclui 23 h e 1ª pessoa). Spec: etapa vencendo 21h–8h → 8 h com `morning: true`; chave = etapa mais recente vencida (nenhuma anterior sai depois); atraso das 8 h; `buildFormReminderText(nome, etapa, {morning})` com texto fixo (vale p/ WA-17). Testes: lead 20h → uma às 8 h, texto fixo, chave `:10h`, nunca o texto de 10 h; lead 6h30 → 8 h (fixo) e 3 h às 10 h (2 h mín.); sáb 22h → dom 8 h; `:23h` nunca gerada; lead 11h01 dentro de 24 h.
- **Número da resposta:** `pickSendChannel` não é chamado no envio do Chat (`lib/whatsapp-chat.js` só import L34 e comentário L2862); `openChatForClient` abre a conversa mais recente entre Oficial e pessoal (L2764-2779) — para anúncio é a do Oficial → "por aqui" vale. Saídas por outro número: botão "WhatsApp" do card (`wa.me`, `docs/WHATSAPP.md:166`) e `409 WINDOW_CLOSED`. → manter "por aqui" + Guia orienta "responda pelo Chat, conversa do número oficial".
- **`base_roulette`:** avisa só se há corretor ativo (`lib/whatsapp-flows.js:417-435`); sem ninguém (L579-580) ou responsável inativo (L421) ninguém é avisado → E muda.
- **Webhook** (`lib/whatsapp-master.js`): Chat (L601-606) → **B12** → lead patrocinado/contato direto (L611-626) → mídia (L629-634) → Fluxo/palavra-chave (L636-660) → **fora do horário após L660** com filtro próprio (texto, áudio, imagem, vídeo, documento; não reação, figurinha, toque em botão de Fluxo); só Oficial.
- **Uma vez por período:** sequencial no mesmo webhook; em paralelo, reserva `after-hours:<conversa>:<início>` gravada **antes** de enviar (índice único `meta_message_id`, como `lib/whatsapp-form-reminder.js:195-213`); 23505 não envia. D/E fora do horário já contam como automação no período.
- **Limites:** texto ≤ 1024, botão/link ≤ 20 (`lib/whatsapp-flow-core.mjs:7-16`; `cut` corta sem avisar). Tudo cabe.
- **Notação:** nos Fluxos `{{, Nome}}` não existe (`interpolate` L321) → `{{saudacao}}, {{primeiro_nome}}!` (sem nome vira "Boa tarde!", L331-334). Armadilha: nome entre vírgulas no meio da frase vira "Oi,, tudo bem?". Nos textos de código o nome sai por `usableFirstName`. `{{saudacao}}` = `getTimeGreeting` (`lib/daily-report.js:326-333`): Bom dia 6–12h, Boa tarde 12–18h, Boa noite resto.

## Guia conferido (`lib/attendance-guide-core.mjs`)
OK: tipos card/ref/followup/end; fases (PHASES L33-43); limites (L9-17); marcadores (L319-328); os 5 `obj-*` existem com `entry: true` (`lib/attendance-guide-seed-library.mjs` L166, L120, L50, L388, L358); sem alerta de compliance; recepção = `l-recepcao` (`lib/attendance-guide-seed-flows.mjs:116`, 10 respostas → 12).
Erros a corrigir na gravação:
1. Notação do seed ≠ formato do banco (`buildGraph`, `lib/attendance-guide-seed.mjs:21-47`, só roda com tabela vazia). Banco: card `options:[{id:"la-m1~1",label}]` + aresta `{id, from, port:"la-m1~1", to}`; ref `data:{guideId:<id do Banco de objeções no banco; seed 5b7f1d2e-0c11-4a55-9a3c-1f0e6d3a7b01>, nodeId:"obj-…", label}` + aresta `port:"next"`. Ids e card de início lidos do `published_graph`.
2. `sanitizeGuideGraph` descarta card com id repetido sem avisar (L105-106) → conferir que nenhum `la-*` existe; respostas novas `l-recepcao~la1`, `l-recepcao~la2`.
3. Passar `libraryNodes` (Banco de objeções publicado) ao `validateGuideGraph` (L260-261).
4. Posição x/y só nos cards novos (não rodar `autoArrangeGuide` no grafo inteiro).
5. Refs de objeção voltavam a `la-m5` sem as informações → voltam a `la-m2`.

## Questionamentos à V12
1. "Agora há pouco te mandamos um lembrete" pode ser falso (ordem não garantida; lead 6h30 transferido 9h30 e lembrete só 10h; lembrete pode ser pulado) → texto sem referência de tempo.
2. E "Já avisamos" falso com fila vazia/responsável inativo → "Já passamos sua mensagem".
3. Refs → `la-m5` sem informações → `la-m2` + resposta "Já passou as informações" → `la-m5`.
4. "Por aqui" sem orientação → linha no Guia.

## VERSÃO 13 (mudanças sobre a V12)
- Fluxos (A1, D, E): `{{saudacao}}, {{primeiro_nome}}!` e "Recebemos seu cadastro, {{primeiro_nome}}!".
- E "Já sou cliente": "Que bom falar com você de novo! Já passamos sua mensagem pra nossa equipe, e quem cuida do seu atendimento te responde por aqui." (+ FH se fora); ação `base_roulette` **antes** da mensagem.
- C 8 h: texto da V12; spec e testes acima.
- Fora do horário: filtro próprio após L660, só Oficial, reserva antes; B12 entre L606 e L611.
- G `la-silencio` message: "Oi, [Nome]! Aqui é [o_a] [Corretor], da equipe do Matheus Machado Imóveis. Você chamou a gente pelo anúncio da simulação, e sou eu que vou cuidar do seu atendimento. Ficou alguma dúvida? Pode me responder por aqui, escrita ou em áudio, do jeito que for melhor pra você."
- G `la-silencio` guidance: "Use quando o CRM avisar que o cliente 'não respondeu às mensagens automáticas', ou quando receber um cliente de anúncio que só tem mensagens automáticas no Chat. Ele já recebeu o link e pode ter recebido lembretes automáticos (de manhã, um 'Bom dia'). Antes de mandar, confira no Chat se ninguém da equipe já escreveu. Responda pelo Chat do CRM, na conversa do número oficial. Não reenvie o link e não cobre resposta: apresente-se e faça uma pergunta fácil. Se usar 'O cliente não responde', troque 'o imóvel' por 'a simulação'."
- G `la-m1` guidance + : "Responda pelo Chat do CRM, na conversa do número oficial: a mensagem automática disse que a resposta vem por aqui. Se o Chat não deixar enviar (janela de 24 h fechada), use seu WhatsApp e diga logo na primeira frase que é da equipe do Matheus Machado Imóveis, sobre a simulação do anúncio."
- G `la-m2`: nova resposta ["Já passou as informações", la-m5]; refs `la-r-restricao`, `la-r-renda`, `la-r-sem-entrada`, `la-r-outra` com next = **la-m2**.
- G gravação: converter ao formato do banco (erros 1–4); `sanitizeGuideGraph` + `validateGuideGraph(…, {libraryNodes})` com 0 erros; guardar JSON anterior.

## Caracteres (emoji = 2; nome de 20 letras e "Boa tarde"; entre parênteses sem nome; ±3 — travar ≤ 1024 em teste)
| Mensagem | Caracteres |
|---|---|
| A1 horário | 440 (418) |
| A1 fora | 558 (536) |
| B fora, não preencheu | 302 (280) |
| B fora, já preencheu | 232 (210) |
| B12 | 113 (91) |
| C 1 h | 121 (99) |
| C 3 h | 201 |
| C 10 h | 237 (215) |
| C 8 h | 225 (203) |
| Lembrete único | 163 (141) |
| D horário | 157 (135) |
| D fora | 338 (316) |
| E menu | 101 (79) |
| E Simulação | 255; fora 442 |
| E Já sou cliente | 128; fora 315 |
| E Dúvida | 85; fora 272 |
| FH | 186 |
Botões: Fazer simulação 15, Já sou cliente 14, Tenho uma dúvida 16.

## Para Tráfego
Promessa = A1 ("quanto pode financiar e a parcela, sem CPF, sem compromisso"); lead da noite recebe A1 fora + no máximo "Bom dia" às 8 h (hora da transferência); destino sempre Oficial; TESTE sem disputa de gatilho; medir por ID; Dados: % das 1ªs mensagens humanas a lead de anúncio pelo Oficial × pessoal.
