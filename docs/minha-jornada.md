# Minha Jornada e origem original

## Entradas
- Configuração: `/admin/minha-jornada`, somente administração/gestão.
- Público: `/minha-jornada/[token]`, sem login, token aleatório de 256 bits.
- Card: código pesquisável, aviso manual de WhatsApp e histórico.
- Regenerar link exige gestão/admin e acesso ao cliente pelas regras existentes.

## Persistência
- `simulation_registrations.client_code`: sequência exclusiva e imutável, distinta do ID e do token.
- `client_journeys`: token privado, maior progresso, estado anterior, versão, última mudança e aviso.
- `client_journey_events`: eventos da experiência. O histórico anterior de status também aparece no painel; avisos não são inseridos em `client_status_history`, para não interferir em pontuação/relatórios.
- `crm_settings`: `client_journey_statuses` e `client_journey_copy`, com mensagens iniciais preenchidas.
- `client_origins`: evolui a tabela existente, preservando campanha e snapshot, tipo/label da origem, ator, destino inicial e metadados UTM.
- `acquisition_context`: contexto fornecido exclusivamente pelo servidor na criação; o trigger grava a origem na mesma transação do cliente.

## Regras
- O trigger captura mudanças reais de status, inclusive de automações. O progresso utiliza o maior valor entre o acumulado e a configuração do novo status.
- Alterar configuração não altera retroativamente progresso ou timestamp dos clientes.
- A janela de celebração dura exatamente 24 horas desde a última mudança; acessos e cliques de aviso não a consomem nem reiniciam.
- O aviso registra acionamento, não entrega. Não há novo envio automático de WhatsApp/e-mail.
- CTA consulta o responsável atual. Sem telefone válido, não há botão quebrado.
- Textos são renderizados como texto React; a configuração rejeita marcação HTML.
- A página pública recebe uma allowlist de apresentação, nunca o registro completo.
- As tabelas privadas usam RLS sem políticas públicas e grants apenas ao servidor. O aviso informativo do advisor sobre ausência de políticas é esperado: clientes anônimos/autenticados não consultam essas tabelas diretamente. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Migrações
1. `20260913140544_client_journey_and_origins.sql`: códigos, configuração, estado, eventos, origem e triggers.
2. `20260913140710_journey_origin_compatibility.sql`: compatibilidade com o gravador de campanhas da versão anterior durante a publicação; apenas enriquece origem desconhecida com evidência de campanha existente.
3. `20260913141214_journey_legacy_simulation_backfill.sql`: vincula simulações antigas sem cadastro correspondente quando existe telefone registrado, sem duplicar clientes conhecidos. Reutiliza os valores sentinela do cadastro manual para campos ausentes; não altera os valores financeiros da simulação. Não simula um avanço recente durante o backfill.
4. `20260913142651_journey_direct_source_backfill.sql`: recupera a origem pessoal somente quando comprovada pelo campo existente `direct_broker_link`.
5. `20260913142754_journey_historical_transition_backfill.sql`: recupera o timestamp e o ponto anterior de jornadas existentes apenas quando o último evento histórico corresponde ao status atual.

## Arquivos principais
- `lib/client-journey.js`: consultas privadas/públicas, configuração e ações autorizadas.
- `lib/journey-presentation.js`: templates seguros e DTO público explícito.
- `components/ClientJourney.jsx` e `.module.css`: página pública e animação.
- `components/JourneySettings.jsx`: edição e pré-visualização.
- `components/ClientJourneyActions.jsx`: aviso, regeneração e histórico no card.
- `lib/simulation-registrations.js` e `lib/lead-origin.js`: captura da origem na criação.
- `lib/lead-distribution.js` e `components/LeadDistributionDashboard.jsx`: origem no histórico da fila.

## Verificação
`node --test tests/client-journey.test.mjs`

`JOURNEY_TEST_BASE` e `JOURNEY_TEST_TOKEN` permitem executar `node --test tests/journey-http.test.mjs` contra um cadastro de teste.

`supabase/tests/client_journey.sql` testa avanços, não regressão, timestamps, avisos, imutabilidade, token e proteção de acesso dentro de uma transação com rollback.

`supabase/tests/client_origins.sql` valida os tipos de origem, unicidade por cliente e distribuição da roleta, também com rollback.

`tests/journey-auth.integration.mjs` é opt-in (`JOURNEY_QA_CLIENT_ID`): cria uma conta técnica temporária, sem participação na fila, para validar sessão real de gestor/corretor, escopo de acesso, aviso, auditoria e regeneração. Remove a conta ao terminar. Execute somente contra um cliente isolado de teste.

O projeto não possui script de lint. O build Next executa a validação TypeScript.
