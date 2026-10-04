# Academia (treinamento dentro do CRM)

Estado: **F0 + F1** (estrutura + experiência completa com **dados de exemplo em memória**). Sem banco, sem API, sem rede. Plano completo: [`academia/PLANO_TECNICO.md`](academia/PLANO_TECNICO.md); repasse de design e contrato de dados: [`academia/HANDOFF_DESIGN.md`](academia/HANDOFF_DESIGN.md).

## Como ligar
Variável de ambiente `ACADEMIA_ENABLED` (`lib/academy-flags.js`; lida a cada requisição). Só `1`, `true` ou `on` ligam; ausente, vazia ou qualquer outro valor = **desligada** (padrão). Desligada: `/academia` responde 404 para sessão válida (o `proxy.js` antes disso redireciona ao login quem não tem cookie), o item "Academia" não aparece no menu e nada da Academia é montado no CRM. Ligar/desligar na Vercel exige `vercel env` (autorização do dono) e redeploy da env.

## O que existe (F0/F1)
- Rota `/academia` (`app/academia/layout.jsx`: chave → `notFound()`; depois `requireAdminPage`; zoom liberado via `viewport`). Sem API nova, sem tabela nova.
- Ramo `/academia` em `components/AppChrome.jsx` (sem Header/Footer/Pixel/botões do site; só PwaLifecycle + `AdminSessionKeeper`), `proxy.js` (matcher + login sem cookie), `public/sw.js` (`isPrivateRoute`).
- Menu: grupo "ACADEMIA" só com a chave ligada (`lib/academy-menu.mjs`, `components/AcademyMenuContext.jsx`, provider em `app/admin/layout.jsx`; `getAdminMenuGroups` aceita `academiaEnabled`, padrão `false`).
- Lógica pura: `lib/academy-core.mjs` (progresso, desbloqueio sequencial, concluir aula idempotente, correção, elegibilidade de certificado). Dados de exemplo: `lib/academy-sample.mjs` (7 tabelas do plano §2 em memória; 6 módulos / 18 aulas; 9 de 18 = 50%). Store: `lib/academy-sample-store.mjs` (snapshot imutável com as visões `home`, `trail`, `evolution`, `lesson`, `quiz`, `achievement`, `certificate`; formato documentado no topo do arquivo).
- Interface: `components/academia/**` (cena, telas, CSS Module com tokens escopados, fontes Fraunces/Manrope hospedadas em `components/academia/fonts/`, licença OFL).
- Vitrine sem login (só `next dev`): `app/dev/vitrine/academia/page.dev.jsx` (`?ate=N` conclui N aulas; `?rm=1` movimento reduzido). Não entra no `next build`.

## Permissões e "Alterar conta"
Os 4 perfis com sessão válida entram (`requireAdminPage`). A decisão por perfil (associado, gestão, edição) fica para a F2+ (plano §3). Na F1 não há escrita real: tudo é exemplo na memória da página (reinicia ao recarregar; só a preferência "Reduzir movimento" usa `localStorage`). Em "Alterar conta" a Academia se comporta igual (leitura de exemplo); o bloqueio de escrita em view-as é regra da F2 (plano §1, decisão do dono pendente).

## Limitações conhecidas da F1
- O gabarito dos exemplos (`SAMPLE_QUESTIONS`) está no bundle do navegador porque a correção roda no cliente. Só existe com dado de exemplo; na F2 a correção passa ao servidor e o gabarito nunca vai ao cliente.
- Fraunces é fonte nova (plano §8 item 7): confirmar com o dono.
- Falta teste em iPhone real, DPR 2 e 1920 em tempo real (handoff §7).

## O que a F2 troca
`lib/academy-sample*.mjs` por leitura/escrita no banco (`academy_*`, migrations 14 dígitos), rotas `app/api/admin/academia/**` com guard e escopo (registrar em `PERMISSIONS.md` §6), progresso real do próprio corretor, bloqueio de escrita em "Alterar conta". O formato do snapshot é o contrato: a interface não muda.
