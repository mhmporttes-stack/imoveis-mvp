# Rodada 2: cadeira Viabilidade no CRM (Versão 6)

Trabalhei só lendo `origin/main` (58ff4d1c, e depois 140f9be9, o commit da espera de 2 h que chegou durante a leitura). Não editei, não gravei e não enviei nada.

**Resumo.** A espera de 2 h já foi corrigida em `origin/main` e usa a telemetria para saber a origem de cada conexão. Por isso "registrar a origem" deixou de ser obra. Três pontos da V5 não se sustentam no código:
1. **Filtro de cadastros próprios na RPC.** O filtro em si é simples (P), mas não adianta nada: a RPC só lê a base importada (`prospecting_contacts`), então devolveria os mesmos 12 contatos. Reativar os ~3.500 exige uma fonte nova de contatos (G, com migration).
2. **Troca dos textos.** Trocar o *SAIR* e reduzir para 6 modelos quebra uma REGRA OFICIAL (MD-15 v2 item 6) e o teste que a protege.
3. **Identificação do navegador.** Sessão retomada não usa "CRM Imoveis". O nome próprio só aparece no pareamento novo com histórico ligado.

## (a) Resposta às objeções contra a V3
- **Base "com consentimento" = 12:** aceito. Pior ainda: o formulário de simulação, de onde sai a maior parte dos cadastros próprios, **não tem nenhum aviso de contato** (`components/simulation-form/SimulationForm.jsx`, nenhuma menção a privacidade ou WhatsApp). Só o `LeadCaptureModal.jsx:247-250` mostra "Ao enviar seus dados, você concorda com nossa Política de Privacidade", e essa política fala em "contato por WhatsApp" (`app/politica-de-privacidade/page.jsx`). Não existe caixa de aceite nem coluna de consentimento no banco. "Cadastro próprio" é mais defensável que lista importada, mas **não é opt-in registrado**.
- **A1 com falso alarme:** aceito. O A1 sai até o D1 e a calibração.
- **`({associado_a})`:** aceito e conferido. Sem gênero cadastrado, o token fica no texto e o envio é bloqueado (`lib/daily-goal-auto-core.mjs:306-324`). Os modelos v2 já excluem essa variável (`lib/daily-goal-policy-messages.mjs:10`).

