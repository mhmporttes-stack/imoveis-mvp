---
name: auditar-trafego
description: Auditoria e monitoramento SOMENTE LEITURA das campanhas Meta da imobiliária, cruzando investimento com a evolução real do lead no CRM (campanha/conjunto/anúncio → cliente → atendimento → simulação → documentação → aprovação → reunião → venda). Use para "como estão minhas campanhas", "onde estou desperdiçando dinheiro", "qual anúncio traz cliente bom", "CPL/CPM/CTR/frequência", "auditar tráfego", "relatório de tráfego", baseline de custos. Nunca altera nada na Meta; ações saem como recomendações para aprovação.
---

# Auditar tráfego (auditoria + monitoramento + funil CRM)

Conceitos de `ad-audit` e `ad-watchdog` (Meta Ads Stack) adaptados: diagnóstico e monitoramento **só leitura**, propostas ranqueadas que **nunca são executadas** por aqui. O diferencial é medir a campanha pelo que o lead **vira no CRM**, não só pelo custo por lead da Meta.

Política de segurança: a do agente `gestor-trafego` (só `SELECT`, toda ação é recomendação, sem dado pessoal no relatório).

## Fontes (todas no Supabase, projeto `tshhasbbchjcvhoyizoo`)

- `meta_ad_accounts`, `meta_ad_entities` (campanha/conjunto/anúncio, `targeting` dos conjuntos), `meta_ad_insights` (1 linha por entidade × dia, nível próprio), `meta_ad_sync_state`. Sincronização = cron `meta-ads-*` (só leitura).
- CRM: `client_origins` (origem imutável; `source_metadata` com `ad_id`/`adset_id`/`campaign_id` do anúncio de WhatsApp, ou `utm_*`), `simulation_registrations` (status atual), `client_status_history` (histórico), `financial_sales` (venda).

## Passo a passo

1. **Estado dos dados** — consulta **Q0** de `references/consultas-funil.md` (período disponível, última sincronização, carga do histórico). Período curto ou sincronização falhando = diga isso no topo do relatório.
2. **Escopo** — período pedido (padrão: últimos 30 dias, comparado com os 30 anteriores quando houver dado) e nível (campanha → conjunto → anúncio).
3. **Desempenho Meta** — **Q1** (investimento, impressões, alcance, frequência, CPM, CTR, CPC, leads da Meta, custo por lead Meta). Métricas não aditivas (CPM, CTR, CPC, frequência) sempre **recalculadas a partir das somas**, nunca somadas.
4. **Funil CRM por anúncio** — **Q2** (o diferencial): clientes atribuídos e quantos alcançaram cada etapa, com custo por etapa. Leia a seção "Como interpretar a atribuição" de `references/regras-decisao.md` antes de comparar leads da Meta com clientes do CRM.
5. **Tendência** — **Q3** (semana a semana: queda de CTR, alta de CPM, frequência subindo).
6. **Auditoria de configuração** — **Q4** (segmentação dos conjuntos: Marília/SP, raio, tipo de localização, expansão automática de público, idade/interesses) e **Q5** (o que a Meta conta como resultado, `actions_raw`). Checklist em `references/regras-decisao.md` §Auditoria.
7. **Baseline e decisão** — aplique `references/regras-decisao.md` (baseline do histórico próprio, gasto mínimo antes de julgar, regras de pausa/escala/renovação). Sem metas definidas pelo dono, compare **só com o baseline**.
8. **Relatório** — formato do agente `gestor-trafego`: resumo, números, recomendações numeradas (cada uma marcada "requer sua aprovação"), limitações.

## Regras

- **Nunca** execute nem sugira executar escrita via API/MCP. Toda ação vira proposta para o dono aplicar no Gerenciador.
- Consulta nova que não está em `consultas-funil.md`: só `SELECT`, e se for útil para outras análises, proponha incluí-la na referência (não inclua sozinho sem dizer).
- Achado que depende de código (rastreamento faltando, campo não sincronizado): registre como "lacuna de dados" e indique o `crm-editor`.
- Categoria especial (moradia/crédito) e segmentações permitidas: **A CONFIRMAR** — não recomende mudar idade/gênero/raio por suposição.
