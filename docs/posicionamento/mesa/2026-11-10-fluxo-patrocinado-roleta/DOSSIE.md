# Dossiê — Mesa: fluxo do patrocinado + roleta com oferta por WhatsApp (2026-11-10)

> Status: **proposta para o dono aprovar**. Nada foi implementado, enviado ou alterado.
> Observação de processo: nesta sessão não havia ferramenta para acionar subagentes; as 5 cadeiras foram conduzidas
> em sequência pelo condutor da mesa, cada uma com a sua lente, apoiadas em código (`lib/whatsapp-flow-core.mjs`,
> `docs/WHATSAPP.md`, `.claude/rules/roleta-prospeccao-campanhas.md`) e em consulta somente leitura ao banco.
> Fatos de política da Meta vêm do conhecimento das cadeiras (docs oficiais de Cloud API/preços); **conferir na página
> oficial de preços antes de implementar** (valores mudam).

## 1. Brief resumido
Cliente de anúncio Click-to-WhatsApp chega ao número OFICIAL → saudação + 3 botões (Localização | Valores | Falar com
um associado) → link da simulação sem pedir nome/telefone → pós-cadastro manda apresentação (Ecovillage, Terras de SP)
→ cutucada e transferência → roleta própria do anúncio (Gabriel, Dienifer, Caroline Mayumi) com oferta ao WhatsApp
particular do corretor ("sim/ok" em 1 min) → regras de resposta tardia, noite, generalização para a roleta geral
(desligada). Janela de 24 h com o corretor mantida por "bom dia" diário.

## 2. Dados reais usados (analista-dados, somente leitura)
- Conversas de anúncio no oficial (`origin.kind = meta_ad`): **57, de 24/09 a 16/10/2026** (nenhuma depois — número
  banido/troca de número). Amostra pequena: tratar como indício.
- **13/57 (23%)** mandaram só a 1ª mensagem e nada mais.
- 1ª resposta humana: horário comercial (8h–18h59, n=37) **mediana 8,9 min, p75 16,3 min, só 11 em ≤5 min**;
  fora dele (n=19) **mediana 55 min, p75 8,5 h**.
- **12/57 (21%) chegaram entre 20h e 7h; 7/57 (12%) no domingo.**
- Leitura: o gargalo real é a demora humana (9 min de dia, horas à noite). O ganho do desenho está em entregar rápido
  a quem está disponível, não em mais mensagens automáticas.

## 3. VERSÃO FINAL ÚNICA DO FLUXO

### 3.1 Entrada (a cada 1ª mensagem do anúncio no oficial)
Filtros antes de tudo (nesta ordem): número da equipe (WA-12) → ignora; `do_not_contact`/bloqueado → nada automático;
cliente **já com responsável ativo** (cadastro existente) → não roda o fluxo: avisa o responsável atual (oferta direta,
sem roleta) e o cliente recebe só a saudação "{Nome}, que bom te ver de novo! Já estou avisando {Nome do corretor}.";
cliente sem responsável/arquivado → fluxo normal (cadastro reaproveitado pelo telefone, nunca duplicado e nunca
UNIQUE por telefone).

**Desliga, para quem entra neste fluxo, o que hoje dispara em paralelo:** sequência WA-18 (1h/3h/10h), resposta fora
do horário WA-31 e entrada na roleta por silêncio de 3 h — o fluxo novo assume esses papéis. O envio automático da
apresentação (SIM-AUTO-ENVIO) é reaproveitado no passo 3.4, não duplicado.

### 3.2 Mensagem 1 — saudação + 3 botões (mensagem interativa de botões)
> {Bom dia|Boa tarde|Boa noite}, {Nome}! Aqui é da equipe Matheus Machado Corretor de Imóveis. 😊
> Que bom que você chamou. Como posso te ajudar?

Botões (máx. 3, até 20 caracteres): **Ver valores** · **Localização** · **Falar com corretor**
- Ordem: Valores primeiro (é o que mais leva à simulação, objetivo do anúncio).
- "minha amiga/meu amigo": **só se o nome estiver numa lista fechada de nomes inequívocos**; qualquer dúvida → só o
  nome; sem nome válido → sem nome. (Já é o tom usado no lembrete de 20 min, SIM-AUTO-ENVIO-b.)
