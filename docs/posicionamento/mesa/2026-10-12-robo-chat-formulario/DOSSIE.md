# Dossiê — Mesa de Criação: robô do Chat que leva ao formulário (2026-10-12)

Mesa: Dados do CRM · Atendimento humanizado · WhatsApp e automação · Tráfego pago · Viabilidade no CRM (substituiu Criação/carrossel). 3 rodadas × 5 cadeiras = 15 versões. Brief: `BRIEF.md`. Decisões do dono: `DECISOES-DONO.md` (1–14). Versões: `R1-*`, `R2-*`, `R3-*`.

## 1) Resumo
- A dor original ("não preenche o formulário") não se confirmou como dito: quem responde ao link é atendido por uma pessoa em ~5 min e avança mesmo sem formulário. **A perda real é o silêncio** (6/25), que hoje fica com o dono até alguém transferir à mão (de madrugada, 11–20 h depois).
- O robô passa a falar como "a equipe", com **uma** mensagem no clique, deixando claro que a simulação não pede CPF nem documento e é sem compromisso.
- Fora do horário: **uma** resposta por período fechado (texto ou áudio). Lembretes 1 h / 3 h / 10 h; o que cairia de madrugada vira **uma** mensagem às 8 h.
- Quem fica em silêncio vai **para a roleta 3 h após a 1ª mensagem** (madrugada → 8 h), sem aviso à gestão; o corretor usa a abertura nova do Guia.
- Fase 1 = configurar (Fluxos, Guia, anúncio). Fase 2 = 5 mudanças de código, sem banco. Fase 3 = depende de decisões.

## 2) Versão final (V15)
**Notação:** Fluxos usam `{{saudacao}}` (Bom dia 6–12h, Boa tarde 12–18h, Boa noite) e `{{primeiro_nome}}` (sem nome, "Boa tarde, !" vira "Boa tarde!"). Em código, `[, Nome]` = ", Fulano" ou nada. Botão [Fazer simulação] → `/s` (segurado: genérico). Fora = fora de seg–sáb 8h–19h. Não recebem nada: Não contactar, arquivado, Particular, número da equipe. Voz plural, ≤ 1 emoji, nunca "assistente virtual".

**FH (frase de horário):** "Nosso atendimento é de segunda a sábado, das 8h às 19h; fora desse horário, a equipe responde assim que possível. Se esse horário não der pra você, é só avisar que a gente combina outro."

**Jornada:** clique → A1 → (a) preenche → D → roleta; (b) escreve → horário: pessoa (Guia la-m1); fora: B uma vez por período → roleta; (c) silêncio → 1 h → A1 + 3 h (21h–8h → 8 h; domingo igual): lembrete de 3 h **e** transferência → 10 h só se ninguém da equipe escreveu. Pediu para parar → B12. Outra cidade → H.

**A. Anúncio (Fluxo, 1 envio)**
- A1 horário: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis. Pra montar sua simulação (quanto você pode financiar e o valor da parcela), é só tocar em Fazer simulação, aqui embaixo, e responder umas perguntas rápidas. Não pede CPF nem documento, e é sem compromisso. Assim que você enviar, um especialista da nossa equipe te manda o resultado por aqui. Se preferir, pode mandar sua dúvida aqui mesmo, escrita ou em áudio." + [Fazer simulação]
- A1 fora: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis. Pra montar sua simulação (quanto você pode financiar e o valor da parcela), é só tocar em Fazer simulação, aqui embaixo, e responder umas perguntas rápidas. Não pede CPF nem documento, e é sem compromisso. Assim que você enviar, um especialista da nossa equipe te manda o resultado por aqui." + FH + [Fazer simulação]

**B. Depois do link (código, Fase 2)** — horário: nada automático. Fora: uma vez por período fechado; texto, áudio, imagem, vídeo, documento (não reação, figurinha, toque em botão).
- Não preencheu: "Recebemos sua mensagem[, Nome]! " + FH + " Se quiser adiantar, a simulação não pede CPF e não consulta seu nome:" + [Fazer simulação]
- Já preencheu: "Recebemos sua mensagem[, Nome]! " + FH
- B12 (antes da liberação e da resposta fora do horário): "Tudo bem[, Nome]. Não vamos mais te mandar mensagens. Se um dia quiser conversar, é só chamar aqui." → Não contactar.

