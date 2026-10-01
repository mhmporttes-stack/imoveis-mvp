---
name: design-crm
description: Crítica, redesenho e limpeza visual de telas do CRM (painel admin, dashboards, listas/tabelas, chat, funil, ranking, Meta Diária, formulários, modais, mobile/PWA) com o sistema visual do projeto, padrões de CRM e revisão visual por screenshot na vitrine de desenvolvimento. Use para "critica essa tela", "redesenha", "melhora o layout/mobile", "está poluído", "padroniza", "revisão visual", ou antes de qualquer mudança de interface relevante.
---

# Design do CRM

Base: Interface Design (Dammyjay93) e Frontend Design (Anthropic), adaptados a um CRM imobiliário denso, mobile-first e com identidade azul/branco. Princípio central: **decidir, não usar o padrão.** Interface "correta" (alinha, não quebra) ainda não é interface **feita com intenção**.

## Antes de tudo (todo modo)

1. **Intenção** — responda por escrito, em 3 linhas: quem usa (perfil e contexto real: corretor no celular, dono no desktop…), qual a tarefa principal na tela, o que a pessoa precisa sentir/decidir em 5 segundos.
2. **Ponto focal** — a única coisa que precisa ganhar a tela. Se tudo compete, nada lidera.
3. Leia `references/sistema-visual.md` (tokens, escalas e decisões já tomadas — o que está ratificado ali não é defeito).
4. Leia o componente e a página reais; confirme perfis (`AdminMenu`, guards) e o que cada um vê.

## Modo 1 — Criticar (somente leitura)

1. **Veja o todo primeiro.** Abra a tela na vitrine e capture screenshots (procedimento em `references/revisao-visual.md`). Sem vitrine para a tela, leia a marcação e diga que a crítica é sem render. Pergunte: algo lidera? A tela respira de forma desigual ou é um grid monótono de caixas iguais? Parece *este* produto ou qualquer dashboard? No teste de "apertar os olhos", a hierarquia sobrevive?
2. **Lentes, uma de cada vez** (A hierarquia · B tipografia e cor · C superfícies e profundidade · D composição e ritmo · E estados, acabamento e movimento · F estrutura, reuso e conteúdo) — detalhe em `references/revisao-visual.md`.
3. **Padrões de CRM** — compare com `references/padroes-crm.md` (lista, chat, funil, métricas, formulários, modais, navegação mobile).
4. **Gravidade e filtro** — bloqueador / deve corrigir / nota. Corte o que for gosto pessoal: se não dá para dizer *quanto custa ao usuário*, não é achado. Poucos achados de alta convicção > 40 detalhes.
5. **Entrega** — para cada achado: o que ficou no padrão, por que custa, a decisão que resolve. Depois a proposta (wireframes ASCII desktop ≥1280 e mobile 390) e a seção "Além do pedido". Veredito contra a barra de aprovação.

## Modo 2 — Redesenhar / implementar

1. **Plano antes do código (duas passadas).** Passada 1: intenção, ponto focal, wireframe ASCII desktop e mobile, tokens e componentes que vai usar (do sistema; token novo só com motivo). Passada 2: revise o plano contra a intenção — ele resolve o problema? É genérico ("kit de cards SaaS")? Tem um único lugar de ousadia? Remova um acessório.
2. **Estrutural → aprovação do dono** antes de codar (navegação, reorganização da tela, padrão novo que se espalha). Local → siga.
3. **Implemente só interface.** "Use o que existe": HTML nativo (`<button>`, `<dialog>`, `<details>`, `<select>`) → componente do projeto → token → só então algo novo. Mantenha estados e efeitos do componente; mudança de dado/API vai para o `crm-editor`.
4. **Estados obrigatórios**: carregando, vazio, erro, sucesso/feedback, desabilitado, foco visível — e textos de interface (ver `references/padroes-crm.md` §Texto).
5. **Verifique**: `pnpm build`, revisão visual na vitrine (larguras e estados de `references/revisao-visual.md`), checklist de acessibilidade. Corrija e recapture até passar a barra.
6. **Registre**: padrão ou token novo → atualize `references/sistema-visual.md` (tabela de decisões). Tela nova na vitrine se a tela não tinha.

## Modo 3 — Limpar (rápido, sem mudar comportamento)

Tira os sinais de interface genérica de um trecho: hierarquia plana, layout monótono, cor tímida ou espalhada, bordas fazendo o papel de espaço, tamanhos arbitrários (`text-[11px]`, `rounded-[28px]`), cores cruas de status em vez das semânticas, estados ausentes, `<div onClick>`, `transition-all`, áreas de toque < 44px. Fique no trecho pedido; o que virar redesenho, anote e mande para o Modo 2. Não "limpe" decisão ratificada no sistema visual nem escolha ousada com motivo.

Entrega: tabela Antes → Depois agrupada por categoria (composição primeiro), arquivo citado, e 1–2 linhas de resumo.

## Barra de aprovação (resumo)

Ponto focal claro · hierarquia por tamanho + peso + cor · cor contida e com significado · uma estratégia de profundidade · ritmo (densidade varia por zona) · todos os estados · reusa o sistema e primitivas acessíveis · mobile real (360–390px sem rolagem horizontal, alvo de 44px) · nada que pareça gerado por IA. Qualquer bloqueador → não aprovado.