- Saudação pelo horário de São Paulo: até 11:59 / até 17:59 / depois.
- Texto do 3º botão: decisão do dono (ver dúvida 2) — "associado" pode não ser entendido pelo cliente.

### 3.3 Localização
Mensagem interativa **CTA URL com imagem no cabeçalho** (1 botão de link apenas — a Meta não mistura botão de link
com botões de resposta):
> {Empreendimento} fica em {bairro}, Marília. Toque para ver no mapa.
> [imagem] [Abrir no Google Maps]

Em seguida, 2ª mensagem de botões: **Ver valores** · **Falar com corretor**.

### 3.4 Valores
Mensagem CTA URL: "Em 2 minutos você descobre quanto pode financiar e o valor da entrada." [**Descobrir meu valor**]
- Link com token do cadastro: abre direto nas perguntas da simulação; nome do perfil pré-preenchido e **editável**
  (nome do WhatsApp pode ser apelido); sem nome → pede só o nome. Telefone nunca pedido.
- O link registra **abertura** (para a cutucada saber se a pessoa está preenchendo).
- Ao concluir e enquadrar no MCMV: envia o link da apresentação (Ecovillage e Terras de SP sugeridos) pelo mesmo
  mecanismo do SIM-AUTO-ENVIO e **inicia a transferência na hora** (cliente quente). Não enquadrou → mensagem neutra
  ("Recebemos seus dados, um corretor vai falar com você agora.") e transferência. Nunca prometer aprovação.

### 3.5 Cutucada (uma só por cliente) e transferência
- Parado em Mensagem 1 ou Localização: **3 min** → "{Nome}, posso te ajudar com mais alguma informação?" (contextual:
  após Localização, "ficou alguma dúvida sobre a localização?").
- Em Valores: se o link **não foi aberto** em 4 min → cutucada; se **foi aberto**, espera até 10 min sem concluir.
- Sem resposta **2 min** após a cutucada → transferência, marcada "cliente silencioso" para o corretor.
- Atalhos que transferem na hora: "Falar com corretor", texto livre, áudio, foto/documento (não conta: reação,
  clique em botão).
- Na transferência o cliente recebe UMA vez: "Perfeito! Já estou chamando um corretor para falar com você." (de dia)
  ou a mensagem noturna (3.7).

### 3.6 Roleta do anúncio e oferta ao corretor
- Participantes, ordem, liga/desliga: tela admin/gestor (guard `requireBrokerManagementApi`; gestor só a equipe dele).
- Elegível para receber oferta: ativo na lista, **sessão do WhatsApp pessoal conectada** (ROL-2d) e **janela de 24 h
  aberta com o oficial OU template aprovado** (3.8). Presença na imobiliária (ROL-2f) e on-line: **decisão do dono**
  (dúvida 3) — recomendado não exigir à noite.
- Mensagem ao corretor (oficial → particular), com **botões**, não texto livre:
  > 🔔 Cliente do anúncio aguardando: {Nome}, {etapa: preencheu simulação / pediu localização / silencioso}.
  > Você é o próximo da roleta. Pode atender agora?  [**Atender**] [**Agora não**]
  Também aceita texto "sim", "ok", "s", "pode", "bora" e variações (normalizado). "Agora não" = passa na hora.
- **Prazo por corretor: 2 min** (1 min, com o relógio do sistema de 1 em 1 min, vira 1 a 2 min na prática e fura a
  justiça). Volta completa com 3 pessoas: até 6 min.
- Aceite é atômico no banco (só um ganha; o segundo recebe "Esse cliente já foi para {Nome}"). Ao aceitar: cliente
  vira responsabilidade do corretor (histórico de distribuição, ROL-2h), o corretor recebe no particular o nome, o
  telefone e o link do card, e o cliente recebe "{Nome do corretor} vai te chamar agora pelo WhatsApp dele."
- Prazo do corretor após aceitar: **5 min para o 1º contato** com o cliente; sem contato → volta para a roleta do
  anúncio (quem aceitou e não atendeu vai para o fim e conta como "aceite sem atendimento").
- Resposta tardia: mantém a regra do dono (avisa "deixa eu verificar…"; se o da vez não aceita no prazo, vai para o
  tardio; vários tardios → ordem da roleta; depois da volta completa sem dono → 1º tardio a responder).
- Justiça: ignorar ou "Agora não" = perde a vez (vai para o fim); **3 ofertas ignoradas seguidas no dia** → corretor
  sai da roleta do anúncio até ligar de novo, e o dono/gestor é avisado. Placar visível: ofertas, aceites, tempo médio.
