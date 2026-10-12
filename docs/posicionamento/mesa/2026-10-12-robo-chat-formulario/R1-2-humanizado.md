# Rodada 1 — Cadeira Atendimento humanizado (Versão 2)

Fontes: Guia de Atendimento (`lib/attendance-guide-seed-library.mjs` L121-136, L166-170); formulário `/s` (`lib/simulation-registration-format.js` L27-31, L79-180: 11 perguntas, **sem CPF/documento**, opção **Autônomo**, valor disponível aceita **R$ 0,00**); regra de tratamento sem CRECI (`.claude/rules/integracoes-externas.md`); modelos atuais (`components/flows/flow-templates.js` L123-124 prometem "PDF em alguns minutos" e usam "associados").

## Questionamentos à Versão 1
1. "Corretor" nas mensagens fere a regra de tratamento (quem não tem CRECI) e o robô não sabe quem atenderá → "especialista da nossa equipe".
2. "Já chamei um corretor" promete o que não se cumpre (P75 > 8 h; 8/25 fora do horário) → versões dentro/fora do horário; no áudio, robô diz que não ouve.
3. Lembrete das 20h sobre "renda ou nome" insinua nome sujo a quem não falou → fatos do formulário.
4. Botões longos (> 20 caracteres?) e "Já vou preencher" inútil e pode contar como resposta (WA-18) → removido.
5. "Já fiz" → "Não encontrei aqui" culpa o cliente → humano confere, refazer é opção.
6. Concorda: sem robô no número do corretor; nunca prometer aprovação.

## VERSÃO 2
Tom: primeiro nome, frases curtas, ≤ 1 emoji, nunca "aprovação garantida"/"sem entrada"/número inventado; cada tema respondido uma vez; `do_not_contact` nunca recebe nada.

**A. Anúncio (Oficial), chegada**
- A1: "{{saudacao}}, {{primeiro_nome}}! Que bom que você chamou 😊 Sou o assistente virtual da equipe do Matheus Machado Imóveis. Pra ver quanto você pode financiar, é só responder umas perguntas rápidas: renda, família e se tem algum valor guardado. Não pede CPF nem documento, e é sem compromisso." + botão link [Fazer simulação]
- A2: "Se tiver alguma dúvida, pode me mandar por aqui, escrita ou em áudio." + [Tenho uma dúvida] [Falar com alguém]
  - [Tenho uma dúvida] → "Pode mandar, {{primeiro_nome}}! Escreve do seu jeito que eu te ajudo." → B
  - [Falar com alguém] → B11
- Sem handoff imediato; sessão espera até preencher.