## (b) Conferido no código
| Item | O que o código mostra | Esforço / risco / migration / testes |
|---|---|---|
| Origem da conexão (QR × automática) | **Já resolvido para a espera de 2 h:** `lib/daily-goal-reconnect-settle-core.mjs` classifica pela telemetria (`trigger` manual/resume/auto + código da queda). Ainda não separa "QR novo" de "botão Conectar". A coluna `kind` da telemetria é texto livre (migration `20261004100000:32`). | Separar QR novo: P, só no microsserviço (marcar `kind` no evento `connected` quando `!creds.me.id` na criação, `sessions.js:401`). Sem migration. Risco baixo. Teste em `tests/daily-goal-reconnect-settle.test.mjs`. |
| Filtro "cadastros próprios" na RPC | `claim_daily_goal_contacts` (`supabase/migrations/20261004170000_prospecting_manual_lists.sql`) só lê `prospecting_contacts` e já exclui `do_not_contact`/`sale_completed` do cadastro ligado. Não existe recurso de "reativação". O filtro sozinho = P, mas o universo é de 12. | **Trazer os ~3.500 = G, com migration:** marcar a origem em `prospecting_contacts` ou criar uma fila de reativação a partir de `simulation_registrations`. Falta definir dono do contato: o cadastro já tem `responsible_user_id`, e há a regra de 7 dias e a P-05. Também excluir "em andamento" com outro corretor e o MD-13 (este já é revalidado no envio, `lib/daily-goal-human-guard.js`). Os ~3.500 **não foram verificados por mim**; Dados precisa definir o recorte por status. |
| Trocar modelos v2 | 7 de 10 modelos da 1ª tentativa, 2 de 10 da 2ª e 1 de 10 da 3ª afirmam contato ou interesse anterior. Teste trava: ≥ 8 por tentativa, 5 curtos + 5 longos, *SAIR* na última linha (`tests/daily-goal-policy-v2.test.mjs:503-517`). O anti-repetição usa `variant_index` (`daily-goal-policy-messages.mjs:62-75`). | Reescrever os 10 que afirmam interesse, mantendo 10/10/10 e *SAIR*: P, sem migration, roda o teste v2. Usar texto diferente por base (A para cadastro, D para importado) exige segmentar `pickV2Variant` pela origem do contato: M e depende da migration acima. Risco: trocar a ordem do array muda o sentido dos `variant_index` antigos, então trocar no mesmo lugar. |
| 3ª tentativa só manual | `CAP_BY_ATTEMPT = {1:10, 2:10, 3:10}` (`lib/daily-goal-policy-core.mjs:21`). Com 3 → 0 a fila v2 não planeja nem envia a 3ª (`:329`, `:548`). | Código P, sem migration. **Impacto M:** a rodada fica ativa esperando a 3ª manual, ocupa a carteira de 30 e reduz os contatos novos. A 3ª continua sendo obrigação na Meta (`lib/daily-goal.js:573`). Testes: v2 e `daily-goal-limites-30-10`. |
| Navegador padrão só no pareamento | `sessions.js:433-437` e Baileys 6.7.24 (`validate-connection.js`): o nome só vai no **registro do pareamento**. No login, só muda WEB_BROWSER para DARWIN/WIN32 quando o histórico está ligado com "Mac OS"/"Windows". Sessão por QR retomada já usa `Browsers.macOS("Desktop")` (`creds.registered` só é true no pareamento por código, `reconnect-policy.js:88-97`). O "CRM Imoveis" aparece no **pareamento novo com histórico** (`:434`). | P: só a linha 434 vira `Browsers.ubuntu("Desktop")` ("Ubuntu" não está no mapa, então mantém WEB_BROWSER e o tipo DESKTOP do histórico). Sessões já pareadas não mudam. Sem migration. Testar com número de teste da empresa. A premissa da V3 e da V5 ("retomadas se identificam como CRM Imoveis") estava errada. |
| IP fixo na Railway | Não há proxy nem `agent` no socket. `railway.json` sem rede. Um processo só (lease) leva **todos os números no mesmo IP**. | Sem código: é recurso de painel da Railway. Custo e plano não estão documentados no repositório. **Continua sendo IP de datacenter, agora um só e fixo para todos os números**: ganho incerto, pode até concentrar o risco. Proxy por número = P no código (opção `agent` do Baileys) e é o risco C. |
| Piloto pelo Oficial | Já existe: modelos (criar/enviar à Meta/sincronizar) e Disparo em lote, só admin/gestor (`lib/whatsapp-broadcasts.js:134, 417`; nunca pela sessão do corretor, `:15-22`). Público: base importada ou CSV. | **Defeito para o piloto:** o CSV só bloqueia "Não contactar" de `prospecting_contacts` (`:349`), não de `simulation_registrations`. Um cadastro próprio marcado Não contactar passaria. Correção P, sem migration, entra antes de qualquer piloto. Custo por mensagem: `crm_settings.whatsapp_pricing`, valor não citado. |

## (c) Decisões da V5 que questiono
1. **Trocar *SAIR* por "não tenho interesse" mexe em REGRA OFICIAL** (MD-15 v2 item 6, teste `:510-516`). *SAIR* já vira Não contactar (`prospecting-reply-core.mjs:52`) e é uma palavra só, sem ambiguidade. "Não tenho interesse **agora**" vai para o humano (PRO-8). Mantenho *SAIR*; trocar é decisão do dono.
2. **6 modelos fixos no lugar de 10/10/10** quebram o rodízio curto/longo e o anti-repetição (regra oficial). Os textos "1ª-A só cadastro" e "1ª-D só importado" não têm como ser escolhidos hoje. Proposta: reescrever os 10 modelos que afirmam interesse com texto neutro, que vale para as duas bases. O texto por base fica para quando a origem existir.
3. **"Reativar cadastros via filtro na RPC" subestima a obra** (G, não P) e superestima o consentimento: o formulário principal não avisa sobre contato.
4. **Teste A da V5 mira a sessão errada.** O ajuste é no pareamento novo (`:434`); nas retomadas não há nada a trocar.

---
# VERSÃO 6 (números configuráveis; nenhum envio é "seguro" pelos Termos)
1. **Prospectar:** a espera de 2 h já foi corrigida (140f9be9); primeiro medir se a fila voltou a ~15 por corretor por dia. Volume 15 por corretor/dia (soma dos números), pelo Número de prospecção. **Base:** importados continuam até a decisão do dono, mas **com textos neutros** (nenhum afirma interesse anterior). Reativação de cadastros próprios entra como projeto à parte (G), não como filtro. Tentativas: 1ª e 2ª automáticas; a 3ª manual só se o dono aceitar o efeito na carteira. Janela 8h–18h; sábado teto 5 ou sem envio.
2. **Detectar cedo:** D1 recibos → 401 em 3 tipos (com "QR novo" marcado na telemetria) → marca "em risco" → Dados mede os 500 → A1 calibrado.
3. **Voltar rápido:** tabela de retomada da V5, sem mudança.
4. **Reserva:** igual à V3/V5.
5. **Salvar/responder:** 1ª sem link, com pergunta; link só depois da resposta, junto com o pedido de salvar; saída continua *SAIR*.