- Push e sino continuam; WhatsApp é adicional, pela função única "alerta pelo oficial".

### 3.7 Ninguém aceitou
- **Noite (20:00–07:59) e domingos/feriados:** cliente recebe "{Nome}, nossos corretores retomam às 8h e você será o
  primeiro da fila. Enquanto isso, já pode descobrir seu valor aqui: [Descobrir meu valor]" (botão só se não
  preencheu). Às 08:00 entra no topo da roleta do anúncio com nova oferta.
- **Dia:** cliente já recebeu "estou chamando um corretor"; segue para a roleta geral/fila de espera com o dono e o
  corretor da vez recebe o aviso normal; se em 10 min ninguém atendeu, o dono recebe alerta.

### 3.8 Janela de 24 h com o corretor
- **Principal: template utility aprovado na Meta** ("Cliente aguardando atendimento — {nome}. Responda Atender.")
  usado só quando a janela do corretor está fechada. Custo baixo (ordem de centavos de dólar por mensagem no Brasil;
  utility dentro de janela aberta não é cobrado — conferir tabela oficial vigente).
- Complementar: corretor manda "bom dia" ao oficial ao chegar (qualquer resposta à oferta também renova a janela).
  Sistema mostra a lista "Janela aberta hoje" e avisa o corretor às 07:45 pelo push se a dele fecha em < 2 h.
- **Envio automático de "bom dia" pelo WhatsApp pessoal (Baileys): desligado por padrão** (ver riscos); se o dono
  quiser, no máximo 1 por dia, horário com variação de alguns minutos, sem reenvio de "oi"/emoji.
- Mensagem de número da equipe no oficial nunca vira cliente nem dispara fluxo (WA-12).

### 3.9 Generalização para a roleta geral
Mesma oferta com botões, interruptor separado, **desligado**. Só ligar depois de 2 semanas de métricas da roleta do
anúncio.

## 4. Mudanças priorizadas vs. desenho original
1. **Template utility como caminho principal** para avisar corretor fora da janela; "bom dia" automático pelo pessoal
   desligado por padrão (risco de banimento do número pessoal e da janela vencer às 08:00) — cadeira 3.
2. **Oferta com botões "Atender / Agora não" e prazo de 2 min** (relógio de 1 min tornaria "1 min" injusto) — cadeiras 1 e 4.
3. **Desligar WA-18, WA-31 e silêncio de 3 h para quem está no fluxo novo** (senão o cliente recebe mensagens em
   dobro) — cadeira 1.
4. **Prazo de 5 min para o 1º contato após aceitar**, senão volta (aceitar sem atender era o furo maior; mediana atual
   de 1ª resposta é 9 min) — cadeiras 5 e 4.
5. **Cliente sempre sabe o que está acontecendo** ("estou chamando um corretor", noite com link de simulação e topo
   da fila às 8h) — cadeira 4.
6. Cutucada 3 min (2 min é cedo; em Valores, depende de ter aberto o link) e transferência 2 min depois — cadeiras 4 e 5.
7. Cliente com responsável ativo vai direto para ele, sem roleta; ordem dos botões Valores primeiro — cadeiras 1 e 2.
8. Gênero só com nome inequívoco; nome pré-preenchido editável; justiça: 3 ignoradas → sai e avisa — cadeira 4.

## 5. Dúvidas que o dono precisa responder
1. **Aprovar um template utility na Meta para avisar corretor?** Recomendado: **sim** (custa centavos, elimina a
   dependência do "bom dia").
2. **Texto do botão: "Falar com associado" ou "Falar com corretor"?** Recomendado: "Falar com corretor" (o cliente
   entende melhor).
3. **À noite, oferta só para quem esteve na imobiliária hoje (regra ROL-2f) ou para qualquer participante com WhatsApp
   conectado?** Recomendado: qualquer participante da roleta do anúncio, só nesta roleta.
4. **Prazo de 2 min por corretor (em vez de 1)?** Recomendado: 2 min.
5. **Quem aceitou e não falou com o cliente em 5 min perde o cliente?** Recomendado: sim.
6. **Ligar o "bom dia" automático pelo WhatsApp pessoal?** Recomendado: não (manual + template).
7. **Domingo e feriado contam como "noite"** (mensagem de 8h, sem oferta)? Recomendado: oferta continua de dia se
   houver participante ligado; mensagem das 8h só quando ninguém aceitou.
