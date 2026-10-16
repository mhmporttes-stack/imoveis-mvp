# Rodada 1 — Cadeira Viabilidade no CRM (Versão 3)

## Regra que vale hoje (código)
**15 por corretor por dia, somando os 2 números**, seg–sáb, 06:30–18:00, espaçamento médio ~46 min (sorteio 28–64 min, mín. 5 min). `dailyCapFor` = mín(30, `daily_cap_override`=15) (`lib/daily-goal-policy-core.mjs:140-143`; `DAILY_CAP` `:20`); janela `WINDOW_START/END_MINUTES` (`:22-23`); sábado por `isBusinessDay` 1–6 (`lib/daily-goal-auto-core.mjs:167`). Brief desatualizado. **Divergência de doc:** rule MD-14b diz "30/dia por número"; código = soma dos números, máx. 30 por corretor (`:5`, `brokerWarmupCap :190`) → corrigir a rule.

## Itens conferidos
| Item | Hoje | Esforço / risco / migration |
|---|---|---|
| 1 tique × entregue × lida | `server_ack` grava `delivered_at` (`lib/whatsapp-individual-inbound.js:604-612`); entregue/lida da automática só preenchem `delivered_at` se vazio (`:650-657`); sem `read_at`; nome proposital (`daily-goal-delivery-monitor-core.mjs:6`); pausa/monitor/"enviadas hoje" leem essa coluna | M, **migration** (só `server_ack_at`, `read_at` novas); não mudar o sentido de `delivered_at` (dispararia pausas) |
| **Recibos perdidos (defeito)** | `wa_message_id` gravado só depois do envio responder (`daily-goal-auto.js:1749/1755`); hipótese: 1 tique chega antes e se perde (11/54 respostas em "não entregue") | Dados confirma atraso envio→recibo; correção P/M sem migration |
| 401 por `detail` / pareou | telemetria já guarda `detail` e `connected_ms` (migration `20261004100000`; `reconnect-policy.js:304-317`; nulo = nunca abriu); painel (`lib/whatsapp-session-health-core.mjs`) só mostra código | P, sem migration (dado desde 14/10) |
| Mesmo número nos 2 espaços | `phone_number` por número (`lib/whatsapp-individual.js:69`); só conhecido após parear (QR); por código numérico antes (`pairing-number.js`) | M; bloquear no código numérico; no QR desligar "Usar para disparo" do repetido e avisar |
| Recusa natural | **já existe**: `isClearOptOut` (`lib/prospecting-reply-core.mjs:47-107`, ~30 frases); com "agora/momento/depois/mas" → humano (PRO-8 opção B) | 0 código; "não é o momento" → Não contactar exige mudar PRO-8 (dono) |
| A1 "não saiu" | já há pausa ≥ 10 envios com ≤ 2 entregues (MD-15 item 8, `detectLowDeliverySlots`) + e-mail "10 seguidas sem tique" | P, depende do defeito dos recibos e do dono (MD-15 oficial) |
| Fila 06–09/10 | **corrigido em 10/10** (conexão sem permissão de Contatos fica em erro e envio segue; limite de 3 falhas, na 4ª sai sem sincronizar — `daily-goal-auto.js:1636-1658`, `protection-core :260-268`); resta reagendar +30 min por falha | Dados confirma se não houve mais e se o 0 foi geral |
| Horas sem número | base `whatsapp_number_activity`/`business_minutes_between` (ROL-2e) + painel | M, sem migration |
| Clique em link | apresentação `/s/<token>` grava `first_opened_at`, `view_count` (`lib/simulation-presentation.js:23`); formulário mede "preencheu" | P (relatório) |
| Origem no texto | `prospecting_contacts` sem coluna de origem; só `registration_id` | M; variável `{quando_cadastrou}` só p/ quem tem cadastro |
| Cortar 3ª tentativa | cadência 10/10/10 (`CAP_BY_ATTEMPT`), hibernação 24 h após a 3ª, PRO-9, pontuação | "automática só até a 2ª" (3ª vira manual, ainda conta) = P; "cadência de 2" = G |
| Janela 8h–18h / sábado manhã | 8h = P; sábado curto = M (janela por dia: planV2Schedule, reagendamento, monitor, PRO-14) | sem migration |
| Teto por número / curva MD-15 | teto por corretor; aquecimento por número 10/15/20/30 (com teto 15 só morde dias 1–2); logout não reinicia aquecimento (comportamento atual) | por número = M; reiniciar no logout = P; ganho pequeno |

