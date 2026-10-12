# Rodada 1 — Cadeira Tráfego pago (Versão 4, revisada com as decisões 1–7 do dono)

## Dados (Supabase, leitura; insights no fuso de Los Angeles)
| Anúncio (ID) | Período | Gasto | Conversas Meta | No CRM | Formulário ≤ 24 h | R$/conversa | R$/formulário |
|---|---|---|---|---|---|---|---|
| **Ativo** "Eco Village, Vídeo, WhatsApp oficial" (52550704071153; campanha 52550704029553) | 08–12/10 | 93,85 | 20 | 12 (todas c/ link) | 5 (42 %) | 4,69 | **18,77** |
| Pausado "WHATSAPP, TRAFEG SITE LEAD [TESTE1]" (52547581247353) | 24/09–03/10 | 101,12 | 49 | 41 (28 apagadas) | 5 (6 no total) | 2,06 | ~16,85 |
| Pausado "Eco Village, Carrossel" (52550246657553 + 52550699926553) | 06–10/10 | 59,51 | 7 | **0 com ID** | — | 8,50 | — |

- Promessa do anúncio ativo: "Pagando aluguel em Marília? Chame no WhatsApp e receba um relatório completo com simulação, valores, taxa de juros, benefícios e o imóvel sugerido… fale com um dos meus associados." Título "Simule sua casa própria no WhatsApp".
- 1ª mensagem do cliente: 11/12 "Olá! Posso ter mais informações sobre isso?" (genérico Meta); pausado usava "Olá! Vi o anúncio e quero fazer a simulação do meu financiamento." Ambos reconhecidos por `isAdPrefillText` (`lib/whatsapp-referral.mjs` L74-91).
- Robô hoje: "Em instantes, um dos meus associados dará início ao seu atendimento" → formulário → botão "Formulário de atendimento" (42 %, ≈ base 41 %).
- Público 52550704042353: Marília 17 km, 18–55, inclui "frequentemente em/esteve recentemente".
- Furos de medição: 8/20 conversas do ativo sem ID no CRM; carrossel sem nenhuma; `utm_content` quase nunca chega ao cadastro.

## Questionamentos
1. A1 da V3 ("assistente virtual", "responda perguntas") quebra a promessa (gente + relatório). V4 promete especialista, sem prazo (P75 > 8 h), e formulário como caminho do relatório.
2. A2 com [Falar com alguém] 6–8 s após o link = saída antes do formulário; toque conta como resposta (WA-18) e manda à roleta sem renda → A2 só após 3 min sem formulário e sem mensagem.
3. B9 → humano contrariava a decisão 2 → pergunta se quer comprar em Marília.
4. Lembrete de 10 h cai de madrugada (clique 14 h → 0 h; WA-17 roda 24 h) → decisão do dono (adiar para 8 h?).

## VERSÃO 4
"Botão" = botão de link "Fazer simulação" → `/s`. Todo envio checa "Não contactar" (código). Fora do horário = fora de seg–sáb 8h–19h.

**A. Anúncio (Oficial)**
- A1 horário: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Um especialista da nossa equipe vai te atender por aqui. Pra ele já chegar com a sua simulação (quanto você pode financiar, a parcela, os benefícios e um imóvel sugerido), responde umas perguntas rápidas no link abaixo. Não pede CPF nem documento, e é sem compromisso." + Botão
- A1 fora: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Nosso atendimento é de segunda a sábado, das 8h às 19h. Se esse horário não der pra você, é só avisar que a gente combina outro. Pra o especialista já chegar com a sua simulação pronta, responde umas perguntas rápidas no link abaixo. Não pede CPF nem documento, e é sem compromisso." + Botão
- Espera 3 min: escreveu → B; preencheu → D (condição "preencheu" A CONFIRMAR/CÓDIGO).
- A2: "Se tiver alguma dúvida, pode me mandar por aqui, escrita ou em áudio." [Tenho uma dúvida] [Falar com alguém]; 50 min sem resposta → stop. Dúvida → "Pode mandar, {{primeiro_nome}}! Escreve do seu jeito que eu te ajudo." → B (CÓDIGO); Falar → B11; outra → B.

