# Rodada 2 — Cadeira Tráfego pago (Versão 9)

Base: 1ª sessão do Fluxo "Anúncio%" por telefone, 24/09–12/10, não apagadas, n=25 (= R2-1). Horário de Brasília. Fora = domingo ou fora de 8h–19h. Supabase, só leitura.

## Objeções contra a V4
Aceita corte da A2 (7/9 formulários em ≤ 7 min); promessa condicionada só até a Fase 2 (com a decisão 10 todo lead acaba falando com uma pessoa); plural.

## Dados
**A A1 cumpre a promessa do anúncio? Não.** Anúncio: "relatório completo com simulação, valores, taxa de juros, benefícios e o imóvel sugerido". Entregue aos 25 (`simulations`, `simulation_properties`, `simulation_presentations`): simulação 14, taxa preenchida 5, subsídio 6, imóvel sugerido 6, apresentação 8. O sistema gera tudo (`lib/simulation-presentation-core.mjs` L152-307), mas só com pessoa montando → **quem muda é o anúncio**; A1 só ganha quem entrega.

| Janela | Conversas | Formulário ≤ 24 h | Silêncio |
|---|---|---|---|
| Seg–sáb 8h–12h | 6 | 3 | 1 (em andamento) |
| Seg–sáb 12h–14h | 2 | 0 | 0 |
| Seg–sáb 14h–19h | 6 | 3 | 1 |
| Seg–sáb 19h–24h | 3 | 1 | 2 |
| Madrugada 0h–8h | 3 | 1 | 1 |
| Domingo | 5 | 1 | 1 |
| **Fora (total)** | **11 (44 %)** | 3 (27 %) | 4 (36 %) |
| **Horário (total)** | 14 | 6 (43 %) | 2 (14 %) |

- Anúncio ativo (08–12/10): 5/13 fora; 3 dos 4 silêncios fora.
- Programar por horário: **não agora** (fora ainda gera 3 formulários e 7 conversas; 4 tiveram resposta humana em 2–14 min; intervalos se sobrepõem; programação exige orçamento total e reinicia aprendizado).
- Gasto fora do horário: não mensurável no CRM (insights só por dia, fuso LA). Aproximação: dia 11/10 LA ≈ dom 4h–seg 4h Brasília = R$ 25,76 de R$ 93,85 (27 %). Real: Gerenciador > Detalhamento > Por tempo > Hora do dia.
- Silêncio desde 09/10: 1º contato humano só após 11,8 h e 18,8 h; 3º caso (dom 14:08) sem contato; lembrete de 10 h saiu às 00:09 (confirma decisão 8).

**Decisão 10 — quando transferir:** 8/9 formulários antes de 3 h. **Opção A (recomendada):** com o lembrete de 3 h, se ninguém respondeu nem preencheu; se cair 21h–8h, às 8 h. **Opção B:** com o último lembrete (quase sempre no dia seguinte). Gasto não muda; deixam de ficar sem pessoa 3/11 conversas pagas (R$ 4,69 cada).

## Questionamentos à V8
1. A1 não diz quem entrega → "Um especialista da nossa equipe te manda o resultado por aqui", só quando a transferência estiver no ar (Fase 2).
2. Fora do horário "assim que começar" contradiz quem é atendido em minutos (4/11) → "fora dele, a equipe te responde assim que possível".
3. Lembrete de 10 h coerente com a transferência: "alguém da nossa equipe vai te chamar"; suprimido se uma pessoa já falou.

## VERSÃO 9
Voz "a equipe", plural; ≤ 1 emoji; nada para Não contactar/arquivado/Particular/equipe. Botão = "Fazer simulação" → `/s`. Sem nome: tira vírgula e nome.

**A. Anúncio (Oficial), 1 envio**
- A1 horário: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Pra montar sua simulação (quanto você pode financiar e a parcela), é só responder umas perguntas rápidas no link abaixo. Não pede CPF nem documento, e é sem compromisso. Um especialista da nossa equipe te manda o resultado por aqui. Se preferir, manda sua dúvida aqui mesmo, escrita ou em áudio." + Botão
- A1 fora: igual até "...te manda o resultado por aqui." + "Nosso atendimento é de segunda a sábado, das 8h às 19h. Se esse horário não der pra você, é só avisar que a gente combina outro." + Botão
- Fase 1: sem a frase "Um especialista... por aqui".

