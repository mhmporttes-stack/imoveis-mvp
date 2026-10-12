# Rodada 1 — Cadeira Tráfego pago (Versão 4)

> Incorpora decisões 1–4 do dono. Decisões 5–7 (horário com "combinamos outro", corte do lembrete de 23 h, número Oficial novo) chegaram depois — a próxima cadeira aplica.

## Dados (Supabase, leitura; gasto no fuso da conta, Los Angeles)
| Campanha / anúncio | Período | Gasto | Conversas Meta | No CRM c/ ID | Preencheram | R$/conversa | R$/formulário |
|---|---|---|---|---|---|---|---|
| WHATSAPP Marília Patrocinado Vídeo (52550704029553) **ativa**, anúncio 52550704071153 "Eco Village \| Video \| WhatsApp oficial" | 08–12/10 | 92,60 | 20 | 12 | 5 (≤ 24 h) | 4,63 | 18,52 |
| WHATSAPP TRAFEG [TESTE1] (52547581183953) pausada | 24/09–03/10 | 101,12 | 49 | 41 (28 apagadas) | 6 | 2,06 | 16,85 |
| WHATSAPP Ecovillage Carrossel (52550230645153) pausada | 06–10/10 | 59,51 | 7 | **0** | — | 8,50 | — |

- Anúncio ativo promete "relatório completo com simulação, valores, taxa de juros, benefícios e o imóvel sugerido" e "fale com um dos meus associados".
- Texto que o cliente manda: ativo "Olá! Posso ter mais informações sobre isso?" (11/12, genérico da Meta); antigo "Olá! Vi o anúncio e quero fazer a simulação do meu financiamento." (38/41). Todos em `AD_PREFILL_TEXTS` (`lib/whatsapp-referral.mjs` L74-78) — só dispara fluxo, não grava origem.
- Robô hoje (ativo): "Em instantes, um dos meus associados dará início ao seu atendimento" → "preencha o formulário… menos de 2 minutos… valores e imóveis sugeridos" → botão "Formulário de atendimento".
- Público 52550704042353: Marília raio 17 km, 18–55, inclui quem "esteve recentemente/frequenta" (explica outra cidade).
- Divergências: Meta 20 conversas × CRM 12 com ID; carrossel com 7 conversas na Meta e 0 no CRM → investigar (crm-editor).

## Questionamentos
1. A1 da V3 não repete a promessa do anúncio (relatório + atendimento humano) → A1 da V4 repete e diz quando será atendido.
2. A2 com botões logo após o link atrapalha quem está quente (mediana 5 min) e toque em botão solta para roleta/encerra lembretes → A2 só após 10 min, só p/ quem não preencheu nem respondeu.
3. Lembrete 1 h repetia a A2 → cada lembrete com motivo novo.
4. "Pausar TESTE" removido (dono).

## VERSÃO 4
Botões: Fazer simulação (15), Tenho uma dúvida (16), Falar com alguém (16), Já sou cliente (14), Sim, em Marília (15), Outra cidade (12). Fala como "equipe do Matheus Machado Imóveis". Trava "Não contactar" (código).

**A. Anúncio (Oficial)**
- A1 + link [Fazer simulação] — horário: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Pra montar sua simulação com valores, parcela e o imóvel que mais combina com você, preciso de umas respostas rápidas: renda, família e se tem algum valor guardado. Não pede CPF nem documento, e é sem compromisso. Assim que você enviar, um especialista da nossa equipe te chama por aqui com tudo pronto." / fora: mesmo começo, terminando "…Nossa equipe atende de segunda a sábado, das 8h às 19h. Se você responder agora, um especialista já começa seu atendimento com tudo pronto assim que abrirmos."
- A2 (espera 10 min; só se não preencheu nem respondeu — condição "formulário preenchido" pode precisar de código; 50 min sem resposta → stop sem encerrar lembretes): "{{primeiro_nome}}, ficou alguma dúvida antes de responder? Pode me mandar por aqui, escrita ou em áudio." [Tenho uma dúvida] [Falar com alguém] → "Pode mandar, {{primeiro_nome}}! Escreve do seu jeito que a gente te ajuda." → B; Falar → B11; outro texto/áudio → B (código).

