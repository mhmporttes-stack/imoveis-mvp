# Rodada 3 — Cadeira Dados do CRM (Versão 11)

Coorte WA-18: clientes de anúncio segurados de 09/10 07h30 a 12/10 10h33 (Brasília), via `lead_distribution_history.details.via = anuncio_aguardando_resposta` — **n = 9** (só descritivo; 12/10 feriado). Comparação: coorte R2 (n = 25). Fontes: `lead_distribution_history`, `whatsapp_messages`, `client_status_history`, `simulation_registrations`, `admin_presence_activity`, `crm_notifications`, `client_tags`. Só leitura.

## Objeções à V6
Aceita: plural; uma vez por período fechado (decisão 12); transferência com relógio próprio; A1 mais curta.

## Testes
1. **Segurados > 3 h hoje: 0** (data de corte não deixa ninguém para trás). Dos 9: 4 saíram sozinhos (3 formulário em 2–5 min, 1 resposta em 1 min); **5 silêncios, todos transferidos à mão**:

| Janela da A1 | n | Transferência à mão | Regra V10 |
|---|---|---|---|
| Horário | 2 | 1h09 e 2h39 | 0 (equipe antes) |
| Madrugada | 2 | 11h40 e 18h45 | 2, às 8 h |
| Domingo | 1 | 19h41 | 1, às 17h08 |
| Noite 19h–21h | 0 | — | — |

   3 casos em ~3,1 dias. Desde 24/09 (47 clientes de anúncio): 46 % fora do horário (23 % madrugada, 17 % domingo, 6 % noite).
2. **Fila às 8 h:** 0–1 cliente/manhã. Corretor on-line às 8h00 em só 5 de 15 dias seg–sáb; 1º on-line mediana **08h05** (máx. 08h39); 2–4 ativos entre 8h e 9h; domingos 08h04, 17h52, 09h14. Fila noite→manhã entregue 06h06, 06h58, 07h20; pior espera 22 h (dom 04/10).
3. **Avisos à gestão:** 2 pessoas; 70 notificações em 14 dias (28/09–12/10) = 5/dia; desde 05/10: 11 (8 "aguardando corretor"). Cada transferência em fila vazia = +2 avisos → +1 a +2/dia.
4. **Outra cidade:** sem campo de cidade no banco (`preferred_regions` = zonas de Marília). Tag **"OUTRA CIDADE"**: 6 clientes (26/08–18/09) → 4 Arquivado, 1 Não contactar, 1 Simulação realizada — **prática atual é arquivar** (contra a decisão 12/WA-13). "Tentando contato" tem 1.420 clientes (1.373 prospecção manual). Quem tira da roleta/REDISTRIBUIÇÃO é a **mensagem humana**, não o status (`lib/simulation-deadline-core.mjs:13-16,34-38`). "Tentando contato" escapa da cobrança "sem atividade futura" (`lib/crm-automations.js:269`, `lib/client-status.js:391`); volta a "Em atendimento" se escrever (`lib/whatsapp-client-status-core.mjs:25`); alerta "Sem contato há +3 dias" continua (`lib/client-status.js:397-407`). **Aprova** com ressalvas: usar a tag existente "OUTRA CIDADE"; Guia diz "não arquivar"; relatórios de "Tentando contato"/Prospecção excluem a tag (crm-editor confere `docs/METRICAS_FUNIL.md`).
5. **Bases (WA-18):** silêncio no momento da transferência 4; tocados por pessoa em ≤ 1 h após esse momento **1/4**; formulário ≤ 24 h 2/5 (R2 36 %); sem resposta e sem formulário 24 h 2/5 (R2 24 %); Não contactar 0/9; giros de REDISTRIBUIÇÃO 1.

## Questionamentos à V10
1. Aviso à gestão às 8 h = barulho (sem corretor on-line 10/15 dias) → transferência do silêncio **não chama `notifyStaff`**.
2. Transferência à mão desliga a REDISTRIBUIÇÃO (ROL-4d): 2/5 sem mensagem humana às 10h33 de hoje → **até a Fase 2, usar "Devolver para a roleta"** em vez de atribuir à mão (mantém prazo de 10 min). Mudar a ROL-4d é decisão do dono.
3. Métrica da V6 não mede a transferência → principal = **silêncio tocado a tempo**; gravar `via: anuncio_silencio`.
4. Domingo sem exceção (fila entrega antes de segunda 8 h).

## VERSÃO 11
Textos A1, B, B12, C (inclui lembrete único com 8 h e 2 h), D, E, F, G: **iguais à V10 + adendo** (`R2-5-viabilidade.md`). Mudanças:
- **Jornada:** clique → A1 → (a) preenche → D → roleta; (b) escreve → horário: pessoa (M1–M5); fora: B uma vez por período → roleta; (c) silêncio → 1 h → **A1 + 3 h: lembrete de 3 h + transferência** (21h–8h → 8 h; domingo idem, fila se ninguém) → 10 h só se ninguém da equipe escreveu. Parar → B12. Outra cidade → H.
- **Transferência:** sem mensagem ao cliente, **sem aviso à gestão**, `via: anuncio_silencio` no histórico; corretor recebe "não respondeu às mensagens automáticas".
- **H:** após o M5, status "Tentando contato" + tag **"OUTRA CIDADE" (existente)**. **Nunca arquivar**, nunca Não contactar.
- **Fase 1** ganha: até a Fase 2 sair, silêncio de anúncio → "Devolver para a roleta", não atribuir à mão. Guia G + H.
- **Fase 2 item 5:** `decideSilenceTransfer`, `via: "silence"`, `details.via = 'anuncio_silencio'`, sem `notifyStaff`, texto em `afterRelease`, não retroativo; testes: madrugada → 8 h, domingo → fila, equipe já escreveu, Particular, corrida. `/registrar-regra` decisões 6, 8, 10, 12.
- **Fase 3** ganha: campo de cidade (só se o dono quiser medir).