**B.** Horário: nada automático (M1–M5). Fora, não preencheu (travas da V8): "Recebemos sua mensagem{{, Nome}}! Nosso horário de atendimento é de segunda a sábado, das 8h às 19h; fora dele, a equipe te responde assim que possível. Se esse horário não der pra você, conta pra gente qual fica melhor que a gente combina. Se quiser adiantar, a simulação não pede CPF e não consulta seu nome:" + Botão. Já preencheu: até "...que a gente combina.", sem botão. B12: texto da V8 → Não contactar. B1–B10/B9: Fase 3 (M5 pergunta a cidade).

**C. Lembretes 1 h / 3 h / 10 h** (21h–8h → uma às 8 h)
- 1 h: "{{Nome}}, conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio."
- 3 h: "Só lembrando: com a simulação você já fica sabendo quanto pode financiar e a parcela pro seu caso. Não pede CPF e é sem compromisso. É só tocar em Fazer simulação, na mensagem acima." → sem resposta e sem formulário: **transfere para a roleta (opção A)**.
- 10 h: "{{Nome}}, essa é nossa última mensagem sobre a simulação 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer do mesmo jeito. Alguém da nossa equipe vai te chamar por aqui pra tirar suas dúvidas." (não sai se uma pessoa já escreveu)
- 8 h: "Bom dia{{, Nome}}!" + texto do último lembrete vencido; na opção A, transferência no mesmo momento.

**D.** V8. **E.** V8 (sem B9; outra resposta → pessoa; sem resposta → stop). **F.** Corretor sem automação; TESTE fica.
**G.** M1–M5 no Guia (decisão 11) como "Lead de anúncio: primeira resposta (texto ou áudio)", + abertura para quem chega pela roleta vindo do silêncio: "Oi, [Nome]! Aqui é o(a) [nome], da equipe do Matheus Machado Imóveis. Vi que você chamou pelo anúncio da simulação. Posso te ajudar por aqui mesmo?"

## Especificação
- Fase 1: V8, A1 sem "te manda o resultado".
- Fase 2: itens 1–5 da V8 + **6** transferência do silêncio para a roleta em `lib/whatsapp-form-reminder-core.mjs` (passo de 3 h ou 8 h; sem mensagem do cliente, sem formulário, sem resposta humana; mesma liberação da WA-18; 10 h suprimido se houve resposta humana; testes; `/registrar-regra` decisão 10) + **7** entrada do Guia. A frase nova da A1 só depois do item 6 no ar.
- Fase 3: V8 + sincronizar gasto por hora (`hourly_stats_aggregated_by_advertiser_time_zone`).

## H. Tráfego (cada item só com "sim" do dono; ele executa no Gerenciador)
1. Duplicar o 52550704071153 PAUSADO com texto: "Pagando aluguel em Marília? Chame no WhatsApp e receba sua simulação: quanto você pode financiar e a parcela pro seu caso. Sem CPF e sem compromisso. Atendimento da equipe do Matheus Machado Imóveis." (sai "relatório completo", "taxa de juros", "imóvel sugerido", "meus associados"). Risco: revisão + reaprendizado; trocar só com mais semanas de dado.
2. Mesmo duplicado com texto pré-preenchido "Olá! Vi o anúncio e quero fazer a simulação do meu financiamento." (já reconhecido).
3. Não programar por horário; olhar Hora do dia no Gerenciador; reavaliar 4 semanas após a Fase 2.
4. Antes de reativar qualquer anúncio (inclusive carrossel), destino = número Oficial.
5. Público: não mexer.
6. Medição semanal por anúncio (conversas Meta → CRM c/ ID → formulário ≤ 24 h → silêncio por janela → tempo até 1º contato humano após a roleta). Base: 36 %, 6/25 silêncio, R$ 18,77/formulário.

## Para Viabilidade
Item 6: onde chamar a liberação no módulo de lembretes, resposta humana cancela lembretes?, evitar dupla roleta; Guia por seed (`lib/attendance-guide-seed-library.mjs`) ou tela; gasto por hora; `interest_rate_annual` vazio = não informado ou campo recente? **Dono:** opção A (3 h) ou B (último lembrete)?
