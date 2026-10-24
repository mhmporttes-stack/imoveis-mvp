# Plano de automação de atendimento (ESPECIFICAÇÃO, nada implementado) — 2026-10-24

Decisão do dono (24/10): automação no WhatsApp Oficial, no número pessoal dele e nos dos corretores; Marketplace "automático com cuidados" (atraso 30 s–2 min, só primeiras mensagens, depois corretor). Premissa do dono: só conversa com cliente quente, que escreveu primeiro.
Base: `docs/scout/relatorios/2026-10-24-automacao-atendimento.md`; regras WA-17/18/19b/30/31 (`.claude/rules/integracoes-externas.md`). Todo número abaixo é EXEMPLO configurável. Auditoria obrigatória (`auditor-automacoes`) antes de ligar qualquer coisa.

## Aviso de risco (honesto, o dono decide em §5)
- Oficial (API): automação é permitida; é o canal seguro. Aviso ao cliente de que é atendimento automático é recomendado.
- Pessoal (Baileys, dono e corretores): as diretrizes do WhatsApp (atualizadas 23/09/2026) proíbem automação por cliente não oficial. Responder só quem escreveu REDUZ o risco (menos denúncia/bloqueio), mas NÃO o elimina. Risco recai no número do dono e dos corretores.
- Marketplace (extensão no perfil pessoal do dono, MKT-2): termos do Facebook proíbem robô/coleta automatizada sem permissão escrita; API oficial do Marketplace NÃO confirmada pela Meta. O fato de o cliente escrever primeiro não muda esse termo. Risco recai no perfil pessoal do dono.
- Mitigação adotada: travas §1, liga/desliga por número, começar com um número piloto.

## 1. Regra de ouro "só cliente quente"
A automação NUNCA inicia contato frio. Só responde quando:
1. o cliente escreveu (ou respondeu) e a mensagem dele está dentro da janela própria do canal (Oficial: 24 h; pessoal/Marketplace: conversa iniciada por ele nas últimas 24 h, valor configurável);
2. a conversa não está com humano (corretor digitou nos últimos N min, hoje `HUMAN_ATTENDING_MS` = 30 min) nem em "Particular" (WA-19);
3. o cliente não é Não contactar / não pediu "pare".
Lembretes (WA-17/18) e disparos/campanhas frias continuam regras próprias e NÃO entram neste plano; no pessoal, lembretes seguem as travas abaixo.

Travas anti-banimento por número (todas configuráveis por número; exemplos):
- Teto de respostas automáticas: ex. 10/hora e 40/dia por número pessoal; Oficial segue limites da Meta/qualidade.
- Atraso humano variável: ex. 20 s–90 s antes da 1ª resposta, 8–40 s entre mensagens seguidas; aleatório, nunca fixo.
- "Digitando…" antes de cada envio, duração proporcional ao tamanho do texto (já existe `typingPause`/`sendTypingIndicator`).
- Frases variadas: 3+ variações por passo, sorteio sem repetir a última; nunca texto idêntico para muita gente seguida.
- Máx. mensagens automáticas seguidas sem o cliente responder: ex. 2.
- Pausa automática do número: ao detectar desconexão forçada, erro de envio repetido, aviso de restrição, ou queda de taxa de resposta; número fica em "automação pausada" e o dono é avisado (Central/push). Retomar só manual.
- "Pare/sair/não quero/parar": encerra a sessão, marca Não contactar (Oficial já tem WA-30; replicar no pessoal e no Marketplace via mesma função, sem criar regra paralela).
- Números internos (dono, corretores, equipe, fornecedores marcados): nunca recebem automação.
- Fora do horário (seg–sáb 8h–19h, WA-31): uma resposta por período fechado, nunca madrugada.
- Cliente já atendido por corretor, com negócio em andamento ou já cliente (condição `is_client`/`has_broker`): automação só confirma recebimento, não faz qualificação.

