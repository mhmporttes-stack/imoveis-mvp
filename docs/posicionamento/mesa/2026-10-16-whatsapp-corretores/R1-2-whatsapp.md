# Rodada 1 — Cadeira WhatsApp e automação (Versão 2)

Conclusão: **corrigir a régua antes do volume.** "Entregue 58 %" mede **1 tique** (chegou ao servidor), não entrega; "lida" nunca é gravada para automáticas (lacuna do CRM). 401 sem envio parecem evento na conta/celular ou pareamento falho, não volume.

## Respostas ao que Dados deixou (código conferido)
1. **401 sem envio** (`whatsapp-individual-service/src/reconnect-policy.js`, `session-lifecycle.js`, `sessions.js`): 401 = WhatsApp encerrou o aparelho vinculado; o serviço apaga credenciais e só volta com QR — nossa reconexão não provoca 401. Causas possíveis: pareamento que falhou (código vencido termina em 401 — caso Jennyfer 11/10); evento na conta (Ketlin caiu nos 2 espaços no mesmo minuto = mesmo número, 2 aparelhos vinculados → reinstalação/troca de aparelho/"sair de todos"/ação do WhatsApp — a confirmar com fonte); celular principal sem uso (prazo a confirmar); mesmo número em 2 espaços dobra exposição. Baileys travado em 6.7.24, mas a versão do protocolo vem do GitHub a cada conexão (`fetchLatestBaileysVersion`, `sessions.js:384`) — hipótese; telemetria grava `waVersion`. **Desde 14/10 a telemetria grava `detail`** (ex.: `conflict.device_removed`) → pedir a Dados: separar 401 por `detail` e por "conectou antes ou não".
2. **"Responda SAIR"**: dado não separa; nas 2ª/3ª só antecipa opt-out. Prática de mercado: saída fácil reduz denúncia (a confirmar). Manter a saída; trocar "SAIR" em maiúsculas por linguagem natural só quando o CRM reconhecer recusa natural (hoje só "SAIR" vira Não contactar, `lib/prospecting-reply.js`).
3. **Lida/entrega**: serviço já repassa (`statusLabelFor`, `sessions.js:726`), mas `lib/whatsapp-individual-inbound.js:605` grava `server_ack` (1 tique) em `daily_goal_auto_queue.delivered_at`, e a "lida" de automática só tenta preencher `delivered_at` (L650–658) porque automática não tem linha em `whatsapp_messages` → separar `server_ack_at`/`delivered_at`/`read_at`. Explica os "20 % de respostas em não entregue" (recibos perdidos; 1.817 presas em "enviada" em 10/10).

## Questionamentos à V1
1. S1/"entregue 58 %" mede 1 tique; os 42 % sem ack nem saíram (socket morto/recusa) → renomear "não saiu".
2. S2 (teto 5 por 7 dias após qualquer 401/403) mistura pareamento/celular com recusa e cria regra paralela ao aquecimento MD-15 (10/15/20/30) → "em risco" só com 403 ou pausa por entrega baixa, ajustando a curva existente.
3. "Número 1 descartável": cliente que respondeu fica naquela conversa → perde lead e histórico; e "descartável" é contornar as regras do WhatsApp de forma assumida → número de prospecção sem cliente em andamento, não "de queimar".
4. 9h–14h: intervalos se sobrepõem → testar com metade da equipe por 2 semanas.

## VERSÃO 2 (números = exemplos configuráveis; sem garantia de que número não cai)
1. **Prospectar:** teto por número (ex.: 15); aquecimento = curva MD-15, reiniciando também após 401 que tinha conectado; **2 tentativas automáticas** (D e D+2/3; 3ª só manual); aquecimento de número novo 3–7 dias de uso humano antes da automação (prática de mercado) + espera de 2 h após conectar (já existe); conteúdo curto, sem link, sem promessa, pergunta de 1 palavra; **janela 8h–18h, sábado só de manhã** (decisão do dono).
   - T1: "Oi, {{nome}}! Aqui é {{corretor}}, {{cargo_corretor}} da Matheus Machado Imóveis. Você ainda tem interesse em comprar um imóvel?"
   - T2: "Olá, {{nome}}, tudo bem? Sou {{corretor}}, da Matheus Machado Imóveis. Posso te fazer uma pergunta rápida sobre casa própria?"
   - T3: "{{nome}}, bom dia! {{corretor}} aqui, da Matheus Machado Imóveis. Você está procurando imóvel para morar ou já resolveu?"
   - T4: "Oi, {{nome}}! Meu nome é {{corretor}}, trabalho com financiamento de imóveis na Matheus Machado. Hoje faz sentido para você conversar sobre isso? Pode responder só sim ou não."
   - T5 (2ª tentativa): "{{nome}}, passando só uma vez mais: se quiser, te explico como funciona a simulação, sem compromisso. Se não for o momento, me avisa que eu não te chamo mais." (até haver detector de recusa natural: "Se preferir não receber, responda SAIR.")
2. **Alerta precoce:** A1 "não saiu" (ex.: 3 automáticas seguidas sem 1 tique em 30 min → pausa no dia + avisa gestora); A2 403 → parado até o dia seguinte (já é); A3 401 → pelo `detail`: aparelho removido = tarefa do corretor, pareamento falho = suporte, sem penalidade; A4 (precisa `read_at`) queda de leitura vs. média do número; A5 recusas acima de um limite → teto menor no dia seguinte.
3. **Retomada:** corretor: alerta → confere celular (aberto, internet, "aparelho desconectado") → 401: reconecta pelo QR uma vez, se falhar avisa a gestora → 403: não tenta, lista impressa/outro número. Gestora: liga em ≤ 30 min, confirma 401/403, valida/nega restrição no mesmo dia, libera lista impressa, anota causa em 1 linha. Indicadores: "horas sem número na janela" (< 2 h) e "% de episódios com lista no mesmo dia".
4. **Reserva/rodízio:** rodízio não; Número 1 = prospecção, Número 2 = relacionamento (nunca envio frio), chips e contas realmente diferentes; CRM impede o mesmo número nos 2 espaços; se o 1 cai, o 2 não herda a prospecção; chip reserva parado não ajuda; reserva da empresa só se o dono arcar.
5. **Salvar/responder:** 1ª mensagem pede resposta; link só depois. Após a resposta: "Que bom, {{nome}}! Salva meu contato como '{{corretor}} Imóveis', assim tudo que eu te mandar abre certinho aqui. Vou te mandar o link da simulação agora." Sem resposta, sem link. Cliente do site: botão "Receber minha simulação" continua o melhor caminho.

## Decisões do dono
1. Janela 8h–18h e sábado só de manhã (hoje 06:30–18:00 seg–sáb). 2. Acabar com a 3ª tentativa automática. 3. 2º chip real por corretor (custo, quem paga). 4. "Não é o momento" = Não contactar ou só pausa? 5. Manter "SAIR" até o CRM reconhecer recusa natural.

## Para Viabilidade
`server_ack_at`/`delivered_at`/`read_at` na `daily_goal_auto_queue` (`lib/whatsapp-individual-inbound.js:605`, `:650`); painel de 401 por `detail` e "pareou ou não"; bloquear mesmo número nos 2 espaços; detector de recusa natural → Não contactar; alerta A1; fila não travar por erro do Google Contacts; indicador "horas sem número"; rastrear clique de link; origem do contato para o texto; corte da 3ª tentativa.
