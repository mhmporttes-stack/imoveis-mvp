# Regras de decisão do Gestor de Tráfego

**Proveniência:** heurísticas iniciais do Gestor (conceitos de `ad-watchdog`/`ad-optimizer` do Meta Ads Stack, adaptados a baixo volume e ao funil do CRM). **Não são regra oficial de negócio.** O dono decidiu (2026-10-01) **não** fixar CPL/custo-alvo agora: primeiro se constrói o **baseline do histórico real**; metas oficiais virão depois, via `/registrar-regra`, e passam a valer no lugar do baseline.

## 1. Baseline (enquanto não houver meta oficial)

- Calcule por **canal** (não misture): *WhatsApp* (anúncio de clique para WhatsApp — atribuição por `ad_id`), *site/simulação* (UTM paga), *outros objetivos* (tráfego, reconhecimento, perfil).
- Para cada canal, nos **últimos 30 dias** (decisão do dono, 2026-10-01: o histórico antigo da conta — 2023, impulsionamentos e anúncios fora da estratégia atual — não é relevante e não deve entrar no baseline; não pedir backfill): custo por cliente CRM, por simulação, por documentação, por aprovação enviada, por venda; taxas de passagem entre etapas; CPM, CTR, CPC médios ponderados.
- Use **total gasto ÷ total de eventos** do período (média ponderada), não média de médias.
- Sempre informe o tamanho da amostra. Com menos de ~10 eventos numa etapa, o custo dela é **indicativo**, não base de decisão.
- Registre o baseline calculado no relatório (período + números) para comparação na próxima auditoria.

## 2. Volume baixo: quando dá para julgar

A regra clássica de "50 eventos por semana por conjunto" é inalcançável com o investimento atual (dezenas de reais por dia). Adaptação:

- **Não julgue** (ação = *manter/observar*) entidade com menos de **7 dias ativos** OU gasto menor que **3× o custo por cliente CRM do baseline do canal**.
- Julgue sobre **janelas acumuladas** (14–30 dias), nunca sobre um dia.
- Sem eventos suficientes, a recomendação estrutural é **consolidar** (menos conjuntos/anúncios por campanha), não multiplicar testes.

## 3. Tabela de decisão (só depois de passar o §2)

Avalie de cima para baixo; a primeira linha que bate define a proposta.

| Sinal | Proposta | Prioridade |
|---|---|---|
| Gasto ≥ 3× custo-cliente do baseline e **0 cliente no CRM** (com rastreamento confirmado) | pausar | alta |
| Custo por simulação ≥ 50% pior que o baseline do canal, com amostra suficiente | pausar ou trocar criativo | alta |
| Custo por simulação ≤ 50% do baseline, frequência < 2,5, CTR estável | escalar (duplicar, +20%) | alta |
| Custo por cliente bom, mas taxa cliente → simulação muito abaixo do canal | revisar qualidade do público/promessa do anúncio (lead fraco) | média |
| Frequência > 3,0 (público frio, 7 dias) | renovar criativo | média |
| Frequência > 3,5 | renovar ou pausar | alta |
| CTR caiu > 30% semana a semana (Q3) | renovar criativo | média |
| CPM subiu > 25% semana a semana sem mudança de orçamento | revisar público/sobreposição | média |
| Dentro de ±10% do baseline | manter | baixa |

Funil antes da Meta: decisão olha **custo por simulação** (ou etapa mais funda com amostra suficiente), não o custo por lead da Meta.

## 4. Princípios de execução (o dono executa; o Gestor só recomenda)

- **Escalar = duplicar** o conjunto/anúncio vencedor e subir **no máximo +20%** do orçamento na cópia; nunca editar o vencedor.
- O que **reinicia o aprendizado** (evitar em campanha que está indo bem): aumento de orçamento > 20%; adicionar criativo no conjunto; editar texto/título de anúncio ativo; mudar público/segmentação; mudar estratégia de lance; mudar evento de otimização (grave). Pausa curta (horas) = impacto mínimo.
- Mudanças só em horário comercial (Marília), uma de cada vez, com 7 dias sem mexer depois do lançamento salvo emergência (pixel quebrado, anúncio reprovado).

## 5. Como interpretar a atribuição (ler antes de comparar Meta × CRM)

- **Leads da Meta ≠ clientes do CRM, e é esperado.** O pixel dispara `Lead` em **todo** formulário do site (inclusive links pessoais de corretor e acessos diretos) e a Meta atribui com janela de 7 dias de clique / 1 dia de visualização. O CRM só atribui ao anúncio quando a UTM paga (ou o `ad_id` do WhatsApp) chega no cadastro — atribuição **conservadora, último clique**. Ex. real (set/2026): campanha com 82 leads na Meta e 18 clientes atribuídos no CRM.
- Use a Meta para **eficiência de mídia** (CPM, CTR, CPC, custo por lead Meta) e o CRM para **qualidade e resultado** (custo por simulação/documentação/aprovação/venda).
- **WhatsApp:** `leads_meta = 0` é normal — o resultado é "conversa iniciada" (Q5). Avalie pelo CRM (Q2).
- Cliente que já existia no CRM e conversou por anúncio só tem a conversa vinculada; a origem original é preservada — não entra na contagem do anúncio.
- Formulário instantâneo da Meta (lead ads nativos): **não entra no CRM** hoje — campanha desse tipo terá CRM = 0 por lacuna, não por desempenho. Indique como lacuna de dados.
- Venda e aprovação demoram semanas: analise coortes **antigas** para etapas finais; não condene campanha nova por "0 venda".

## 6. Checklist de auditoria de configuração (Q4/Q5)

- Geografia: conjunto mirando **Marília/SP e região de atuação**; alertar `countries: ["BR"]` (Brasil inteiro), cidades/bairros fora de SP (ex.: homônimos de outro estado), raio muito maior que a região de atendimento.
- `location_types`: preferir pessoas que **moram/estiveram** na região; `frequently_in`/`recent` amplia para quem passa por lá — sinalizar, não condenar.
- **Expansão automática** (`advantage_audience = 1`, especialmente com `individual_setting.geo = 1`): pode entregar fora da região — sinalizar para revisão.
- Objetivo × canal: campanha de reconhecimento/perfil/tráfego gastando sem gerar cliente no CRM = candidata a desperdício; objetivo de lead/conversa para captação.
- Rastreamento: anúncio de site **sem** UTM paga no padrão (`utm_medium=paid`, `utm_campaign={{campaign.id}}`, `utm_term={{adset.id}}`, `utm_content={{ad.id}}`) não aparece no funil CRM.
- **Categoria especial (moradia/crédito): A CONFIRMAR.** A sincronização não traz `special_ad_categories`. Conjuntos com idade mínima diferente de 18, interesses detalhados ou gênero restrito são **indício** de que a campanha não está declarada em categoria especial — registrar como indício, sem concluir e sem recomendar segmentação com base nisso.

## 7. Formato das propostas

Cada recomendação: número, ação (pausar | escalar | renovar criativo | revisar público | consolidar | manter | corrigir rastreamento), entidade (nome + ID), motivo com números e período, impacto esperado, risco, e **"requer sua aprovação — executar no Gerenciador de Anúncios"**. Ordem: prioridade alta → baixa, maior gasto primeiro.