**C. Lembretes do anúncio 1 h / 3 h / 10 h** (21h–8h → uma às 8 h; ≥ 2 h entre lembretes)
- 1 h: "[Nome, ]conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio." (sem nome: "Conseguiu…")
- 3 h: "Só lembrando: com a simulação você já fica sabendo quanto pode financiar e a parcela pro seu caso. Não pede CPF e é sem compromisso. É só tocar em Fazer simulação, na primeira mensagem que te mandamos."
- 10 h (só se ninguém da equipe escreveu): "[Nome, ]esse é nosso último lembrete sobre o link da simulação. Se você trabalha sem carteira ou não tem nada guardado, pode fazer do mesmo jeito. Se preferir conversar, é só responder aqui que a nossa equipe te responde." (sem nome: "Esse…")
- 8 h (fixo, substitui etapa pendente): "Bom dia[, Nome]! Passando pra lembrar da simulação que te mandamos: ela mostra quanto você pode financiar e a parcela, sem CPF e sem compromisso. Se ficou alguma dúvida, é só responder aqui, escrita ou em áudio."
- Lembrete único (não anúncio, WA-17; regra 8 h): "Oi[, Nome], tudo bem? Sua simulação ainda está em aberto. Ficou alguma dúvida ou teve dificuldade com o link? Se preferir, a gente te ajuda por aqui."
- **Transferência do silêncio:** A1 + 3 h (21h–8h → 8 h); só se não respondeu, não preencheu, ninguém da equipe escreveu e segue em "Atendimento automático" → roleta (WA-18), sem mensagem ao cliente, sem aviso à gestão; corretor recebe "não respondeu às mensagens automáticas"; só daqui para frente.

**D. Pós-formulário** — horário: "Recebemos seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Agora um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui." / fora: "Recebemos seu cadastro, {{primeiro_nome}}! Obrigado pela confiança. Um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui. " + FH

**E. Sem anúncio (1ª mensagem)** — "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado Imóveis. Como podemos te ajudar?" [Fazer simulação] [Já sou cliente] [Tenho uma dúvida]
- Fazer simulação: "Pra montar sua simulação (quanto você pode financiar e o valor da parcela), é só tocar em Fazer simulação, aqui embaixo. Não pede CPF nem documento, e é sem compromisso. Assim que você enviar, um especialista da nossa equipe te manda o resultado por aqui." (+ FH se fora) + [Fazer simulação]
- Já sou cliente: ação `base_roulette` e depois "Que bom falar com você de novo! Já passamos sua mensagem pra nossa equipe, e quem cuida do seu atendimento te responde por aqui." (+ FH se fora)
- Tenho uma dúvida: "Pode mandar sua dúvida por aqui, escrita ou em áudio, que a nossa equipe te responde." (+ FH se fora) → pessoa. Sem resposta → `stop` (não `finish`).

**F.** Número do corretor sem automação; Fluxo TESTE fica. **G.** Guia (abaixo). **H.** Outra cidade: só pela pessoa, após confirmar que não quer Marília → tag **OUTRA CIDADE** (existente) + "Tentando contato"; nunca arquivar, nunca Não contactar.
Tamanhos: tudo ≤ 1024 (maior: A1 fora ~558); botões ≤ 16 caracteres.

## 3) Guia de Atendimento
Entrada "Lead de anúncio: primeira resposta (texto ou áudio)" no guia "Lead — patrocinado": `guia-entrada-lead-anuncio.json` (17 cards, 34 ligações, formato do banco; marcadores `<GUIA_OBJECOES_ID>` e `<CARD_RECEPCAO_ID>`). Gravação: decisão 13; procedimento em `R3-5` abaixo (ler → parar se rascunho/ids repetidos → backup → converter → `sanitizeGuideGraph` → `validateGuideGraph` com `libraryNodes` → UPDATE único com versão → conferir).

## 4) Especificação
**Fase 1 (configurar):** checar gatilhos dos Fluxos ativos (se algum de palavra-chave contém "simula", "financ" ou "anunc", manter o pré-preenchido padrão da Meta); Fluxo do anúncio A1 com horário seg–sáb 8h–19h em cada bloco (padrão do sistema seg–sex 9–18, `lib/whatsapp-flow-core.mjs:69`); "Formulário concluído" com D; 1ª mensagem com E; testar só na Pré-visualização; gravar o Guia; até a Fase 2, silêncio de anúncio > 3 h → "Devolver para a roleta" (admin/gestor), nunca atribuir à mão; anúncio H1–H5 só com "sim".
**Fase 2 (código, sem migration; 1 commit por item; `auditor-automacoes` antes de publicar; trava Não contactar já feita em `489091b`):**
1. B12 no Oficial — `lib/whatsapp-master.js` entre o Chat (~L606) e o lead patrocinado (~L611); `isClearOptOut` + `clientDoNotContactPatch`; testes; `/registrar-regra` (decisão 3).
2. Formulário encerra sessão viva — `endLiveFlowSession` chamado de `lib/simulation-registrations.js`.
3. Lembretes — `lib/whatsapp-form-reminder-core.mjs`: corte 23 h, 21h–8h → 8 h, 2 h mínimas, textos sem nome, texto fixo 8 h, excluir `after_hours_reply`; testes de borda; `/registrar-regra` (6, 8).
4. Transferência do silêncio — `decideSilenceTransfer`, 3º caso em `reconcileAdWaitingClients`, `afterRelease` com rótulo `anuncio_silencio` (hoje sairia "respondeu"), `deliveryMode` online/fila, sem `notifyStaff`, histórico também em `deliveredByQueue`, data de corte; `/registrar-regra` (10, 12).
5. Resposta fora do horário — `lib/whatsapp-after-hours-core.mjs`; laço após os Fluxos com filtro de mídia; só Oficial; reserva `after-hours:<conversa>:<período>` antes de enviar; `/registrar-regra` (12).
Depois: `pnpm build`, testes, `docs/WHATSAPP.md`, `docs/BUSINESS_RULES.md` WA-17/18, rules, `docs/CHANGELOG_AI.md`, SQL em `docs/analytics/`.
**Fase 3 (com decisão do dono):** ex-cliente **arquivado** que clica no anúncio some do Chat (WA-13) — estender a reentrada por anúncio?; ID do anúncio em conversa antiga (migration); outra cidade: status próprio ou alerta "+3 dias" sem a tag (5 lugares); roteador por assunto; botão nos lembretes; horário na tela; gasto por hora; campo de cidade.

