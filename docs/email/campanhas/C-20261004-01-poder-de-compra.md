# C-20261004-01 — "Descubra seu poder de compra" (prospecção, 1º imóvel)

Status: **peça pronta, aguardando aprovação do dono** · Nenhum envio, provedor ou domínio configurado · Skills usadas: `/planejar-campanha-email` + `/criar-email` · 2026-10-04.
Peça: `templates/poder-de-compra-v1.html` (+ `.txt`) · Prévias: `previews/poder-de-compra-v1-{mobile-375,desktop-600}.png`.

## 0. Fato do site que molda a promessa [VERIFICADO no código, 2026-10-04]
O formulário `/simulacao` **não devolve um resultado na hora**: ele registra o cadastro e a tela final diz que os dados serão analisados por correspondente credenciada da Caixa, que depois entra em contato (`components/simulation-form/SimulationSuccess.jsx`). Por isso a copy promete **"receba uma análise do seu perfil"**, nunca "veja agora" nem um prazo em minutos. O formulário pede nome, celular, nascimento, renda etc.; **não pede e-mail**. Prazo de retorno e nº exato de perguntas: **A CONFIRMAR** com o dono antes de citar na copy.

## 1. Proposta
Uma ideia: *seu poder de compra, descoberto com ajuda de quem entende de primeiro imóvel*. Não vende imóvel; vende o próximo passo (a simulação). Promessa honesta: faixa de imóvel, possibilidades de financiamento e benefícios (MCMV) **conforme renda e análise de crédito**. Pessoa: Matheus Machado, corretor (CRECI 323106) — humano e local.

## 2. Público e segmentação
Quem entra (todos com **origem legítima e rastreável**; base legal LGPD **A CONFIRMAR com advogado** antes do 1º envio em massa; política do site já cita contato por WhatsApp ou e-mail, o que ajuda mas não substitui o parecer):
| Segmento | Quem | Observação |
|---|---|---|
| **S1 — Contatos próprios sem simulação** | Pessoas que deram e-mail ao site/CRM/captação e nunca simularam | Prioridade: relação existente, melhor entregabilidade |
| **S2 — Contatos da Prospecção com e-mail e origem declarada** | `prospecting_contacts`, se houver e-mail e origem documentada | Existência do campo e consentimento: **A CONFIRMAR** (`analista-dados`) |
| **S3 — Lista nova (formulário/isca no site)** | Captada com consentimento explícito | Só depois de existir o formulário (→ `crm-editor`) |
**Excluir sempre:** `do_not_contact`, descadastrados, bounce duro, reclamação, clientes já em atendimento/documentação/venda, quem já simulou (vão para outra mensagem), e-mail genérico (`contato@`, `info@`). Região: foco Marília/SP e região (campo de cidade no cadastro: **A CONFIRMAR**). Tamanho de cada segmento: pedir à Central — **não estimado aqui**. Não contatar a mesma pessoa por e-mail e WhatsApp no mesmo dia (alinhar com `diretor-atendimento`).

## 3. Estrutura da mensagem (1 ideia · 1 CTA)
Marca (símbolo + nome) → eyebrow "Primeiro imóvel em Marília" → **headline** → apoio (sem compromisso) → **botão** → "Em poucos passos, você entende" (3 itens) → assinatura + confiança → rodapé legal. Tudo cabe em ~1,5 tela de celular.

## 4. Textos aprovados para revisão
- **Assunto A (base):** `Quanto você consegue financiar no 1º imóvel?` (45)
- **Assunto B:** `Seu poder de compra para o primeiro imóvel` (42)
- Reserva C: `Primeiro imóvel em Marília: por onde começar?` (45)
- **Preheader:** `Responda algumas perguntas e receba uma análise do seu perfil. Sem compromisso.` (78)
- **Headline:** Descubra seu poder de compra para o primeiro imóvel
- **Apoio:** Responda algumas perguntas e receba uma análise do seu perfil. Sem compromisso.
- **Corpo:** Em poucos passos, você entende: 1) Que faixa de imóvel cabe no seu perfil · 2) Quais as possibilidades de financiamento para você · 3) Se há benefícios, como o subsídio do Minha Casa Minha Vida, conforme sua renda.
- **CTA:** **Descobrir meu poder de compra**
- **Assinatura:** Matheus Machado — Especialista na compra do primeiro imóvel · Marília/SP. "Seus dados são analisados por correspondente credenciada da Caixa. Condições sujeitas a análise de crédito e à sua renda." *(frase de correspondente: vem da tela final do site; dono confirma que pode ser usada em e-mail.)*
- **Rodapé:** motivo do recebimento (`{{motivo_recebimento}}`, texto exato depende da origem de cada segmento — advogado), CRECI, descadastro, política de privacidade, ver no navegador.
Sem número de subsídio/parcela/prazo; sem urgência; sem "aprovação"; sem nome do cliente.

## 5. Conceito visual
Premium e limpo: faixa **marinho `#031D3A`** com símbolo "M" (azul `#3673C2` + cinza-claro) e nome em texto (legível mesmo com imagens bloqueadas), headline branca grande, **botão azul `#3673C2`** com texto branco (4,79:1, AA), corpo branco com 3 números azuis e muito respiro, rodapé cinza `#EFEFEF`. Sem foto genérica, sem cards, sem carrossel, sem ícones decorativos: a hierarquia vem de tipografia e espaço. Uma única imagem (símbolo, <20 KB). Paleta âncora da logo (`marca-email.md`).

