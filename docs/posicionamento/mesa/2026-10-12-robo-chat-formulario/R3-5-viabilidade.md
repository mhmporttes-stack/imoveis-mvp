# Rodada 3 — Cadeira Viabilidade no CRM (V15 — fecha a mesa)

Só leitura; sem Supabase nesta sessão (consultas prontas, não executadas). O pacote final está em `DOSSIE.md` e `guia-entrada-lead-anuncio.json`.

## Objeções à V10
1. Sem `notifyStaff`: aceito — o desvio é em `afterRelease` (`lib/whatsapp-sponsored-lead.js:552-554`).
2. "Devolver para a roleta" (`returnClientToRoulette`, `lib/lead-distribution.js:327-399`): só admin/gestor; dono fica fora do sorteio; grava `auto_transferred` com `manualReturnToRoulette: true` → SQL de giros precisa de `and coalesce(h.details->>'manualReturnToRoulette','false')<>'true'`.
3. Métrica "silêncio tocado": aceito. 4. Domingo sem exceção: aceito.

## Código conferido
**b1. 6/15 conversas pagas sem cliente com ID — caminhos:**
- Clique sem `referral`: pré-preenchido só dispara Fluxo (`lib/whatsapp-flows.js:752`), não grava origem nem segura (`lib/whatsapp-referral.mjs:70-73`) → "Contato direto" direto na roleta (`routeOrganicLead`, L251-262); recebe só o lembrete único (`isAdConversation`, `whatsapp-form-reminder-core.mjs:44-45`).
- Telefone já cliente: vinculado ao cadastro mais recente (`whatsapp-master.js:583`); `routeOrganicLead` pula; `releaseAdWaitingClientOnReply` "nao_aguardando"; a função do banco só vincula (`20260928180000_whatsapp_individual_direct_broker.sql`, `already_existed`) → **não entra na WA-18**; responsável mantido; sem aviso de anúncio.
- **Ex-cliente arquivado:** `whatsapp_chat_apply_inbound` (`20261009160000_whatsapp_private_conversations.sql:28-42`) esconde a conversa (WA-13); Fluxo manda A1; lembretes pulam arquivado (L169); resposta não é vista; só volta se preencher → **lead perdido**.
- Conversa antiga no Oficial: origem só gravada se vazia (L39-42) → ID novo perdido.
- Outros: número da equipe (WA-12), Particular/excluído, contagem Meta (fuso LA).
```sql
with ev as (select distinct on (e.sender_phone) e.sender_phone, e.event_at, e.message_text, e.related_client_id,
  e.raw_payload->'message'->'referral'->>'source_id' ad_id
  from whatsapp_master_events e where e.event_type='message' and e.direction='inbound'
  and e.event_at>='2026-10-09T07:00:00Z' and e.event_at<'2026-10-12T07:00:00Z' order by e.sender_phone, e.event_at)
select count(*) filter (where ad_id='52550704071153') com_id,
  count(*) filter (where ad_id is null and lower(message_text) ~ '(vi o an[uú]ncio e quero|posso (ter|saber) mais informa)') prefill_sem_id,
  count(*) filter (where ad_id='52550704071153' and r.created_at<ev.event_at) com_id_ja_era_cliente,
  count(*) filter (where ad_id='52550704071153' and r.status='archived') com_id_arquivado
from ev left join simulation_registrations r on r.id=ev.related_client_id;
```
**b2. TESTE × pré-preenchido:** os dois textos já são reconhecidos (`whatsapp-referral.mjs:74-78`) → trocar não é necessário. Palavra-chave (prioridade 0) ganha de anúncio (1) (`whatsapp-flow-core.mjs:309`); empate → mais antigo; palavra-chave casa por pedaço (`message.includes`, L286-293) → se algum Fluxo ativo de palavra-chave tiver "simula/financ/anunc", passa a responder todo clique com o texto novo.
```sql
select id, name, status, created_at, published_trigger from whatsapp_flows where status='active' order by created_at;
```
**b3. On-line × fila:** `afterRelease` já grava `waitingForBroker`/`presenceTier` (L530-536); fila grava `fromWaitingQueue` (`reassignPendingRouletteLeads`). Spec: `details.via='anuncio_silencio'`, `deliveryMode`, `transferDueAt`. **Bug que nasceria:** rótulo `via==="form" ? … : "anuncio_resposta"` e aviso "respondeu no WhatsApp" (L516, L533, L540) → 3º caso obrigatório; `deliveredByQueue` (L510) hoje sem histórico.
**b4. Alerta "+3 dias":** em 5 lugares (`lib/client-status.js` L371-381, L397-407; `lib/simulation-list-query.js` L378, L518, L605; `lib/performance-overview.js:1243`; `components/clients/client-format.js:66`) → M, risco de divergência → Fase 3.
**Extras:** trava Não contactar **já feita** (`489091b`, 12/10); `linkLookbackMs` (`lib/whatsapp-form-reminder.js:54`) sem efeito com o corte de 23 h.

## Questionamentos à V14
1. H2 "é por ele que o Fluxo reconhece": falso → pré-preenchido só se b2 não achar conflito; se achar, fica o padrão da Meta (TESTE fica, decisão 1).
2. H4 pausar/escalar no D+28 com base n=5 e 3 mudanças juntas → D+28 só descritivo; único gatilho: Não contactar acima da meta; nada muda no anúncio até lá.
3. Alerta "+3 dias" → Fase 3.
4. H3 só com `anuncio_aguardando_resposta` → incluir `via='anuncio_mensagem'` e usar b1 como guarda Meta × CRM.

## Procedimento de gravação do Guia (decisão 13)
1. Ler `attendance_guides` (`kind in ('lead','library')`), identificar "Lead — patrocinado" e `<GUIA_OBJECOES_ID>`; `<CARD_RECEPCAO_ID>` = `to` da aresta `from:"start", port:"next"`.
2. Parar se `version ≠ published_version`, se já existe `la-*`, se não achar a recepção ou se faltar algum `obj-*` publicado.
3. Backup da linha em `backup-guia-lead-v<versao>.json` (sem dado pessoal).
4. Converter em `scratch/`: copiar `published_graph`, trocar marcadores, 2 respostas no **começo** da recepção, x += maxX+360, y += minY, acrescentar nós/arestas (não rodar `autoArrangeGuide`).
5. `sanitizeGuideGraph`: +17 nós e +34 arestas exatos.
6. `validateGuideGraph(grafo, {libraryNodes})` (chaves `guideId::nodeId`, como `publishedLibraryNodeKeys`, `lib/attendance-guides.js:127-129`): 0 erros.
7. UPDATE único: `graph = published_graph = novo`, `version = published_version = v+1`, `published_at = updated_at = now()`, `updated_by = dono`, `where id = lead and version = v and published_version = v` → 1 linha.
8. Conferir na tela. 9. Desfazer: gravar o backup com `version = v+2`; apagar `scratch/`.