**B. Por tema** (uma vez; repetido → B11; CÓDIGO)
- B1: "É uma simulação sem compromisso, {{primeiro_nome}}. São umas perguntas simples (renda, filhos, estado civil, se tem algum valor guardado). Com elas, um especialista da nossa equipe monta a sua simulação: quanto você pode financiar e qual parcela cabe no seu bolso. Não é aprovação, é pra você saber onde está pisando." + Botão
- B2: "Isso muda de pessoa pra pessoa, porque depende da renda e da família. Prefiro não te passar um número chutado: com a simulação a gente te mostra uma estimativa feita pro seu caso." + Botão
- B3: "Obrigado por me contar, {{primeiro_nome}}. Isso é mais comum do que parece, e não te impede de fazer a simulação: o formulário não pede CPF e não consulta seu nome. Depois um especialista conversa com você, sem julgamento, sobre os caminhos possíveis pro seu caso." + Botão
- B4: "Pode fazer sim! No formulário tem a opção "Autônomo", pra quem trabalha sem carteira assinada. Depois o especialista te explica como funciona a comprovação de renda no seu caso." + Botão
- B5: "Pode preencher mesmo sem nada guardado: na pergunta do valor dá pra colocar R$ 0,00. A simulação mostra como a entrada poderia ficar no seu caso." + Botão
- B6: "Pra simulação você não precisa de documento nenhum, só responder as perguntas. A lista de documentos o especialista te passa depois, se você quiser seguir." + Botão
- B7: "Sem pressa! O link fica salvo aqui na conversa. Quando tiver uns minutinhos, é só tocar nele." (lembretes continuam)
- B8: "Que bom! Às vezes o cadastro fica registrado com outro número de celular. Vou pedir pra alguém da equipe conferir pra você. Se preferir adiantar, pode fazer de novo por este link, leva poucos minutos." + Botão → humano
- B9: "Obrigado por avisar, {{primeiro_nome}}! Nós trabalhamos com imóveis em Marília/SP. Você quer comprar aqui em Marília?" [Sim, em Marília] [Outra cidade] → Sim: "Ótimo! Então dá pra seguir normalmente:" + Botão / Outra: "Entendi! Por enquanto a gente só trabalha com imóveis em Marília, então não vou conseguir te ajudar dessa vez. Se um dia pensar em Marília, é só chamar aqui." → encerra sessão e lembretes (CÓDIGO)
- B10 horário: "Recebi seu áudio, {{primeiro_nome}}! Já deixei com a nossa equipe, que vai ouvir e te responder por aqui." → humano / fora: "Recebi seu áudio, {{primeiro_nome}}! Nosso atendimento é de segunda a sábado, das 8h às 19h, e a equipe te responde assim que começar. Se esse horário não der pra você, é só avisar que a gente combina outro. Se quiser adiantar, a simulação está aqui:" + Botão
- B11 horário: "Claro, {{primeiro_nome}}! Deixei seu recado com a nossa equipe, e um especialista te responde por aqui." / fora: "Claro, {{primeiro_nome}}! Nosso atendimento é de segunda a sábado, das 8h às 19h. Se esse horário não der pra você, me diz qual horário fica melhor que a gente combina. Enquanto isso, se quiser adiantar:" + Botão → roleta; sessão termina.
- B12: "Tudo bem, {{primeiro_nome}}, não vou mais te mandar mensagem. Se um dia quiser, é só chamar aqui." → marca Não contactar (`clientDoNotContactPatch`), encerra sessão e lembretes (CÓDIGO)

**C. Lembretes WA-18** (1 h / 3 h / 10 h; 23 h cortado; CÓDIGO)
- 1 h: "{{primeiro_nome}}, ficou alguma dúvida sobre a simulação? Pode me perguntar por aqui, escrita ou em áudio."
- 3 h: "Só lembrando: a simulação é sem compromisso, não pede CPF e leva poucos minutos. Com ela o especialista já chega com os valores do seu caso." + Botão
- 10 h: "{{primeiro_nome}}, esse é meu último lembrete 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer a simulação do mesmo jeito. Se preferir, me responde aqui que nossa equipe te chama." + Botão

**D. Pós-formulário** — horário: "Recebi seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Agora um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui, neste mesmo número." / fora: "Recebi seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Nosso atendimento é de segunda a sábado, das 8h às 19h. Assim que começar, um especialista prepara sua simulação e te chama por aqui. Se esse horário não der pra você, me diz qual fica melhor."

**E. Sem anúncio:** "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis. Como posso te ajudar?" [Fazer simulação] [Já sou cliente] [Tenho uma dúvida]; resto como V3.
**F.** Corretor sem robô; TESTE fica.

**G. Tráfego (cada item só com "sim" do dono, executado por ele no Gerenciador)**
1. Texto pré-preenchido do 52550704071153 → "Olá! Vi o anúncio e quero fazer a simulação do meu financiamento." (já reconhecido; sem código). Risco: revisão/aprendizado → duplicar o anúncio PAUSADO.
2. Próximo criativo: "fale com um especialista da equipe do Matheus Machado"; manter "sem compromisso, não pede CPF"; só prometer "relatório completo/imóvel sugerido" se for entregue a todo lead.
3. Público: não mexer; medir B9 por 3–4 semanas.
4. Medição semanal por anúncio: conversas Meta → CRM c/ ID → formulário ≤ 24 h → funil. Base: R$ 18,77/formulário, 42 %.

## Para Viabilidade (crm-editor)
Esforço/risco de: roteador por tema; mídia; condição "já preencheu" após 3 min; trava Não contactar; B12 gravando Não contactar; B9 encerrando lembretes; botão de link nos lembretes; textos novos e corte de 23 h. Furos: 8/20 sem ID, carrossel sem conversa, `utm_content`. Decisão do dono: lembrete de 10 h de madrugada → adiar p/ 8 h?