**Com as fontes oficiais:** o microsserviço **não usa proxy** — todos os números saem do mesmo IP de datacenter da Railway; sessões retomadas se identificam como `["CRM Imoveis","Chrome","1.0"]` (`sessions.js:437`, fora do padrão). Hipóteses fortes para 401 sem envio, não testadas.

## Questionamentos à V2
1. Detector de recusa natural já existe; o T5 ("se não for o momento, me avisa") puxa "agora não é o momento", que vai ao humano pela PRO-8 → trocar o T5 ou mudar a régua. "Não saiu" para os 42 % é cedo (parte saiu: 11/54) → defeito dos recibos antes do A1.
2. Sábado só de manhã com teto 15 = 1 a cada ~16 min, 3× mais denso → teto proporcional (ex.: 5) ou sem envio.
3. Reiniciar MD-15 após 401 tem efeito mínimo; o que mais protege é IP/identificação, consentimento da base e corte da 3ª tentativa.

## VERSÃO 3 (números configuráveis; nenhum envio é "seguro" pelos Termos)
**Risco de fundo:** Diretrizes/Termos do WhatsApp proíbem cliente não oficial, automação e contato indesejado repetido; Política Business exige consentimento e atender pedido de parar. O CRM reduz a exposição, não elimina. O número oficial já foi banido (28/09).
1. **Prospectar:** 15/corretor/dia pelo Número 1; base fria primeiro de quem deixou o número conosco (cadastro/simulação), importados depois ou nunca; só 1ª e 2ª automáticas (3ª manual ou eliminada — dono); janela 8h–18h; sábado com teto menor ou sem envio; textos com as variáveis que o código aceita (`{saudacao} {primeiro_nome}, {nome_corretor} ({associado_a})` — não `{{nome}}`/`{{cargo_corretor}}`, nada de "bom dia" fixo).
2. **Detectar cedo:** consertar recibos (colunas separadas) → A1 por número (3 seguidas sem 1 tique em 15 min cada → pausa; ~2 h contra ~7 h hoje) → 401 por `detail` e `connected_ms`.
3. **Voltar rápido:** rotina da V2 + indicador "horas sem número na janela" no painel de saúde.
4. **Reserva:** sem rodízio; Número 2 com "Usar para disparo" desligado (padrão) e de relacionamento; CRM recusa o mesmo número nos 2 espaços; chip reserva só se o dono pagar.
5. **Salvar/responder:** 1ª sem link, pergunta curta; link só após resposta com pedido de salvar (texto da V2); medir por `first_opened_at`; saída que o CRM já reconhece: "Se não quiser mais receber, é só responder *não tenho interesse*".

## Especificação
**Fase 1 (processo, sem código):** conferir "Usar para disparo" desligado no Número 2; gestora desfaz mesmo número nos 2 espaços; rotina de queda; corretor abre o celular principal todo dia (14 dias); Dados mede 401 por `detail`/`connected_ms`, atraso de recibos, fila 06–09/10, aberturas da apresentação, % da base com cadastro.
**Fase 2 (defeitos primeiro):** D1 recibos perdidos (após confirmar); D2 corrigir rule MD-14b; D3 se houver fila parada após 10/10 → `/diagnosticar-producao`. Melhorias (cada uma com "sim"): `server_ack_at`/`read_at` (migration); 401 por `detail` no painel (P); bloquear mesmo número (M); janela 8h (P); automática só até a 2ª (P); textos novos em `lib/daily-goal-policy-messages.mjs` (P, MD-10/v2 item 6).
**Fase 3:** teste controlado de IP residencial/proxy por número e identificação padrão do navegador (número de teste, nunca de cliente); cadência de 2 (G); sábado curto (M); A1 com pausa automática; indicador horas sem número; filtro de consentimento na RPC `claim_daily_goal_contacts` (migration); variável de origem.

## Para a rodada 2
Dados: 401 por `detail`/`connected_ms`; atraso `sent_at`→recibo e sem recibo; fila 06–09/10 por corretor; quantos dos 36 episódios logo após conectar/reconectar; % da base com `registration_id` e resposta útil × importados; abertura da apresentação após 1ª resposta. WhatsApp: proxy residencial por número. Dono: 3ª tentativa; sábado; PRO-8 "não é o momento"; base só com consentimento; ciência do risco dos Termos.