## 2. Fluxos por canal
Roteiro único (mesmo esqueleto nos 4 canais; muda o tom e o limite):
1. Boas-vindas: nome do corretor/equipe, aviso de atendimento automático inicial, pergunta aberta curta.
2. Qualificação MCMV curta (máx. 3 perguntas, uma por vez): primeiro imóvel? renda familiar aproximada? região/tipo de interesse. Sem calcular, sem prometer subsídio/parcela; números financeiros só vêm da simulação oficial do CRM (`lib/simulacao-entrada`, Base Mestra).
3. Envio do link do formulário/simulação do corretor (`buildBrokerSimulationLink`, `directSimulationLink`; usa o motor WA-17 de lembrete de 1 h se não preencher).
4. Dúvidas frequentes (respostas curtas e fixas, aprovadas pelo dono): como funciona simulação, documentos básicos, prazos de atendimento, visita. Qualquer coisa fora da lista = passa ao corretor.
5. Objeções (preço, "vou pensar", "já tenho corretor"): 1 resposta empática + convite à simulação; segunda objeção = corretor. Não insiste.
Textos: `copy-comercial` + `portugues-comunicacao`; conteúdo MCMV: `primeiro-imovel-mcmv`; nunca inventar regra.

Passa ao corretor (handoff) quando: (a) 2 tentativas seguidas sem entender; (b) cliente pede humano/"atendente"; (c) assunto sensível (reclamação, jurídico, valor/negociação, documento pessoal, dado de saúde, ameaça, cliente irritado); (d) cliente enviou áudio longo/imagem de documento; (e) 2ª objeção; (f) formulário preenchido (entra na roleta WA-18). Ao passar: mensagem de transição ("vou te passar para o corretor X"), automação para nessa conversa.

O que o corretor vê: etiqueta "Atendimento automático" na conversa; resumo de 3 linhas (nome, interesse, respostas da qualificação, o que já foi enviado); motivo do handoff; botão "Assumir" (e "Devolver ao robô" só para o dono/gestor); no pessoal, a mensagem automática aparece no histórico marcada como "enviada pelo robô". Quando o corretor digita, o robô para na hora.

Por canal:
- Oficial (API): fluxo completo; dentro da janela de 24 h; fora dela só template aprovado e só para quem já escreveu antes (continua nas regras de templates). Aviso de automático no 1º texto.
- Pessoal do dono: igual, com todas as travas; piloto começa aqui. Clientes de origem Oficial/link do dono/roleta/Marketplace não vão a Particular (WA-19b), então são elegíveis.
- Pessoal dos corretores: igual, ligado por corretor (padrão desligado; o corretor pode desligar o próprio; o dono liga/desliga todos). Textos usam o nome e o gênero do corretor (`buildBrokerGenderVars`). Cada número tem limites próprios. Só clientes que escreveram; "Particular" nunca.
- Marketplace: ver §3.

## 3. Marketplace "automático com cuidados"
- Dispara só quando o cliente envia mensagem (nunca primeiro contato; nunca para quem só viu o anúncio).
- Só as primeiras mensagens: ex. no máximo 2 respostas automáticas por conversa (boas-vindas + 1 pergunta/link). Depois: "o corretor já vai te responder" e passa ao corretor com aviso (push/Central).
- Atraso humano aleatório 30 s–2 min antes de cada resposta; nunca em rajada; teto por hora/dia configurável.
- Frases variadas (3+ por passo, sem repetir seguidas); nunca copiar/colar o mesmo texto longo.
- Para na hora em que o corretor/dono digitar na conversa (checar imediatamente antes de enviar, cancelando respostas agendadas).
- Sem qualificação longa nem cálculo: objetivo é mover o cliente para o WhatsApp Oficial ou formulário (link) e passar ao corretor.
- Pausa automática da função se o perfil receber aviso/verificação da plataforma; dono avisado.
- Só roda no ambiente onde a extensão já opera (MKT-2); nada novo é instalado sem aprovação.