## 6. Versão mobile
Mobile first: largura fluida até 600 px, fonte base 16 px, headline 28/34, botão em **largura total** (altura ≥ 54 px) no celular e autônomo no desktop, margens de 20 px. A primeira tela do celular mostra marca + headline + apoio + botão (CTA acima da dobra). Prévias renderizadas a 375 e 760 px em Chromium: `previews/`. **Cliente real (Gmail/Outlook/Apple) não testado** — exige envio de teste aprovado pelo dono; Outlook desktop usa botão VML (não validado).

## 7. Versão texto simples
`templates/poder-de-compra-v1.txt` (mesmo conteúdo, link por extenso, descadastro).

## 8. Template
`templates/poder-de-compra-v1.html`: 8,8 KB (limite Gmail 102 KB), tabelas + CSS inline, `lang=pt-BR`, preheader oculto, VML p/ Outlook, `lint-email.mjs` = OK (0 erros, 0 avisos). MJML **não** produzido: compilar exige instalar `mjml`; HTML manual é mais simples para 1 peça. Placeholders (provedor ainda não escolhido): `{{variante|a}}`, `{{segmento|geral}}`, `{{motivo_recebimento|…}}`, `{{unsubscribe_url}}`, `{{view_in_browser_url}}` — o provedor/CRM os preenche.

## 9. Link e rastreamento
**Link identificado no código (não inventado):** `https://www.matheusmachadoimoveis.com.br/simulacao?jornada=simulacao` — `?jornada=simulacao` abre direto o formulário completo, pulando a tela "Atendimento rápido × Simulação" (`LinkJourneyGate.jsx`; já usado nos Fluxos do WhatsApp). Para o "atendimento rápido" use `/simulacao` puro.
```
…/simulacao?jornada=simulacao&utm_source=email&utm_medium=email
  &utm_campaign=poder-de-compra-2026-10&utm_content={a|b}&utm_term={s1|s2|s3}
```
`utm_content` = variante do assunto; `utm_term` = segmento. Gravados pelo site em `source_metadata` (SimulationForm lê `utm_*`); `utm_medium=email` não é mídia paga (`lib/lead-origin.js`). Não usar dado pessoal na URL.
**Decisão do dono (opcional):** criar no Gerador de Links uma campanha "E-mail — poder de compra" e acrescentar `&c=<id>`: conta aberturas (`campaign_link_views`), rotula a origem como campanha e define se o lead vai para a **roleta** ou para você. Sem `?c=`/`?ref=` o destino é o padrão do site. (É escrita no CRM em produção → só com seu "sim".)

## 10. Eventos a medir no CRM (especificação futura → `crm-editor`)
| Evento | Origem | Hoje |
|---|---|---|
| enviado, entregue, bounce (duro/suave), reclamação, descadastro | provedor/webhook → tabela de eventos de e-mail | **não existe** |
| clique (único, filtrando robôs de segurança) | provedor | não existe |
| visita à `/simulacao` com `utm_source=email` | site | não registrada (`track-view` só conta `?c=`/`?ref=`) |
| **simulação concluída** (cadastro novo) | `simulation_registrations` + `client_origins.source_metadata` (UTMs) | **existe** — é o evento-âncora |
| simulação repetida de cliente existente | `recordCampaignDuplicateSubmission` (só com `?c=`) | parcial |
| em atendimento → documentação → venda | `lib/client-status.js` (funil) | existe; atribuir por origem |
| supressão (descadastro/bounce/`do_not_contact`) | checagem no servidor antes de cada envio | **não existe** |
Abertura = indicador fraco (proteção de privacidade da Apple); não decide nada. KPIs: proteção (bounce, reclamação, descadastro) → cliques → **simulações concluídas por 1.000 entregues** → atendimentos → clientes. Definições: `docs/METRICAS_FUNIL.md`.

## 11. Teste A/B útil (um só, no 1º lote)
- **Hipótese:** a pergunta concreta ("Quanto você consegue financiar…?") gera mais cliques do que o benefício genérico ("Seu poder de compra…"), porque aponta uma dúvida real do comprador de 1º imóvel.
- **Variável única:** só o **assunto** (A × B); preheader, corpo e CTA idênticos. Divisão aleatória 50/50 dentro do mesmo segmento, mesmo dia/hora.
- **Métrica de decisão:** cliques únicos ÷ entregues (apoio: simulações concluídas). Abertura não decide.
- **Tamanho:** o que o volume permite detectar (poder 80%, 5%): de 3% para 6% de clique ≈ **750 por grupo**; de 3% para 4,5% ≈ **2.500 por grupo**. Se S1 tiver menos de ~1.500 contatos: **não declare vencedor por 1 teste**; rode A e B em ondas alternadas e junte as ondas, ou escolha o A e siga.
- **Decisão antes de olhar:** vence quem tiver mais cliques com diferença acima do ruído e sem pior descadastro/reclamação; empate → A (mais simples). Janela: 72 h.
- **Não testar** cor/forma do botão nem emoji agora (efeito pequeno, amostra insuficiente). Teste 2 (depois): ângulo "aluguel × parcela" × "poder de compra", exige segmento de quem aluga.

## 12. Pré-requisitos antes do 1º envio (nada feito)
Decisões do dono: provedor e **subdomínio remetente dedicado**; base legal e texto do motivo de recebimento (advogado); origem da lista S1/S2; limite de contatos por pessoa; se usa `?c=`. Código (→ `crm-editor`, com Especificação deste doc): descadastro 1-clique + `List-Unsubscribe`, supressão, eventos, coleta de e-mail. Depois: `/auditar-entregabilidade` (go/no-go), envio de teste **só para endereços do dono**, lote pequeno com rampa, e `/analisar-campanha-email`.