**B. Respostas por tema (sempre com link ou passagem a humano)**
- B1 como funciona: "É uma simulação sem compromisso, {{primeiro_nome}}. São umas 10 perguntas simples (renda, filhos, estado civil, se tem algum valor guardado). Com elas, um especialista da nossa equipe calcula quanto você pode financiar e qual parcela cabe no seu bolso. Não é aprovação, é pra você saber onde está pisando." + link
- B2 parcela/valor: "Isso muda de pessoa pra pessoa, porque depende da renda e da família. Prefiro não te passar um número chutado: com a simulação a gente te mostra uma estimativa feita pro seu caso." + link
- B3 nome sujo: "Obrigado por me contar, {{primeiro_nome}}. Isso é mais comum do que parece, e não te impede de fazer a simulação: o formulário não pede CPF e não consulta seu nome. Depois um especialista conversa com você, sem julgamento, sobre os caminhos possíveis pro seu caso." + link
- B4 autônomo: "Pode fazer sim! No formulário tem a opção "Autônomo", pra quem trabalha sem carteira assinada. Depois o especialista te explica como funciona a comprovação de renda no seu caso." + link
- B5 sem dinheiro/entrada: "Pode preencher mesmo sem nada guardado: na pergunta do valor dá pra colocar R$ 0,00. A simulação mostra como a entrada poderia ficar no seu caso." + link
- B6 documentos: "Pra simulação você não precisa de documento nenhum, só responder as perguntas. A lista de documentos o especialista te passa depois, se você quiser seguir." + link
- B7 sem tempo: "Sem pressa! O link fica salvo aqui na conversa. Quando tiver uns minutinhos, é só tocar nele." (lembretes continuam)
- B8 "já fiz": "Que bom! Às vezes o cadastro fica registrado com outro número de celular. Vou pedir pra alguém da equipe conferir pra você." → humano + "Se preferir adiantar, pode fazer de novo por este link, leva poucos minutos." + link
- B9 outra cidade (provisório, DECISÃO DO DONO): "Obrigado por avisar! Vou passar sua mensagem pra nossa equipe, que te responde se consegue te ajudar na sua cidade." → humano
- B10 áudio/imagem — horário (8h–19h): "Recebi seu áudio! Como sou assistente virtual, não consigo ouvir, então já passei pra nossa equipe, que te responde por aqui em breve." / fora: "Recebi seu áudio! Como sou assistente virtual, não consigo ouvir. Nossa equipe atende de segunda a sábado, das 8h às 19h, e te responde assim que o atendimento começar." + "Se quiser adiantar, a simulação está aqui:" + link
- B11 falar com alguém/não reconhecido — horário: "Claro, {{primeiro_nome}}! Já avisei nossa equipe, e um especialista te responde por aqui em breve." / fora: "Claro, {{primeiro_nome}}! Nossa equipe atende de segunda a sábado, das 8h às 19h. Deixei seu recado e um especialista te responde assim que começar." + "Enquanto isso, se quiser adiantar:" + link
- B12 parar: "Tudo bem, {{primeiro_nome}}, não vou mais te mandar mensagem. Se um dia quiser, é só chamar aqui." → para lembretes + avisa humano (DECISÃO DO DONO: marcar "Não contactar" sozinho?)

**C. Lembretes (sem pergunta pendente; máx. 3)**
- C1 1 h: "{{primeiro_nome}}, ficou alguma dúvida sobre a simulação? Pode me perguntar por aqui. O link é este:" + link
- C2 3 h: "Só lembrando: a simulação é sem compromisso, não pede CPF e leva poucos minutos. Quando puder:" + link
- C3 noite: "Boa noite, {{primeiro_nome}}! Esse é meu último lembrete 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer a simulação do mesmo jeito. O link fica aqui:" + link. Depois, nada.

**D. Pós-formulário (substitui flow-templates L123-124)** — horário: "Recebi seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Agora um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui, neste mesmo número." / fora: "Recebi seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Nossa equipe atende de segunda a sábado, das 8h às 19h. Assim que o atendimento começar, um especialista prepara sua simulação e te chama por aqui."

**E. Sem anúncio (Oficial)** — E1: "{{saudacao}}, {{primeiro_nome}}! Sou o assistente virtual do Matheus Machado Imóveis. Como posso te ajudar?" + [Fazer simulação] [Já sou cliente] [Tenho uma dúvida]. Simulação → A1; Já sou cliente → "Que bom falar com você de novo! Já avisei quem cuida do seu atendimento, que te responde por aqui." (horário/fora como B11) → responsável; Dúvida → B.

**F.** Número do corretor sem robô; disparo depois. **Medição:** principal da V1 + % conversas com "robô?/isso é automático?"/reclamação + % que tocou [Falar com alguém].

## Decisões do dono
1. Outra cidade. 2. Robô se apresenta como "assistente virtual" (recomendado). 3. "Pare" → robô marca "Não contactar" sozinho ou humano marca?

## Para WhatsApp e automação
A1+A2 numa mensagem? limite real do botão (Meta); toque em [Tenho uma dúvida] conta como "respondeu" (WA-18)?; janela 24 h e horário do C3; detecção de temas (palavra inteira), uma resposta por tema, limite 8 envios/execução; horário 8h–19h seg–sáb e {{saudacao}}; desligar "TESTE anúncio"; B12/"Não contactar" para tudo na hora.
