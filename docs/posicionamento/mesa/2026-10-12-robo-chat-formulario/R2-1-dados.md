# Rodada 2 — Cadeira Dados do CRM (Versão 6)

Coorte: 1ª sessão do Fluxo "Anúncio%" por telefone (últimos 10 dígitos), 24/09–12/10, America/Sao_Paulo; 49 telefones, 24 apagados → **25 analisados**. Fontes: `whatsapp_flow_sessions`, `whatsapp_messages`, `whatsapp_master_events`, `simulation_registrations`, `client_origins`, `client_status_history`. Só leitura; n pequeno → só descritivo (MET-14).

## Resposta às objeções contra a V1
Aceita remover "Já vou preencher" (5/9 preenchem entre 3 e 10 min; toque solta para roleta sem renda); lembrete 20h resolvido pelas decisões 6 e 8; "especialista"; robô não esperar (hoje nenhuma sessão de anúncio fica viva: a mais longa 2 s). **Retira a premissa 1 da V1 ("fica sem resposta"): refutada.**

## Testes
1. Carrossel: 0 mensagens com ID do carrossel no Oficial (06–12/10); 14 com `referral`, todas do anúncio ativo; 1 com texto pronto sem `referral` (10/10). Oficial sem eventos de 29/09 a 08/10 09:04. Confirma decisão 9 (número particular).
2. Respostas durante sessão viva/espera: **0** (50 sessões, todas handoff ≤ 2 s). Se criar espera de 3 min: 6/13 primeiras mensagens chegariam antes.
3. Mídia: 8 conversas (41 arquivos; 6 começaram com áudio). Resposta automática 0; humana 8/8, mediana **7,8 min** (máx. 169). 0/7 que mandaram mídia antes do formulário preencheram em 24 h — mas todos foram atendidos.
4. "Contato direto" sem ID (número novo, 08–12/10): 5/14 (36 %), 4 de 08/10 (tinham referral) + 1 sem referral (10/10); desde 09/10 só 1/10 — parece corrigido (WA-18); crm-editor confirmar.
5. Base: **9/25 = 36 %** formulário ≤ 24 h (IC95 21–55 %), mediana 5,5 min; número novo 5/13 (38 %).

| Grupo | n | ≥ "Simulação enviada" | ≥ Documentação |
|---|---|---|---|
| Preencheu sem falar | 6 | 4 | 3 |
| Falou e preencheu | 3 | 3 | 2 |
| Falou e não preencheu | 10 | 7 | 5 |
| **Silêncio** | 6 | 1 | 0 |

- 10/10 que falaram e não preencheram tiveram resposta humana (mediana ~4–5 min, máx. 34). Esse grupo avança sem formulário. **A perda real é o silêncio.**
- Armadilha: `last_form_submitted_at` muda quando o cliente reenvia o formulário (contagem oscilou 8 → 9).

## Questionamentos à V5
1. A2 após 3 min sem base (cai no meio do preenchimento de 5/9; repete o lembrete de 1 h) → **cortar A2 e espera** (sai Fase 2 item 4).
2. Roteador de 12 temas (Fase 2 item 5): humano já responde em ~5 min e quem conversa avança → **Fase 3, só se a 1ª resposta humana passar de 15 min no horário**.
3. A1 condicionada é verdadeira mas incompleta: quem escreve também é atendido (13/13) → A1 oferece os dois caminhos.

## VERSÃO 6
Fala como "a equipe"; nada para Não contactar; Botão = "Fazer simulação" → `/s`; fora do horário = fora de seg–sáb 8h–19h.

**A. Anúncio (Oficial) — 1 envio, sessão termina (sem espera)**
- A1 horário: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Pra montar sua simulação (quanto você pode financiar, a parcela, os benefícios e um imóvel sugerido), responde umas perguntas rápidas no link abaixo. Não pede CPF nem documento, e é sem compromisso. Se preferir, pode mandar sua dúvida aqui mesmo, escrita ou em áudio, que um especialista da nossa equipe te responde." + Botão
- A1 fora: mesmo texto até "sem compromisso." + "Se preferir, pode mandar sua dúvida aqui. Nosso atendimento é de segunda a sábado, das 8h às 19h. Se esse horário não der pra você, é só avisar que a gente combina outro." + Botão

**B. Cliente escreve depois do link (sem roteador na Fase 2)**
- Horário: sem resposta automática; pessoa responde.
- Fora (uma vez por conversa): "Recebemos sua mensagem, {{primeiro_nome}}! Nosso atendimento é de segunda a sábado, das 8h às 19h. Se esse horário não der pra você, me diz qual fica melhor que a gente combina. Se quiser adiantar:" + Botão
- B9 e B12: textos da V5 (finish / Não contactar). B1–B8 guardados para a Fase 3.

**C.** Lembretes 1 h / 3 h / 10 h: textos da V5 (sem 23 h; 21h–8h → 8 h). **D.** Pós-formulário: V4. **E.** Sem anúncio: V5. **F.** Corretor sem robô; TESTE fica.

## Especificação
- **Fase 1 (configurar):** A1 horário/fora, D, E, B9 com finish.
- **Fase 2 (código):** V5 itens 1 (trava Não contactar), 2 (pare → Não contactar), 3 (formulário encerra sessão viva — útil para os botões de E), 6 (lembretes) + **novo**: resposta única fora do horário à 1ª mensagem livre do cliente de anúncio, sem sessão (esforço a confirmar). Saem itens 4 e 5.
- **Fase 3:** temas B1–B8 (só se 1ª resposta humana > 15 min no horário); áudio; botão nos lembretes; ID do anúncio em conversa existente.

## Métrica (4 semanas após a Fase 2; ~70 conversas pelo ritmo atual)
- **Principal:** % de conversas de anúncio **sem resposta e sem formulário em 24 h**. Base 6/25 = 24 %; meta ≤ 15 %.
- **Guarda:** % que chega a "Simulação enviada" ou além em 7 dias (base 15/25 até 12/10; recalcular em 7 dias) — não pode cair.
- **Secundária:** formulário ≤ 24 h. Base 36 %; meta ≥ 45 %.
- Leitura honesta: só dá para afirmar melhora sem sobreposição de intervalos (formulário > ~67 %); abaixo disso, descritivo.

## Para Atendimento humanizado
Como a pessoa conduz quem manda áudio (0/7 preencheram) e quem conversa sem preencher (coletar renda/família no chat ou só reenviar o link?); texto final da resposta fora do horário e da A1 com dois caminhos; o que dizer ao grupo do silêncio nos lembretes.
