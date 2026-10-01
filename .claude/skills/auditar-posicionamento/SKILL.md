---
name: auditar-posicionamento
description: Auditoria geral do posicionamento digital orgânico de Matheus Machado (Marília/SP) e gravação de um snapshot comparável no histórico. Use para "analise meu posicionamento digital", "como estou no Google", "como apareço quando pesquisam corretor em Marília", "o que mudou desde a última análise". Gera Índice de Presença por área, amostra de consultas-alvo e backlog priorizado. Não trata de mídia paga.
---

# Auditar posicionamento (visão geral + snapshot)

Agente: `marketing-posicionamento`. Metodologia, etiquetas e índice: `references/metodologia.md` (leia primeiro).

## Passo a passo

1. **Contexto** — leia `docs/posicionamento/PERFIL.md`, a última entrada de `HISTORICO.md` e `BACKLOG.md`. Se `PERFIL.md` tiver campos `A CONFIRMAR` que bloqueiam a medição (telefone, link do Google Meu Negócio, @ do Facebook), pergunte ao dono **uma vez**, junto, e siga com o que tem (se não puder perguntar, liste no relatório o que falta e siga).
2. **Site (sempre acessível)** — use `curl` (Bash) para o HTML bruto de `/` e 2–3 páginas-chave, `/robots.txt`, `/sitemap.xml`: título, descrição, canonical, JSON-LD (`ld+json`), Open Graph. O `WebFetch` resume por modelo pequeno e **erra o `<head>`**: use-o só para ler o conteúdo/texto que sustenta "primeiro imóvel/MCMV/Caixa/Marília". Detalhe técnico → `/seo-site`. (WebFetch/WebSearch podem estar deferidos: carregue-os via ToolSearch.)
3. **Consultas-alvo** — para cada consulta de `PERFIL.md`: `WebSearch` (amostra; busca só dos EUA e sem localização de Marília → marque como **amostra de baixa confiança**) e, se o dono autorizar, Chrome dele para ver Maps/Google local de verdade. Registre quem aparece, em que posição, com data.
4. **Google Meu Negócio e avaliações** — `/google-perfil-avaliacoes` (se não houver acesso: peça print do painel de desempenho e da lista de avaliações; nunca estime).
5. **Social** — Instagram `@mhm.machado` e Facebook: perfil público via WebFetch (costuma bloquear) ou print do dono; bio, destaques, últimas 12 publicações → `/conteudo-social`.
6. **NAP e marca** — compare nome, telefone, endereço, CRECI entre site, GMN, Instagram, Facebook, portais encontrados; liste divergências literais.
7. **Concorrentes e IA** — resumo de `/concorrentes-marilia` e `/visibilidade-ia` se já houver snapshot recente (≤30 dias); senão sugira rodá-los.
8. **CRM (opcional)** — se houver Supabase: leads por origem orgânica nos últimos 30/90 dias (só contagens).
9. **Pontue** as 7 áreas; calcule o índice só sobre as áreas medidas; compare com o snapshot anterior.
   **Consulta de marca:** o nome tem homônimos famosos; rode também "Matheus Machado corretor Marília CRECI 323106" e o domínio. Consultas sem localização (WebSearch só EUA) com valor quase nulo (ex.: "casas à venda em Marília") → pule e diga por quê. Concorrentes e homônimos aparecem em `HISTORICO.md` como evidência interna, nunca em material publicável.
10. **Grave** snapshot em `HISTORICO.md` e recomendações em `BACKLOG.md` (máx. 7 ativas, com checagem de falha). Responda no formato do agente.

## Dados reais primeiro (Windsor)
Antes dos passos 2–6, leia `docs/posicionamento/FONTES.md` e rode `get_connectors` (protocolo em `references/windsor.md`). Fonte conectada → use o dado do Windsor como base da nota da área e **[VERIFICADO-WINDSOR]**; os passos de leitura pública (WebSearch/curl/prints) viram complemento e conferência. Fonte não conectada ou com erro → **[A CONFIRMAR]** com o motivo, e a área segue "não medida". Nunca preencher lacuna com estimativa. Auditoria é só leitura: nunca `execute_action`; escrita só quando o dono pedir/aprovar (agente, seção "Alterações externas").