**Especificação**
- **F1 (processo e decisões, sem código):** Dados confere o efeito do 140f9be9 em 2 dias úteis. Dono decide: textos neutros; *SAIR* × "não tenho interesse"; 3ª manual × carteira; sábado; reativação (G); piloto Oficial; teste de pareamento. Gestora revisa as 4 pausas e o "Usar para disparo" do Número 2.
- **F2 (código, nesta ordem):**
  1. Defeito: CSV do Disparo Oficial passa a bloquear Não contactar de `simulation_registrations` (P).
  2. Defeito: D1 recibos, depois de confirmar no `/diagnosticar-producao` (`daily-goal-auto.js:1770/1776` × `whatsapp-individual-inbound.js:611-613, 655-657`).
  3. Textos neutros nos 10 modelos que afirmam interesse (P; teste v2).
  4. `kind` "QR novo" no evento `connected` (P, microsserviço).
  5. 401 por tipo no painel (P).
  6. 3ª manual (P código / M impacto), se aprovada.
  7. Janela 8h (P).
- **F3:** pareamento novo com `Browsers.ubuntu("Desktop")` em número de teste, medindo "401 em ≤ 30 min ÷ aberturas". IP fixo só depois, com custo levantado no painel da Railway. Reativação de cadastros (migration e dono do contato). Piloto Oficial só com cadastros próprios e com o defeito 1 corrigido. Sábado curto (M). A1.

## Decisões do dono (consolidadas)
1. Textos neutros para a base importada já, ou pausar os importados.
2. Manter *SAIR* (oficial) ou trocar por "não tenho interesse".
3. 3ª só manual, sabendo que ocupa a carteira de 30 e entra na Meta.
4. Reativar cadastros próprios: projeto G, e a quem pertence o contato (corretor atual × roleta).
5. Pôr aviso de contato por WhatsApp no formulário de simulação (hoje não há).
6. Sábado: teto 5 ou sem envio.
7. Teste de pareamento novo (número de teste) e, depois, IP fixo pago; proxy residencial não recomendado.
8. Piloto pelo Oficial (custo por mensagem; risco ao número do anúncio).

## O que mudei e por quê
1. "Registrar origem" deixou de ser obra: o 140f9be9 já usa a telemetria; falta só marcar "QR novo".
2. O filtro na RPC virou projeto G, porque a RPC só enxerga a base importada (12 contatos).
3. *SAIR* fica, porque é regra oficial com teste e não é ambíguo.
4. Os textos passam a ser reescritos dentro dos 10/10/10, porque 6 modelos fixos quebram o rodízio oficial.
5. O teste A mudou de alvo para o pareamento novo, porque o login retomado não leva o nome do navegador.
6. Entrou o defeito do CSV do Oficial, porque o piloto mandaria mensagem a quem pediu para não ser contatado.
7. O "consentimento" do cadastro foi rebaixado, porque o formulário principal não tem aviso.
8. A 3ª manual ganhou o alerta de impacto na carteira de 30.

## Para a rodada 3 (começa por Dados)
- **Dados:** envios por dia antes e depois do 140f9be9. Recorte e contagem real dos "~3.500" por status, responsável e Não contactar. Quantos cadastros próprios vieram do formulário de simulação (sem aviso) e quantos do LeadCaptureModal (com aviso). Os 28 casos com recibo antes do `sent_at` mostram recibo gravado; ver se o D1 é mesmo corrida ou diferença de LID/jid. Taxa de 401 por abertura. Os 500 simultâneos em vários números.
- **WhatsApp:** os textos neutros (10/10/10 com *SAIR*) e o roteiro do teste de pareamento.

Arquivos citados: /home/user/imoveis-mvp/lib/daily-goal-policy-messages.mjs, /home/user/imoveis-mvp/lib/daily-goal-policy-core.mjs, /home/user/imoveis-mvp/lib/daily-goal-reconnect-settle-core.mjs, /home/user/imoveis-mvp/lib/whatsapp-broadcasts.js, /home/user/imoveis-mvp/whatsapp-individual-service/src/sessions.js, /home/user/imoveis-mvp/whatsapp-individual-service/src/reconnect-policy.js, /home/user/imoveis-mvp/supabase/migrations/20261004170000_prospecting_manual_lists.sql, /home/user/imoveis-mvp/components/simulation-form/SimulationForm.jsx, /home/user/imoveis-mvp/components/LeadCaptureModal.jsx, /home/user/imoveis-mvp/tests/daily-goal-policy-v2.test.mjs. Observação: a cópia local está 2 commits atrás de `origin/main` e tem alterações em stage (`.claude/rules/meta-diaria-ranking.md`, `docs/BUSINESS_RULES.md`) de outro agente; não toquei nelas.