## Painel de métricas (4 semanas após o item 5; ~20–30 casos; < 30 = descritivo; Wilson 95 %; metas = proposta, dono confirma)
| Métrica | Base | Meta |
|---|---|---|
| **Principal: silêncio tocado a tempo** (1ª mensagem humana ≤ 1 h após o momento da transferência) | 1/4 | ≥ 80 % |
| Guarda: ≥ "Simulação enviada" em 7 dias | R2 15/25 (60 %, status atual) | não cair |
| Guarda: Não contactar em 7 dias | 0/9 | ≤ 10 % |
| Guarda: avisos à gestão/dia | 5/dia (28/09–12/10); ~1,5/dia desde 05/10 | ≤ +1/dia |
| Secundária: formulário ≤ 24 h | R2 36 %; WA-18 2/5 | ≥ 45 % |
| Secundária: sem resposta e sem formulário 24 h | R2 24 %; WA-18 2/5 | ≤ 15 % |
| Secundária: giros de REDISTRIBUIÇÃO por transferido | 1 em 9 | mediana ≤ 1 |

**SQL principal e 24 h** (testada):
```sql
with seg as (select h.registration_id cid,(h.details->>'conversationId')::uuid conv from lead_distribution_history h
  where h.details->>'via'='anuncio_aguardando_resposta' and h.created_at>='2026-10-09T10:30:00Z' and h.created_at<now()),
m as (select s.cid,
  min(w.message_at) filter (where w.direction='outbound' and w.sender_type='automation' and coalesce(w.status,'')<>'failed') a1,
  min(w.message_at) filter (where w.direction='outbound' and w.sender_type='user' and coalesce(w.status,'')<>'failed') humano1
  from seg s join whatsapp_messages w on w.conversation_id=s.conv group by 1),
r as (select m.*,(select min(w.message_at) from whatsapp_messages w join seg s2 on s2.conv=w.conversation_id
   where s2.cid=m.cid and w.direction='inbound' and coalesce(w.message_type,'text')<>'reaction' and w.message_at>m.a1) resposta1,
  coalesce((select min(changed_at) from client_status_history x where x.client_id=m.cid and x.new_status='pending'),c.last_form_submitted_at) form1,
  ((m.a1+interval '3 hours') at time zone 'America/Sao_Paulo') t3
  from m join simulation_registrations c on c.id=m.cid),
k as (select r.*, case when t3::time>='21:00' then ((t3::date+1)+time '08:00') at time zone 'America/Sao_Paulo'
  when t3::time<'08:00' then (t3::date+time '08:00') at time zone 'America/Sao_Paulo' else a1+interval '3 hours' end momento from r)
select count(*) filter (where now()>=momento+interval '1 hour' and coalesce(resposta1,'infinity')>momento and coalesce(form1,'infinity')>momento) silencio,
  count(*) filter (where now()>=momento+interval '1 hour' and coalesce(resposta1,'infinity')>momento and coalesce(form1,'infinity')>momento and humano1<=momento+interval '1 hour') tocado_1h,
  count(*) filter (where now()>=a1+interval '24 hours') maduros_24h,
  count(*) filter (where now()>=a1+interval '24 hours' and form1<=a1+interval '24 hours') form_24h,
  count(*) filter (where now()>=a1+interval '24 hours' and coalesce(resposta1,'infinity')>a1+interval '24 hours' and coalesce(form1,'infinity')>a1+interval '24 hours') sem_resp_sem_form_24h
from k;
```
**SQL guardas e giros** (testada; lista de status = variante, conferir com `docs/METRICAS_FUNIL.md`):
```sql
with seg as (select distinct on (registration_id) registration_id cid, created_at entrada from lead_distribution_history
  where details->>'via'='anuncio_aguardando_resposta' and created_at>='2026-10-09T10:30:00Z' and created_at<now() order by registration_id, created_at)
select count(*) filter (where now()>=entrada+interval '7 days') maduros_7d,
  count(*) filter (where now()>=entrada+interval '7 days' and exists (select 1 from client_status_history x where x.client_id=seg.cid
    and x.changed_at<=seg.entrada+interval '7 days' and x.new_status not in ('automated_service','pending','completed','in_service','awaiting_return','archived','do_not_contact'))) sim_enviada_7d,
  count(*) filter (where exists (select 1 from client_status_history x where x.client_id=seg.cid and x.new_status='do_not_contact' and x.changed_at<=seg.entrada+interval '7 days')) nao_contactar_7d,
  (select count(*) from lead_distribution_history h join seg s2 on s2.cid=h.registration_id where h.event_type='auto_transferred') giros
from seg;
```
**SQL avisos à gestão:**
```sql
select count(*)::numeric/nullif(count(distinct (created_at at time zone 'America/Sao_Paulo')::date),0) por_dia
from crm_notifications where created_at>=:inicio and created_at<:fim
and recipient_user_id in (select id from admin_users where role in ('admin','manager') and status='active');
```

## Armadilhas
`last_form_submitted_at` muda com reenvio (usar histórico de status primeiro); "on-line" aproximado por atividade 07h55–08h00 em `admin_presence_activity`.

## Para Atendimento humanizado
Às 8 h o cliente recebe "Bom dia" automático e ~5 min depois (máx. ~40) a abertura do corretor → a abertura do silêncio deve reconhecer o lembrete; M5 confirma se quer comprar em Marília antes da tag. **Operacional agora:** 2 clientes de anúncio sem mensagem humana às 10h33 de 12/10 (IDs internos `3f299ee9`, `faa1ca5f`).
