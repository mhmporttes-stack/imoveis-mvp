# Academia (treinamento dentro do CRM)

Estado: **F0 + F1 + F2** (experiência completa da F1 agora com **persistência real no Supabase**: conteúdo, matrícula, progresso, provas, tentativas e notas). Conteúdo e questões continuam sendo **texto de exemplo** até a F3. Plano completo: [`academia/PLANO_TECNICO.md`](academia/PLANO_TECNICO.md); repasse de design e contrato de dados: [`academia/HANDOFF_DESIGN.md`](academia/HANDOFF_DESIGN.md).

## Como ligar
Variável de ambiente `ACADEMIA_ENABLED` (`lib/academy-flags.js`; lida a cada requisição). Só `1`, `true` ou `on` ligam; ausente, vazia ou qualquer outro valor = **desligada** (padrão). Desligada: `/academia` responde 404 para sessão válida (o `proxy.js` antes disso redireciona ao login quem não tem cookie), o item "Academia" não aparece no menu e nada da Academia é montado no CRM. Ligar/desligar na Vercel exige `vercel env` (autorização do dono) e redeploy da env.

## F2 — persistência real (2026-10-04)
- **Banco** (migrations `20261004100000` a `20261004130000`, aplicadas em produção; 12 tabelas `academy_*` com RLS ligado e **sem policy**, `revoke` de `anon`/`authenticated`): `academy_tracks`, `academy_track_versions`, `academy_modules`, `academy_lessons` (conteúdo versionado; versão publicada imutável por trigger), `academy_enrollments`, `academy_lesson_progress`, `academy_events`, `academy_questions` (append-only, com gabarito), `academy_exams`, `academy_exam_questions`, `academy_exam_attempts`, `academy_attempt_answers`. Funções: `academy_record_attempt` (tentativa + respostas + conclusão da aula + evento, atômica, trava a matrícula e aplica o limite), `academy_complete_lesson` (aula sem prova), `academy_refresh_enrollment`, mais triggers de imutabilidade e de limite. Só `service_role` executa.
- **Seed** (`20261004130000_academy_seed_formacao_inicial.sql`): trilha "Formação Inicial" v1 publicada = a estrutura da F1 (6 módulos, 18 aulas, 18 questões de exemplo, 18 provas: 17 quizzes sem limite + a prova final com 3 tentativas). Não cria matrícula nem progresso.
- **Código**: `lib/academy-service.mjs` (regras: matrícula no primeiro acesso, desbloqueio, correção, limite, versão presa), `lib/academy-repo.mjs` (consultas), `lib/academy-server.js` (server-only), `lib/academy-access-core.mjs` (quem é o aluno; "Alterar conta" = leitura), `lib/academy-views.mjs` (snapshot compartilhado com o store de exemplo), `lib/academy-remote-store.mjs` (store do navegador: mesmo contrato do de exemplo). `app/academia/page.jsx` carrega o estado do próprio aluno; rotas `GET /api/admin/academia/me`, `POST .../exams/[examId]/attempts`, `POST .../lessons/[lessonId]/complete` (`requireAdminApi`, 404 com a chave desligada).
- **Regras aplicadas**: nota mínima 70% (comparação exata, 69,9% reprova); máximo de 3 tentativas por prova (quiz de aula: sem limite); gabarito/explicação só depois de aprovado; progresso isolado por usuário (`auth.profile.id`); histórico nunca apagado. Limite de tentativas esgotado: a tela mostra o aviso "fale com seu gestor"; **não há como liberar nova tentativa ainda** (decisão do dono pendente, ACA-2; entra com a gestão na F6).
- **Testes**: `tests/academy-*.test.mjs` (núcleo, serviço com banco falso que lê o esquema das migrations, store real) e `supabase/tests/academy_f2.sql` (Postgres de verdade: seed, imutabilidade, isolamento, limite, RLS, grants como `service_role`; termina em rollback; rodar só em banco local/de teste).
- **Ainda de exemplo/fora da F2**: texto das aulas e das questões, certificado real (F5), painel de edição/publicação (F3), atribuição e visão de equipe (F6), uma única questão por aula na interface.

