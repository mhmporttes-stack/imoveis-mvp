---
name: visibilidade-ia
description: GEO/AEO — mede e melhora se ChatGPT, Gemini, Google IA (AI Overviews/AI Mode), Perplexity e similares citam ou recomendam Matheus Machado quando alguém pergunta sobre comprar o primeiro imóvel, MCMV, financiamento Caixa ou corretor em Marília. Use para "as IAs me recomendam?", "como apareço no ChatGPT/Gemini", "como ser citado pela IA".
---

# Visibilidade em IA (GEO/AEO)

Agente: `marketing-posicionamento`. Conceito SAIV (share of AI visibility) e "GEO sem mito": `../auditar-posicionamento/references/metodologia.md`.

## Medir (amostra honesta)
1. **Conjunto fixo de 10–15 perguntas** em `PERFIL.md` (ex.: "melhor corretor para primeiro imóvel em Marília", "como funciona o Minha Casa Minha Vida em Marília", "quem indica corretor de confiança em Marília", "documentos para financiar na Caixa"). Mantenha o mesmo conjunto para comparar no tempo.
2. **Rodar**: você não consegue consultar ChatGPT/Gemini/Google IA de forma confiável sozinho. Opções: (a) o dono cola as respostas (ou usa o Chrome dele com autorização) — **[INFORMADO]**; (b) `WebSearch` para ver se a página/entidade é recuperável — sinal indireto, **não** é SAIV. Nunca declare "o ChatGPT recomenda X" sem a resposta literal e a data.
3. Para cada pergunta registre: plataforma, data, se Matheus foi citado, quem foi citado, **fontes que a IA exibiu** (essas são as portas de entrada reais).
4. SAIV = perguntas com citação ÷ perguntas rodadas, por plataforma. Amostra pequena = indicador de direção, não verdade estatística: diga.

## Melhorar (cada item com evidência da lacuna)
- **Entidade consistente**: mesmo nome, CRECI, cidade, descrição curta em site (JSON-LD `RealEstateAgent` + `sameAs`), GMN, Instagram, Facebook, portais → `/google-perfil-avaliacoes`, `/seo-site`.
- **Conteúdo citável**: página que responde a pergunta no 1º parágrafo (2–3 frases), depois detalhe; títulos em forma de pergunta real; dados com **fonte e data** (faixas e regras do MCMV mudam: nunca fixar valor sem data); FAQ visível. Passagens autônomas de 130–170 palavras são mais fáceis de citar.
- **Fontes que as IAs usam**: o que as respostas exibirem como fonte (Maps, Instagram, portais, imprensa local, YouTube) — priorize estar bem nelas.
- **Acesso de rastreadores**: conferir `robots.txt` não bloqueia rastreadores legítimos de IA que o dono quer permitir; decisão de bloquear/permitir é do dono. `llms.txt`: baixo custo, **sem evidência de efeito** — não vender como solução.
- Avaliações com texto específico ("primeiro imóvel", "financiamento", "Marília") alimentam tanto Maps quanto IA — via pedido ético a todos os clientes.

## Fechar
Grave a tabela de perguntas × plataformas em `HISTORICO.md`; ações em `BACKLOG.md` com reavaliação em 30–45 dias (IA muda devagar e de forma instável).

## Dados reais primeiro (Windsor)
Windsor não mede ChatGPT/Gemini. Use-o só para o efeito indireto: tráfego de origem `chatgpt.com`/`gemini`/`perplexity` e buscas de marca no **Search Console/GA4** (campo de origem real, via `get_fields`); sem dado = **[A CONFIRMAR]**.
