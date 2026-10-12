# Rodada 3 — Cadeira Tráfego pago (Versão 14 = V13 + mudanças + bloco H final)

Só leitura (Supabase).

## Dados novos
- Anúncio ativo **52550704071153** ("Eco Village | Video | WhatsApp oficial"), campanha **52550704029553**: os 9 segurados desde 09/10 vêm dele (`lead_distribution_history` + `client_origins.source_metadata.ad_id`; bate com 9 eventos em `whatsapp_master_events`).
- Gasto 09–11/10 (dias LA): **R$ 78,78**, **15 conversas** na Meta (`meta_ad_insights`) × **9 clientes** no CRM com o ID → **6 conversas pagas sem rastro** (motivo desconhecido).
- Pré-preenchido atual = padrão Meta "Olá! Posso ter mais informações sobre isso?" (10 desde 09/10); o proposto nunca foi usado; ambos reconhecidos (`lib/whatsapp-referral.mjs:74-78`).
- Formulário ≤ 24 h: 2/5 maduros → R$ 39,39/formulário (n = 5, descritivo; não comparável com R$ 18,77).

## Respostas à V9
Aceita: A1 única (→ anúncio antigo choca com A1 já na Fase 1 → **troca do anúncio sobe para a Fase 1**); transferência contada da A1; 10 h condicional; sem aviso à gestão (painel separa "fila" × "on-line").

## Questionamentos à V13
1. Painel só vê quem virou cliente com ID (15 × 9 ≈ 40 % escondido) → guarda "conversas Meta × clientes com ID"; Viabilidade confere o motivo.
2. Métrica principal culparia o anúncio pela falta de gente (fila vazia de domingo/madrugada, pior 22 h) → medir em dois grupos: "havia corretor on-line" × "foi para a fila"; decisão de horário usa só o 2º.
3. Ninguém conferiu se o Fluxo TESTE casa com o pré-preenchido novo → Viabilidade, antes de ligar.

## VERSÃO 14
Textos A–G = V13. Painel = V11 + H3.

### H. Tráfego final (cada item só com "sim" do dono; ele executa no Gerenciador)
**H1. Anúncio novo, PAUSADO, ligado junto com a Fase 1.**
- Texto: "Para quem quer sair do aluguel em Marília: chame a gente no WhatsApp, responda umas perguntas rápidas e um especialista da nossa equipe te manda sua simulação, com quanto você pode financiar e o valor da parcela. A simulação não pede CPF nem documento, e é sem compromisso. Equipe Matheus Machado Imóveis."
- Título: "Simule seu financiamento pelo WhatsApp". Botão: "Enviar mensagem".
- Saem "relatório completo", "taxa de juros", "imóvel sugerido", "meus associados" e "Pagando aluguel?" (Meta reprova texto que aponta característica pessoal).
- Risco: revisão + reaprendizado.

**H2. Pré-preenchido:** "Olá! Vi o anúncio e quero fazer a simulação do meu financiamento." (exato — é por ele que o Fluxo reconhece o anúncio se a Meta não mandar o ID; sem dado de que converte mais).

**H3. Medição semanal por anúncio** (testada, só leitura) + consultas da V11 por `ad_id`, separadas em "on-line" e "fila":
```sql
with seg as (select distinct on (h.registration_id) h.registration_id cid, h.created_at entrada
  from lead_distribution_history h where h.details->>'via'='anuncio_aguardando_resposta'
  and h.created_at>=:inicio and h.created_at<:fim order by h.registration_id, h.created_at),
ad as (select s.*, coalesce(o.source_metadata->>'ad_id','sem_id') ad_id, coalesce(o.source_metadata->>'campaign_id','sem_id') campaign_id
  from seg s left join lateral (select source_metadata from client_origins o where o.client_id=s.cid
  and o.source_metadata ? 'ad_id' order by o.created_at limit 1) o on true),
crm as (select ad_id, campaign_id, count(*) clientes,
  count(*) filter (where now()>=entrada+interval '24 hours') maduros_24h,
  count(*) filter (where now()>=entrada+interval '24 hours' and coalesce((select min(changed_at) from client_status_history x
    where x.client_id=ad.cid and x.new_status='pending'),'infinity')<=entrada+interval '24 hours') form_24h,
  count(*) filter (where exists (select 1 from lead_distribution_history t where t.registration_id=ad.cid
    and t.details->>'via'='anuncio_silencio')) transferidos_silencio
  from ad group by 1,2),
meta as (select i.entity_id ad_id, sum(i.spend) gasto, sum((select sum((a->>'value')::numeric) from jsonb_array_elements(i.actions_raw) a
  where a->>'action_type'='onsite_conversion.messaging_conversation_started_7d')) conversas_meta
  from meta_ad_insights i where i.entity_type='ad' and i.date>=:inicio_dia and i.date<:fim_dia group by 1)
select crm.*, meta.gasto, meta.conversas_meta, round(meta.gasto/nullif(crm.form_24h,0),2) custo_por_form_24h
from crm left join meta on meta.ad_id=crm.ad_id;
```

**H4. Reavaliação (D = publicação da Fase 2).** D+14: só guardas (Não contactar, avisos à gestão, Meta × CRM). D+28: decidir (~20–30 silêncios; < 30 descritivo). Ex.: Fase 2 em 19/10 → decisão 16/11. Sinais (vs. base histórica):
- Pausar: Não contactar 7 dias acima da meta confirmada, ou formulário 24 h e "Simulação enviada" 7 dias abaixo da base do anúncio antigo.
- Escalar: formulário 24 h e "Simulação enviada" 7 dias ≥ base, silêncio tocado no grupo "on-line" dentro da meta, fila das 8 h em 0–1/manhã.
- Programar por horário: só se Hora do dia no Gerenciador mostrar gasto fora do horário com claramente menos formulários e o grupo "fila" sem toque humano (exige orçamento total; reinicia aprendizado).

**H5. Checklist no Gerenciador antes de ligar:**
1. Duplicar o 52550704071153 no mesmo conjunto, **PAUSADO**.
2. Destino = **número Oficial novo** (conferir dígitos; nunca o particular).
3. Colar texto, título e pré-preenchido (H1, H2).
4. Assistir ao vídeo inteiro: fala/legenda sem "relatório completo", taxa, "imóvel sugerido" ou aprovação.
5. Categoria especial (moradia/crédito) na campanha 52550704029553: **A CONFIRMAR** pelo dono.
6. UTM não se aplica (clique para WhatsApp); atribuição pelo ID do anúncio; nome claro (ex.: "Simulação | Vídeo | Oficial | v2").
7. Mesmo orçamento; ligar o novo e pausar o antigo **no mesmo momento** (~R$ 26/dia).
8. Não testar com número da equipe (WA-12); em 24–48 h rodar H3 e ver o ID novo.

## Para Viabilidade (fecha a mesa)
6/15 conversas pagas sem cliente com ID (clique sem ID, cliente existente, contagem Meta?) — cliente existente entra na WA-18?; Fluxo TESTE dispara com o pré-preenchido novo?; gravar no histórico da transferência "on-line" × "fila"; gasto por hora (Fase 3). Dono: categoria especial e "sim" em H1–H5.
