# Rodada 1 — Cadeira Dados do CRM (Versão 1)

Fonte: Supabase, horário de São Paulo. `whatsapp_session_telemetry` (desde 04/10; antes só `whatsapp_session_events`); `daily_goal_auto_queue` (608 envios automáticos, 29/09–15/10) × `whatsapp_inbound_events` (resposta em ≤ 7 dias); `daily_goals`, `whatsapp_restrictions`, `whatsapp_individual_sessions`. "Episódio de queda grave" = 401/403 do mesmo número com > 6 h do anterior: **36 episódios** (sem admin), 7 corretores com automação, 12 números. Nada prova causa.

## Resumo
1. Volume da prospecção não explica a maioria: **21/36** episódios sem nenhum envio automático nas 24 h antes (Eduardo: 7× 403 com só 13 envios no período).
2. Reincidência: **25/36 (69 %)** em número que já caiu nos 7 dias anteriores.
3. Só a 1ª tentativa traz resposta útil; nas 2ª/3ª com "responda SAIR", **11/12** respostas foram SAIR.
4. Meta baixa para todos, não só em dia de queda: 01/10 → 02/10 de 350 para 87 tentativas/dia; **06–09/10 = 0 envios automáticos**, provável `google_contacts_sync_falhou` (104 erros 03–10/10), não o WhatsApp.

| Item | Valor | n |
|---|---|---|
| Entregues (`delivered_at`) | 58 % | 352/608 |
| Responderam (qualquer) | 8,9 % | 54/608 |
| Resposta útil 1ª tentativa | 9,2 % (IC95 6,3–13,1) | 26/283 |
| Resposta útil 2ª+3ª | 2,2 % (IC95 1,0–4,4) | 7/325 |
| SAIR entre respostas aos modelos novos | 62 % | 21/34 |
| Resposta em mensagem marcada "não entregue" | 20 % das respostas | 11/54 |
| Horas sem número até reconectar (mediana) | ~15 h; 5 sem volta | 31 |
| Restrições informadas nunca validadas | 11 (10 voltaram sozinhas) | 11/13 |
| Meta média, seg–sáb com 401/403 | 20 % | 26 dias |
| Meta média, seg–sáb sem 401/403 (05–15/10) | 12 %; 20 dias em 0 % | 42 dias |

## Premissas questionadas
- P1 "Volume queima o número": não como causa principal (ressalva: 7 de 9 dias-número com ~15 envios tiveram queda em ≤ 2 dias; n < 10).
- P2 "Queda deixa a meta em 0 %": meta já baixa sem queda; maior buraco foi a fila parada pelo Google Contacts; prospecção manual sumiu (255 em 28/09 → ~0).
- P3 "CRM sabe o que foi entregue": subconta (20 % das respostas em "não entregue"); "lida" não mensurável (só 38/608 em `whatsapp_messages`) → lacuna de rastreamento.
- P4 "2 números por corretor": em 3 de 4 corretores com 2 espaços, o mesmo número nos dois; Ketlin caiu nos dois no mesmo minuto (13/10 15:04).
- P5 "Restrição informada": quase sempre queda comum (2/13 validadas).
- Divergência: brief "15/dia, dias úteis, 6h–18h30" × rule "30/dia, seg–sáb, 06:30–18:00"; banco: todos `daily_cap_override=15`.

## VERSÃO 1
1. **Prospectar sem queimar:** (a) 2 tentativas automáticas (3ª manual ou eliminada); (b) até 15/número/dia e **5/dia** em número que caiu nos últimos 7 dias; (c) candidato: concentrar 9h–14h (15–18h 2,1 % × 9–11h 7,7 %, intervalos se sobrepõem — testar); (d) 1ª mensagem sem link (já é: 0/608).
2. **Detectar cedo:** S1 ≥ 10 envios/24 h com ≤ 2 entregues (existe desde 13/10; pegaria 2/36, 0 falso); **S2 novo:** queda grave no mesmo número nos 7 dias → "em risco" (teto 5, só 1ª tentativa, avisar gestora) — pegaria 25/36, não o 1º de cada número; S3 SAIR > 20 % das respostas do dia (não testável); descartado "≥ 6 quedas comuns/24 h" (42 % de acerto).
3. **Voltar rápido:** alerta → gestora liga em ≤ 30 min → reconecta ou libera lista impressa no mesmo dia; indicador "horas sem número", meta < 2 h na janela de envio (hoje ~15 h; 12 listas impressas para 36 episódios).
4. **Reserva/rodízio:** rodízio não; **Número 1 "prospecção" (descartável) + Número 2 "relacionamento"** (sem envio frio), chip e conta realmente diferentes.
5. **Cliente salvar/responder:** clique em link não é medido; 1ª mensagem com pergunta curta que pede resposta, link só depois da resposta; medir clique (crm-editor).

## Para WhatsApp e automação
Por que há logouts 401 sem envio (aparelho desvinculado? instabilidade — 500/428 = 71 % das quedas comuns? mesmo número em 2 espaços?); gravar "lida" e entrega das automáticas; "responda SAIR" protege ou só antecipa opt-out?; fila não travar com erro do Google Contacts.

Limitações: telemetria só desde 04/10 (403 de 03/10 fora); respostas por LID podem estar subcontadas; amostras pequenas e várias mudanças de regra (02, 04, 10, 13/10).