**B. Por tema** (uma vez; ≤ 2 msgs; repetiu → B11). B1–B8 = textos da V3/V2 (B1 sem número de perguntas). Mudanças:
- B9: "A gente atende sim quem quer comprar em Marília, mesmo morando em outra cidade 🙂 Você está procurando imóvel em Marília?" [Sim, em Marília] [Outra cidade] → Sim: "Ótimo! Então é só fazer a simulação:" + link / Outra: "Obrigado por avisar! Hoje a gente trabalha com imóveis em Marília. Se um dia pensar em Marília, é só chamar aqui." (encerra; não marca Não contactar)
- B10 (código "é mídia") — horário: "Recebi seu áudio, {{primeiro_nome}}! Já deixei seu recado com a nossa equipe, e um especialista ouve e te responde por aqui." / fora: "Recebi seu áudio, {{primeiro_nome}}! Nossa equipe atende de segunda a sábado, das 8h às 19h, e um especialista ouve e te responde assim que o atendimento começar." + "Se quiser adiantar, a simulação está aqui:" + link
- B11 — horário: "Claro, {{primeiro_nome}}! Deixei seu recado com a nossa equipe, e um especialista te responde por aqui." / fora: "Claro, {{primeiro_nome}}! Nossa equipe atende de segunda a sábado, das 8h às 19h. Deixei seu recado e um especialista te responde assim que começar." + "Enquanto isso, se quiser adiantar:" + link → roleta; sessão termina.
- B12: "Tudo bem, {{primeiro_nome}}, não vou mais te mandar mensagem. Se um dia quiser, é só chamar aqui." → marca Não contactar automático (mantém responsável, CLI-9), só para pedido claro (critérios PRO-8; dúvida → pessoa); encerra sessão e lembretes (código).

**C. Lembretes WA-18** (código: textos novos + sequência por conversa)
- 1 h: "{{primeiro_nome}}, sua simulação ainda está te esperando. São poucos minutos, sem CPF e sem compromisso. É só tocar em Fazer simulação, logo acima."
- 3 h: "Se você trabalha sem carteira ou não tem nada guardado, pode fazer a simulação do mesmo jeito: tem a opção Autônomo e dá pra colocar R$ 0,00 no valor guardado."
- 10 h: "{{primeiro_nome}}, esse é meu último lembrete 🙂 Se preferir, me responde aqui que alguém da nossa equipe te chama."

**D.** Pós-formulário: textos da V2. **E.** Sem anúncio: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis. Como posso te ajudar?" [Fazer simulação] [Já sou cliente] [Tenho uma dúvida]; Já sou cliente → "Que bom falar com você de novo! Já avisei quem cuida do seu atendimento, que te responde por aqui." (fora do horário como B11) → roleta mantendo responsável. **F.** Corretor sem robô; TESTE fica.

**G. Tráfego (cada item só com "sim" do dono; quem executa é o dono no Gerenciador)**
1. Texto pré-preenchido do anúncio → "Olá! Vi o anúncio e quero minha simulação de casa própria." Ordem: crm-editor inclui a frase em `AD_PREFILL_TEXTS` ANTES; criar como anúncio novo PAUSADO no mesmo conjunto (evita reiniciar aprendizado).
2. Texto do anúncio: confirmar que a entrega tem "taxa de juros, benefícios e imóvel sugerido" antes de repetir a promessa. Sugestão: "Pagando aluguel em Marília? Chame no WhatsApp, responda umas perguntas rápidas (sem CPF) e receba sua simulação com valores e o imóvel sugerido." Usar "especialista"/"associado do corretor Matheus Machado".
3. Medir por anúncio via ID na conversa (conversa → link → formulário ≤ 24 h → funil × gasto). `utm_content` pouco ajuda; 4 origens `ctwa_formulario` sem ID.
4. Não escalar nem pausar até ≥ 30 conversas por período (hoje 12).

## Para Viabilidade (crm-editor)
Condição "formulário preenchido" para a A2 e interação da espera de 10 min com lembretes presos por sessão viva; nova frase em `AD_PREFILL_TEXTS` e guardar origem por texto (sem mexer na roleta); "Não contactar" automático via `lib/do-not-contact-core.mjs` + trava em Fluxos/respostas; áudio e roteamento por tema; divergência Meta × CRM (carrossel 0 conversas).
