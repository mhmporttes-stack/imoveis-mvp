## Cadeira 2: Atendimento e WhatsApp, lente humanizada (Rodada 3, final)
Especialistas consultados: nenhum (subagente sem delegação; números da R3-1). Não gravei nada.
Conclusão consolidada: fico com os lotes da V8/V9. Antes de qualquer código, duas ações sem custo: a conversa com as 3 pessoas e descobrir por que não entrou nenhum lote de documentos desde 06/10. No lote C, a tarefa do sistema **não ocupa a vaga de atividade**. Ela vira um "motivo sugerido" no cliente, e isso resolve de uma vez a vaga vencida e a MD-8.

### (a) Respostas às objeções contra a minha R2
1. **Lançar em 3 passos (Apresentação e Dados).** Aceito os 2 lotes. Com n de cerca de 16 por semana, escalonar não deixa a medida legível.
2. **Nome "Enviar pelo Chat".** Aceito "Enviar simulação", com o mesmo fluxo do botão verde, e o T1 vai antes do link como atalho (PRES-22, só o link).
3. **"Mandou por fora?" no card.** Aceito trocar pela linha discreta no painel.
4. **Teto diário.** Retiro. São 0,5 tarefa por pessoa por dia útil.
5. **Vaga única de atividade (Viabilidade).** Aceito: o sistema nunca escreve por cima. Vou além: a tarefa nem usa a vaga (ver b).
6. **Frase de compromisso.** Adoto a da Apresentação, igual em todos os lugares: "Receber a lista e mandar os documentos não te compromete com a compra."

### (b) Regras do lote C, para o dono decidir (uma recomendação por regra)
- **Vaga ocupada por atividade VENCIDA (8 de 11).** Opções: sobrescrever, não criar ou anexar.
  Recomendo: nunca sobrescrever. A atividade vencida já é a cobrança, então o CRM só mostra junto dela o texto sugerido (T6/T7), sem mudar data nem tipo.
- **Tarefa do sistema e a Meta Diária.** Opções: conta como pendência resolvida, não conta, ou não ocupa a vaga.
  Recomendo: a tarefa não ocupa a vaga, vira só um "motivo sugerido" no cliente. Assim ele continua nos Pendentes, e só o contato real do corretor resolve (MD-8 intacta, nada de "feito sem trabalho").
- **Cliente de corretor inativo (8).** Opções: roleta, gestor ou dono.
  Recomendo: a tarefa vai para o gestor do corretor inativo (se não houver gestor, para o dono), que decide se transfere. O sistema nunca transfere cliente sozinho.
- **Cliente do dono (27 de 73).** Opções: o dono recebe, não recebe ou redistribui.
  Recomendo: o dono não recebe tarefa automática (ele já tem mais de 1.000 pendentes por dia). Os 27 entram numa lista semanal para ele decidir quem atende.
- Em todas as regras: o "Não contactar" é absoluto, e a tarefa é humana (nunca mensagem automática) e sai como "sistema" (FUN-15f).

### (c) Roteiro da conversa (individual, cerca de 10 min; o dono conduz com a Caroline, e a Caroline com a Jennyfer e o Gabriel)
1. **Abertura:** "Não é cobrança e não entra em ranking. Alguns links foram abertos pelo cliente e o CRM não viu o envio. Quero entender o seu jeito de mandar."
2. **Ouvir primeiro:** "Como você manda o link hoje? Copia? Por quê?" Anotar o motivo (pressa, hábito, Chat lento, número pessoal).
3. **Mostrar o ganho para a pessoa:** o envio registrado prova o atendimento, protege a carteira dela e não zera o relógio do cliente. Copiar não deixa prova.
4. **Mostrar o caminho:** o botão verde "Enviar simulação" abre o WhatsApp dela só com o link. São os mesmos toques que copiar.
5. **Jennyfer:** "11 dos seus 24 links eram de clientes de outro responsável. Você estava ajudando alguém?" O objetivo é entender o combinado, não corrigir.
6. **Conversa Particular (4 casos):** explicar que, numa conversa Particular sem cliente vinculado, o CRM não enxerga o envio. É só vincular o cliente.
7. **Fechar:** "Se precisar copiar, tudo bem, a partir de agora fica registrado. Daqui a 2 semanas a gente olha junto se ficou mais fácil."

