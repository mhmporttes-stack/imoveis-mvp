# Guia de Atendimento (árvore de decisão ao lado do Chat)

Entregue em 2026-09-25. Ajuda o corretor a conduzir o atendimento: o cliente responde, o corretor escolhe a resposta no guia e vê **orientação interna**, **argumento sugerido**, **mensagem pronta** (botão *Copiar mensagem*) e as **próximas respostas possíveis**.

## Regra central (vale para todos os modelos)
OBJEÇÃO → INVESTIGAR → MOTIVO REAL → SOLUCIONAR → TESTAR ACEITAÇÃO → DOCUMENTAÇÃO → DATA DE RETORNO.
Sem promessas/afirmações financeiras; nunca encerrar com “me chama”/“fico aguardando”. Todo atendimento pendente termina em **próximo passo + data de retorno** (card `followup`, que cria a atividade na agenda existente: `POST /api/calendar-activities`).

## Onde fica
| O quê | Arquivo |
|---|---|
| Núcleo puro (grafo, portas, validação, origem→tipo, `[Nome]/[Corretor]/[Link]`, andador da árvore) | `lib/attendance-guide-core.mjs` (testes: `tests/attendance-guide-core.test.mjs`) |
| Geometria do mapa (igual à dos Fluxos) | `lib/attendance-guide-layout.mjs` |
| Servidor (CRUD rascunho/publicar, sessão do corretor, progresso) | `lib/attendance-guides.js` |
| Modelos iniciais (Prospecção, Lead, Orgânico, Banco de Objeções) | `lib/attendance-guide-seed*.mjs` (criados sozinhos na 1ª vez, tabela vazia) |
| API gestão (admin/gestor) | `app/api/admin/attendance-guides/**` |
| API do corretor | `GET/PUT/DELETE /api/admin/attendance-guides/session` |
| Telas | `/admin/guia-atendimento` (lista) e `/admin/guia-atendimento/[id]` (editor) |
| Painel ao lado do Chat | `components/guide/AttendanceGuidePanel.jsx` (usado em `components/WhatsappChat.jsx`) |
| Editor | `components/guide/GuideEditor.jsx`, `GuideNodePanel.jsx`, `guide-ui.jsx` — **reusa o canvas dos Fluxos** (`components/flows/FlowCanvas.jsx`, que recebe um `adapter`; o padrão é o dos Fluxos e não mudou) |

## Banco (migration `20260925100000_attendance_guides.sql`, aditiva)
- `attendance_guides`: `kind` (`prospecting|lead|organic|custom|library`), `enabled`, `graph` (rascunho) × `published_graph` (o que os corretores usam), `version`/`published_version`.
- `attendance_guide_progress`: progresso **por cliente** (`subject_key` = `client:<id>` ou `conv:<id>` enquanto não é cliente), único por (`subject_key`, `guide_id`).
- RLS ligada, só `service_role`.

## Como o guia certo abre (`classifyGuideKind`)
1. cliente com `prospecting_contact_id` → **Prospecção**;
2. conversa com `origin.kind='meta_ad'` ou origem de aquisição `whatsapp_ad|campaign|tracked_link|roulette_link` → **Lead**;
3. qualquer outro (site, link do corretor, cadastro manual, WhatsApp, indicação…) → **Orgânico**.
Se já existe progresso salvo para o cliente, abre o guia em que ele parou, no mesmo card. O corretor pode trocar de guia no seletor do painel.

## Banco de Objeções
Guia `kind='library'`. Cada objeção é um card marcado como **entrada**. Os outros guias a abrem por um card `ref` ("Abrir objeção"); quando o cliente aceita a solução, um nó `return` volta ao guia de origem no card ligado à saída *Ao voltar do tratamento* (ex.: Documentação). A pilha de chamadas fica em `state.stack`.

## Permissões
- Editar/publicar/ativar/excluir: só administrador geral e gestor (`requireBrokerManagementApi` + `assertGeneralAdminOrManager`).
- Usar: qualquer usuário com **acesso à conversa** (mesma verificação do Chat: `getConversationForGuide`).
- Alterar o editor **não** afeta os corretores até *Publicar*; *Desativar* tira o guia de circulação sem apagar nada.