## 4. Reaproveitar o que já existe vs. o que falta (para o `crm-editor`)
Já existe (não recriar):
- Motor de Fluxos: `lib/whatsapp-flows.js` + `lib/whatsapp-flow-core.mjs` (puro/testado): gatilhos keyword/first_message/ad_referral/any_message/campaign_reply; nós start/message/input/action/condition/delay; ações roulette/base_roulette/tag/handoff/finish/stop; condições business_hours/is_client/has_broker/ad_origin/has_name; cooldown; bloqueio quando humano atende (`HUMAN_ATTENDING_MS`, só gatilho keyword passa); retomada por cron (`processDueFlowSessions`); `typingPause`/`sendTypingIndicator`; bloqueio de `do_not_contact` na entrada (`findDoNotContactInboundBlock`).
- Envio com reserva idempotente: `sendReservedAutomationMessage` (`lib/whatsapp-form-reminder.js`, parâmetro `individual` para pessoal).
- "Pare" no Oficial + Não contactar (WA-30), fora de horário (WA-31), lembretes WA-17/18, anúncio em espera, link do formulário/simulação, tag, roleta.
Falta implementar:
1. Gatilho/execução dos Fluxos no canal PESSOAL (Baileys) com liga/desliga por número e por corretor (hoje só Oficial roda Fluxos; confirmar no código).
2. Travas por número: teto hora/dia, atraso aleatório configurável, sorteio de variações de texto, máx. automáticas sem resposta, pausa automática por sinais de restrição, tela de configuração (dono).
3. "Pare" universal (pessoal e Marketplace) usando a mesma função de Não contactar.
4. Lista de números internos excluídos da automação.
5. Condição "cliente escreveu primeiro / janela própria" como guarda central antes de qualquer resposta automática (rejeita se a conversa foi iniciada por nós).
6. Nós/ações novos: contagem de "não entendi" (handoff após 2), classificação de assunto sensível (lista de palavras, regra determinística, sem IA decidindo), variações de mensagem, resumo para o corretor, rótulo "robô".
7. Biblioteca de FAQ e objeções aprovada pelo dono (conteúdo, não código).
8. Marketplace: gatilho de mensagem recebida na extensão, fila com atraso 30 s–2 min, cancelamento ao corretor digitar, limite de respostas por conversa, pausa por aviso. Hoje a extensão não responde sozinha.
9. Painel de métricas: respostas automáticas, handoffs e motivos, pare/Não contactar, pausas, conversão para formulário (definições em `docs/METRICAS_FUNIL.md`, números pelo `analista-dados`).
10. Testes: `node --test` das regras puras (guarda quente, travas, pare, handoff) e revisão do `auditor-automacoes`. Nada de envio real como teste.
Messenger oficial (Página do Facebook, `pages_messaging`) fica FORA deste plano até decisão do dono (relatório do scout).

## Ordem sugerida
1) Guarda central "só quente" + Pare universal + números internos (puro, testado). 2) Travas por número + pausa automática. 3) Fluxos no pessoal do dono (piloto, ~1 semana, medir). 4) Corretores um a um. 5) Marketplace. Oficial usa o que já existe, só ganha o roteiro MCMV curto.

## 5. Decisões do dono
1. Aceita o risco de banimento do número pessoal (dono e corretores) e do perfil do Facebook, sabendo que a regra do WhatsApp/Facebook proíbe automação fora da API oficial? (Alternativa de menor risco: automação só no Oficial e, nos pessoais, apenas o "Pare" e o resumo ao corretor.)
2. Começar por piloto só no número do dono? (recomendado)
3. Corretores: ligado por padrão ou o corretor/gestor opta?
4. Limites iniciais (hora/dia, atraso, máx. respostas no Marketplace): aceita os exemplos acima?
5. Aprovar a lista de FAQ/objeções e o texto do aviso "atendimento automático".
6. Messenger oficial com Página: quer avançar depois?