8. **Cliente que não enquadra no MCMV também vai para a roleta do anúncio?** Recomendado: sim, marcado.
9. **Ofertas de madrugada (ex.: 2h) devem acordar o corretor?** Recomendado: oferta só até 22h; depois, mensagem das
   8h ao cliente.

## 6. Riscos sem solução limpa
- **Banimento:** o oficial já foi banido uma vez; mensagens repetidas ao corretor (que podem ser bloqueadas/denunciadas
  pelo próprio corretor por engano) contam na qualidade do número. Mitigação parcial: botões, poucas ofertas, template.
- **Automação no WhatsApp pessoal (Baileys)** é contra os termos do WhatsApp para contas comuns; qualquer envio
  automático aumenta o risco de perder o número do corretor (e com ele a elegibilidade ROL-2d).
- **Janela gratuita de 72 h do anúncio** só vale se a empresa responder em 24 h e cobre o oficial↔cliente; o atendimento
  segue no WhatsApp particular do corretor, então o histórico fica fora do oficial (ficha mostra só o que o CRM capta).
- **Relógio de 1 min (cron):** prazos curtos nunca serão exatos; o aceite é imediato (webhook), o vencimento não.
- **Nome do perfil não é nome real:** saudação errada é inevitável em parte dos casos.
- **Amostra pequena** (57 conversas, sem dados depois de 16/10): os tempos sugeridos precisam ser recalibrados.

## 7. Rodadas (cadeira → principais mudanças)
| Rodada | Cadeira | Principais mudanças |
|---|---|---|
| 1 | CRM (crm-editor, leitura) | Achou sobreposição com WA-18/WA-31/SIM-AUTO-ENVIO; botões máx. 3 e 20 caracteres já travados no editor de Fluxos; cron de 1 min; cliente já cadastrado vai ao responsável |
| 1 | Tráfego | Valores como 1º botão; objetivo = simulação; marcar etapa do lead para medir qualidade por anúncio |
| 1 | WhatsApp/automação | CTA URL não mistura com botões de resposta (2 mensagens na Localização); template utility; contra "bom dia" automático e reenvio de "oi" |
| 1 | Atendimento | Cutucada 2→3 min; cliente sempre avisado da transferência; gênero só inequívoco |
| 1 | Dados | 9 min de mediana de dia, horas à noite; 21% chegam à noite; 23% só 1 mensagem |
| 2 | CRM | Aceite atômico; "Agora não"; sessão conectada como requisito; prazo 1→2 min |
| 2 | Tráfego | Contestou desligar WA-18 inteiro: mantido só um lembrete do formulário dentro do fluxo (link na mensagem noturna) |
| 2 | WhatsApp | Oferta com botões renova janela; limite de horário 22h para ofertas |
| 2 | Atendimento | 5 min para 1º contato após aceitar; justiça 3 ignoradas |
| 2 | Dados | Pediu métricas de aceite e tempo por corretor desde o dia 1 |
| 3 | Todas | Convergência na versão final; divergências abaixo |

### Divergências que ficaram (para o dono)
- **"Bom dia" automático pelo pessoal:** CRM/Atendimento aceitam (custo zero, já desenhado) × WhatsApp contra (risco
  de banimento). Final: desligado por padrão, dúvida 6.
- **Oferta de madrugada:** Dados/Tráfego querem oferta a qualquer hora (lead esfria) × Atendimento quer parar às 22h.
  Final: até 22h, dúvida 9.

## 8. Métricas a acompanhar
- Tempo da 1ª mensagem do cliente até a 1ª mensagem humana (dia/noite) — hoje 8,9 min / 55 min.
- % que clica em cada botão; % que abre o link; % que conclui a simulação; % que só mandou 1 mensagem (hoje 23%).
- Ofertas por cliente; taxa de aceite por corretor; tempo até aceite; aceites sem atendimento em 5 min.
- % de transferências por silêncio vs. por pedido; clientes da noite atendidos até 8h15.
- Falhas de envio ao corretor (janela fechada, template usado, custo do mês).
- Qualidade do número oficial no gerenciador da Meta (semanal) e bloqueios/denúncias.
- Conversão por anúncio até simulação, visita e venda (com o gestor-trafego).