## 5) Tráfego (cada item só com "sim" do dono; ele executa)
H1 anúncio novo pausado, ligado com a Fase 1, **numa campanha com categoria especial "Moradia"** (decisão 14): "Para quem quer sair do aluguel em Marília: chame a gente no WhatsApp, responda umas perguntas rápidas e um especialista da nossa equipe te manda sua simulação, com quanto você pode financiar e o valor da parcela. A simulação não pede CPF nem documento, e é sem compromisso. Equipe Matheus Machado Imóveis." Título "Simule seu financiamento pelo WhatsApp". H2 pré-preenchido "Olá! Vi o anúncio e quero fazer a simulação do meu financiamento." (opcional; só se nenhum Fluxo de palavra-chave conflitar). H3 medição semanal por anúncio (SQL em `R3-4-trafego.md`). H4 D+14 guardas; D+28 leitura descritiva — único gatilho de ação: Não contactar acima da meta. H5 checklist de 8 passos (`R3-4-trafego.md`).

## 6) Painel de métricas
Principal: **silêncio tocado por pessoa em ≤ 1 h** após a transferência (base 1/4; meta proposta ≥ 80 %), separado "on-line" × "fila". Guardas: Não contactar 7 dias ≤ 10 %; avisos à gestão ≤ +1/dia; "Simulação enviada" 7 dias não cai; Meta × CRM. Secundárias: formulário ≤ 24 h ≥ 45 % (base 36 %); sem resposta e sem formulário 24 h ≤ 15 % (base 24 %); giros mediana ≤ 1 (excluir `manualReturnToRoulette`). < 30 casos = descritivo. SQL: `R3-1-dados.md`, `R3-4-trafego.md`.

## 7) Rodadas
| Cadeira | R1 | R2 | R3 |
|---|---|---|---|
| Dados | 41 % preenchem; perda = quem responde com dúvida/áudio | dados derrubam a premissa: todos atendidos em ~5 min; perda = silêncio; corta A2 e roteador | silêncio já transferido à mão (11–20 h de madrugada); sem aviso à gestão; métrica "silêncio tocado"; SQL |
| Humanizado | "especialista"; dentro/fora do horário; sem promessa | plural; "não consulta seu nome"; roteiro M1–M5 | texto fixo 8 h; FH; texto do Guia |
| WhatsApp | limites reais; o que é configuração × código | uma vez por período; ordem do webhook; 8 h numa só | notação real; "Já passamos"; Guia no formato do banco; caracteres |
| Tráfego | A1 ≠ promessa do anúncio | promessa se corrige no anúncio; silêncio → roleta às 3 h | anúncio novo na Fase 1; H1–H5; Meta 15 × CRM 9 |
| Viabilidade | formulário não encerra sessão; áudio não chega ao Fluxo; fases | transferência no caminho único da WA-18; Guia pela tela; outra cidade | rótulo "respondeu" falso; 5 caminhos dos sem-ID; arquivado some; pacote final |

## 8) Decisões
Tomadas: 1–14 (`DECISOES-DONO.md`). **Faltam:** "sim" para Fase 1 e Fase 2; H1–H5; mandar a frase do B12 antes de marcar Não contactar (rec.: sim); transferência só daqui para frente (rec.: sim); ex-cliente arquivado (Fase 3); outra cidade: status próprio ou alerta; metas do painel.

## 9) Próximos passos
1. ~~Gravar o Guia (decisão 13)~~ — **feito em 12/10** (v5 publicada; ver `DECISOES-DONO.md`). 2. Consultas b1/b2 (`R3-5-viabilidade.md`). 3. Dono decide Fase 1/2 e H1–H5. 4. Até a Fase 2: silêncio → "Devolver para a roleta". 5. Fase 2 itens 1–5. 6. D+14 / D+28.

## Arquivos
`BRIEF.md`, `DECISOES-DONO.md`, `R1-1…R1-5`, `R2-1…R2-5`, `R3-1…R3-5`, `guia-entrada-lead-anuncio.json`, este `DOSSIE.md`.
