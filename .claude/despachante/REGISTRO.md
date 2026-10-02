# Registro de tarefas — Despachante

> Mantido pelo agente `despachante`. Estados permitidos (somente estes): `AGUARDANDO` · `EM EXECUÇÃO` · `AGUARDANDO DECISÃO DO MATHEUS` · `CONCLUÍDA` · `ERRO`.
> ID: `T-AAAAMMDD-NN`. Modo: `LEITURA` ou `ESCRITA`. Duas `ESCRITA` com área sobreposta nunca ficam `EM EXECUÇÃO` juntas.
> Sem dados pessoais de clientes, sem segredos. O histórico definitivo está no `git log` e em `docs/CHANGELOG_AI.md`.

| ID | Tarefa | Responsável | Auxiliares | Área | Modo | Status | Início | Resultado / Pendência |
|---|---|---|---|---|---|---|---|---|
| T-20261002-01 | (Simulação) Criticar visualmente o Financeiro | designer-crm | — | components/AdminFinancialDashboard.jsx | LEITURA | AGUARDANDO DECISÃO DO MATHEUS | 2026-10-02 | 3 melhorias listadas. Decisão: dashboard com 3 números + "Ver detalhes" (A) ou todos os cartões agrupados por tema (B)? Recomendado A. |
| T-20261002-02 | (Simulação) Mapear entrada do WhatsApp Chat | crm-editor | — | lib/whatsapp*, app/api/webhooks/whatsapp* | LEITURA | CONCLUÍDA | 2026-10-02 | Mapa entregue (só por nomes/doc, código não lido). Rota `whatsapp-master/events` sem papel confirmado. |