### (d) Decisões da VERSÃO 9 que questiono
1. **"0 lotes desde 06/10" virou motivo para o "Recebi por fora", mas pode ser defeito.** Com 33 clientes em Doc, 13 dias sem nenhum lote é anormal. Antes de lançar o "Recebi por fora", o `crm-editor` precisa conferir (/diagnosticar-bug, só leitura) se o salvar pelo Chat quebrou. Sem isso, o botão esconde a falha e vira uma marca sem documento.
2. **A meta "sem envio em ±1 min abaixo de 5%" mede errado.** Os 4 casos de conversa Particular foram envios de verdade, e o "±1 min" não prova a origem. A meta deve ser "link aberto sem nenhuma prova de envio" e só valer depois de fechada a lacuna da conversa Particular. Senão a conversa da seção (c) vira cobrança por número.
3. **"Recebi por fora" com "Dono? Não".** Ele não pode contar como atendimento (FUN-15f) nem como ponto na Meta Diária. Precisa nascer com essa regra escrita, como o "copiado".
4. **Item 5 com "zero de código".** O T11 depende da frase anti-golpe. Até o dono dizer se a equipe cobra algum valor antes da análise, o T11 sai sem falar de cobrança.

### VERSÃO 10
| # | O que muda | Impacto × esforço | Como medir | Dono? |
|---|---|---|---|---|
| 0 | Já (custo zero): conversa com as 3 pessoas e diagnóstico, só leitura, dos 0 lotes desde 06/10 | Alto × P | 10 dos 13 casos cobertos; causa dos 0 lotes | Não |
| 1 | A: tabela de eventos (migration autorizada antes do deploy) | Alto (habilita) × M | Toque ÷ abertura; % de aberturas da equipe | Autorizar |
| 2 | A: botão único e "Mais {n} telas" calculado | Alto × P | Concluiu ÷ abriu: 32/65; cerca de 140 aberturas | Sim (PRES-12) |
| 3 | A: textos sem "toda", frase de compromisso única, T6 | Alto × P | Pediu lista ÷ concluiu: 14/32, descritivo | Sim (PRES-17, frase) |
| 4 | A: painel "Enviar simulação", copiado registrado, linha "envio não registrado"; lacuna da conversa Particular para o `crm-editor` | Médio/alto × P | Link aberto sem prova de envio, por quem criou | Sim (painel enxuto) |
| 5 | A: atalhos T1–T11 e T13 (T11 sem falar de cobrança) | Médio × zero | Uso; resposta em 24 h | Sim (textos, anti-golpe) |
| 6 | A: "Recebi documentos por fora", depois do diagnóstico do item 0; não conta como atendimento nem como ponto | Alto × P | Doc com 1º documento: 2/33 | Sim (não pontua) |
| 7 | B: aviso de mídia no Chat (só em Doc e sem lote) | Médio × M | Lotes por semana | Não |
| 8 | B: linha 13º "{N}→{X}" e identificação (1º nome e CRECI) | Médio × P/M | Toque na linha; "golpe" no Chat | Sim (PRES-4/12/24) |
| 9 | C: T4/T3/T7 como "motivo sugerido" sem ocupar a vaga; vencida recebe só o texto; inativo vai para o gestor; o dono recebe lista semanal | Alto × M+ | Resposta em 48 h, descritivo | Sim (as 4 regras de b) |
| 10 | C: quem sumiu, D+1/D+3/D+7 úteis (exemplos configuráveis), fechando com T13 e depois a reativação | Médio × M | Retomada; pedidos de "pare" | Sim (prazos) |

Antes do lote C, o `auditor-automacoes` revisa. O "Não contactar" é absoluto. Nada sai sem revisão humana (FUN-15b). Mensagem só de seg–sáb, 8h–19h (exemplo configurável).

### Decisões do dono
PRES-12, PRES-17, a frase de compromisso, o painel enxuto, as 4 regras do lote C, os prazos do item 10, o "Recebi por fora" não pontuar, a frase anti-golpe e a aprovação dos textos abaixo (o Guia só recebe sugestão). O emoji no texto das 10 h (WA-17/18) vai para o `crm-editor`.