## O que existe (F0/F1)
- Rota `/academia` (`app/academia/layout.jsx`: chave → `notFound()`; depois `requireAdminPage`; zoom liberado via `viewport`).
- Ramo `/academia` em `components/AppChrome.jsx` (sem Header/Footer/Pixel/botões do site; só PwaLifecycle + `AdminSessionKeeper`), `proxy.js` (matcher + login sem cookie), `public/sw.js` (`isPrivateRoute`).
- Menu: grupo "ACADEMIA" só com a chave ligada (`lib/academy-menu.mjs`, `components/AcademyMenuContext.jsx`, provider em `app/admin/layout.jsx`; `getAdminMenuGroups` aceita `academiaEnabled`, padrão `false`).
- Lógica pura: `lib/academy-core.mjs` (progresso, desbloqueio sequencial, concluir aula idempotente, correção, elegibilidade de certificado). Dados de exemplo: `lib/academy-sample.mjs` (7 tabelas do plano §2 em memória; 6 módulos / 18 aulas; 9 de 18 = 50%). Store: `lib/academy-sample-store.mjs` (snapshot imutável com as visões `home`, `trail`, `evolution`, `lesson`, `quiz`, `achievement`, `certificate`; formato documentado no topo do arquivo).
- Interface: `components/academia/**` (cena, telas, CSS Module com tokens escopados, fontes Fraunces/Manrope hospedadas em `components/academia/fonts/`, licença OFL).
- Vitrine sem login (só `next dev`): `app/dev/vitrine/academia/page.dev.jsx` (`?ate=N` conclui N aulas; `?rm=1` movimento reduzido). Não entra no `next build`.

## Permissões e "Alterar conta"
Os 4 perfis com sessão válida entram (`requireAdminPage`). **Edição e publicação de conteúdo: Admin e Gerente, direto, sem aprovação extra** (regra oficial de 2026-10-04, ACA-1; implementação na F3). Associados participam normalmente (ACA-9). Desde a F2 o progresso é real e por usuário (`auth.profile.id`). Em "Alterar conta" a Academia mostra o progresso do perfil escolhido em **somente leitura** (ACA-10): nenhuma matrícula, tentativa ou conclusão é gravada e a API responde 403. Perfil de contingência (sem linha em `admin_users`) também é somente leitura. A preferência "Reduzir movimento" usa `localStorage`.

## Limitações conhecidas
- O store de exemplo (vitrine/testes, `lib/academy-sample*.mjs`) ainda corrige no navegador e carrega o gabarito de exemplo; o fluxo real (F2) corrige só no servidor e o navegador nunca recebe o gabarito antes de aprovado.
- Fraunces, guindaste, orçamento de 150 KB (só a parte própria da Academia) e fontes ≈92 KB: **aprovados pelo dono em 2026-10-04** (ACA-3 a ACA-6). Decisões do dono registradas em `.claude/rules/academia.md` e `docs/BUSINESS_RULES.md` (ACA-1 a ACA-7); a nota mínima dos quizzes é 70% (ACA-2).
- Falta teste em iPhone real, DPR 2 e 1920 em tempo real (handoff §7).

## O que vem depois
F3: painel de edição/publicação de conteúdo (Admin e Gerente, ACA-1) e conteúdo real; F4: banco de questões e provas com várias questões na interface; F5: certificados; F6: gestão (equipe, liberar tentativa extra); F7: reciclagens e recomendações. O contrato do snapshot continua sendo a fronteira: a interface não muda.

## Decisões do dono (2026-10-04)
Registradas em `.claude/rules/academia.md` e `docs/BUSINESS_RULES.md` (ACA-1 a ACA-10): publicação direta por Admin e Gerente, 3 tentativas por prova, nota 70% em todas as provas, Formação Inicial obrigatória para novos, certificado só com 100% e nota mínima (verificação pública depois), histórico preservado e "Alterar conta" somente leitura. Aplicadas na F2: nota 70%, 3 tentativas por prova, histórico preservado, somente leitura em "Alterar conta"; as demais entram nas fases indicadas acima.