## Textos FINAIS (sem emoji; {corretor} = 1º nome; mensagens sempre revisadas pelo corretor antes de sair)
- **T1 (antes do link):** "Oi, {nome}, tudo bem? Aqui é {corretor}, da equipe Matheus Machado Corretor de Imóveis. Recebi o seu cadastro e preparei a sua simulação. Vou te mandar o link aqui." Depois vai só o link. Em seguida: "É uma simulação. Os valores finais dependem da análise da Caixa. Pode mandar dúvida escrita ou em áudio."
- **T2 (não abriu):** "Oi, {nome}, conseguiu abrir a sua simulação? Se o link não abriu aí, me avisa que eu te explico por aqui mesmo."
- **T3 (parou antes do fim):** "{nome}, conseguiu olhar a simulação com calma? O próximo passo é ver quais documentos a Caixa pede no seu caso. Quer que eu te explique?"
- **T4 (concluiu sem pedir lista):** "{nome}, ficou alguma dúvida sobre a parcela ou a entrada? Se quiser, já te mando a lista de documentos do seu caso. Receber a lista e mandar os documentos não te compromete com a compra."
- **T5 (amortização):** "Uma coisa que ajuda muita gente: o financiamento é longo, mas dá para pagar em menos tempo. Quem usa o 13º, ou o FGTS (que pode ser usado a cada 2 anos), para abater a dívida diminui o prazo e os juros pagos. Se quiser, te mostro uma estimativa do seu caso. Ela está na sua apresentação, na parte Estratégia com amortização. É uma estimativa: depende de manter esses valores e das regras da época."
- **T6 (dia combinado):** "Oi, {nome}, tudo bem? Hoje é o dia que você tinha previsto para os documentos. Se já tiver alguns, pode me mandar que eu vou conferindo. Se precisar de mais uns dias, tudo bem, é só me dizer."
- **T7 (2 dias úteis depois, sem avanço):** "{nome}, sei que juntar documento dá trabalho. Qual está mais difícil? Me fala que eu te ajudo a achar."
- **T8 (nome sujo):** "Entendo, {nome}, isso acontece com muita gente. Não consigo te dizer agora se a Caixa aprova; quem decide é ela. O que eu faço é olhar com você o que pode ser resolvido antes e qual o melhor momento de fazer a análise. Posso te explicar?"
- **T9 (renda sem carteira):** "Dá para simular com renda sem carteira, sim. A lista de documentos do seu caso mostra quais comprovantes servem. Te mando?"
- **T10 (medo, vergonha):** "A análise serve justamente para saber o que é possível no seu caso. Receber a lista e mandar os documentos não te compromete com a compra. Se não der agora, eu te falo com sinceridade o que dá para fazer para tentar de novo depois."
- **T11 (desconfiança de golpe):** "Faz muito bem em conferir. Sou {corretor}, da equipe Matheus Machado Corretor de Imóveis, CRECI 323106-F, Av. Ipiranga, 147, Marília. Se preferir, a gente conversa por vídeo ou você vem até aqui antes de mandar qualquer documento." (A frase sobre cobrança só entra quando o dono confirmar a regra.)
- **T13 (encerramento):** "{nome}, não quero te incomodar. Vou deixar a sua simulação guardada; quando for um bom momento, é só me chamar que eu retomo de onde paramos." Depois dele, nenhuma cobrança.
- **Internos (não vão ao cliente):**
  - Aviso de mídia: "Chegou um arquivo de {nome}. É documento do financiamento?" com os botões [Salvar e marcar 1º documento] e [Não é documento].
  - No card: [Recebi documentos por fora].
  - No painel: "Aberto pelo cliente em {data} · envio não registrado".
  - Motivo sugerido: "Parou no Próximo passo · sugestão: T3" e equivalentes.

Arquivos: nenhum gravado. Li só os arquivos em /tmp/claude-0/-home-user-imoveis-mvp/dcd2978e-8bf8-5388-9b95-cb62ddb37c33/scratchpad/mesa-pos/ (BRIEF, R2-2, R2-3, R2-4 e R3-1).