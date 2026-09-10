# Matheus Machado Imóveis: documentação para desenvolvedores

Referência: 08/09/2026. Documento elaborado a partir do código local, estrutura do banco consultada e histórico de implementação. Não é uma certificação de segurança nem substitui a leitura do código e do schema efetivamente implantados. Não contém credenciais, senhas, tokens ou dados de clientes.

## 1. O que é o sistema

O produto combina um site imobiliário público com uma plataforma interna de operação comercial. O site apresenta imóveis e empreendimentos, recebe interessados em financiamento e capta imóveis para venda. O painel reúne CRM, cadastro de usuários, agenda, prospecção, distribuição automática de leads, automações, relatórios, financeiro e apresentações comerciais personalizadas.

Há quatro categorias de usuário: administrador, gestor, corretor e associado. O funcionamento depende tanto da categoria quanto dos vínculos de equipe e do responsável por cada cadastro.

O aplicativo instalado no celular é uma PWA do mesmo projeto web, não um aplicativo nativo separado. Desktop e mobile compartilham componentes, APIs e banco.

## 2. Localização e infraestrutura

Pasta principal do projeto nesta máquina:

```text
C:\Users\User\Documents\Codex\2026-07-08\spreadsheets-plugin-spreadsheets-openai-primary-runtime-2\outputs\imoveis-mvp
```

- Domínio habitual: https://www.matheusmachadoimoveis.com.br
- Também utilizado: https://matheusmachadoimoveis.com.br
- Endereço estável da Vercel: https://imoveis-mvp.vercel.app
- Hospedagem: Vercel, projeto `imoveis-mvp`.
- Banco de produção: PostgreSQL no Supabase, projeto `tshhasbbchjcvhoyizoo`, região `us-west-2`, PostgreSQL 17 conforme consulta desta data.
- Autenticação: Supabase Auth.
- Arquivos de mídia: integração com Supabase Storage; alguns campos históricos também comportam URLs ou dados de mídia embutidos.
- Código versionado com Git; verificar remotos e alterações locais antes de trabalhar.

Os endereços temporários `imoveis-<identificador>-...vercel.app` pertencem a deployments específicos. Não devem ser usados como endereço comercial permanente. Cookies são vinculados ao host; trocar de domínio pode exigir novo login.

Ter apenas a pasta de código não equivale a ter um backup completo: dados, usuários de autenticação, arquivos do Storage, configurações de produção e jobs também precisam ser preservados.

## 3. Tecnologias

Versões declaradas no `package.json`:

| Tecnologia | Versão / uso |
|---|---|
| Next.js | 16.2.10, App Router |
| React / React DOM | 19.2.7 |
| JavaScript | ES Modules, componentes JSX e bibliotecas JS |
| TypeScript | ^5.9.3, utilizado especialmente no motor de entrada |
| Tailwind CSS | 3.4.19 |
| PostCSS / Autoprefixer | ^8.4.49 / ^10.4.20 |
| Supabase JS | ^2.110.1 |
| Zod | ^4.4.3, validação de dados |
| Lucide React | 1.23.0, ícones |
| XLSX | 0.18.5, recursos de planilhas |
| pnpm | Gerenciador utilizado, com lockfile no repositório |

Produções recentes foram compiladas com pnpm 10 na Vercel; ferramentas locais também podem resolver outra versão. O `package.json` não fixa `packageManager`. Reproduzir o ambiente do lockfile antes de atualizar dependências. A CLI de publicação foi utilizada com Node 24.19.0; isso não constitui declaração da versão efetiva de todos os runtimes de produção.

O projeto mantém suporte local legado a SQLite em `lib/db.js` e `lib/backup.js`. Em Vercel, `lib/runtime.js` desativa o banco local. O README original enfatiza SQLite e está incompleto em relação à produção atual.

## 4. Organização do código

```text
app/                          Rotas, layouts e páginas do Next.js
  admin/                      Painel autenticado
  api/                        Route Handlers do backend
  simulacao/                  Formulário público e entrada da equipe
  empreendimentos/            Páginas públicas individuais
  manifest.js                 Manifest da PWA
components/                   Componentes de interface
  simulation-form/            Formulário público de simulação
lib/                          Acesso a dados, autenticação, regras e utilitários
  simulacao-entrada/           Motor ativo de cálculo de entrada
supabase/                     Schema, migrations e testes SQL
public/                       Imagens, ícones, service worker e página offline
mcmv-calculator/              Pacote de referência, exemplos e motor anterior
proxy.js                      Verificação inicial de cookies e cache
package.json                  Dependências e comandos
pnpm-lock.yaml                Resolução de dependências
```

Arquivos centrais:

| Arquivo | Responsabilidade |
|---|---|
| `components/AdminMenu.jsx` | Categorias e links por perfil |
| `components/AdminSectionNav.jsx` | Navegação compartilhada, links pessoais, indicadores |
| `components/AdminSimulationList.jsx` | Lista do CRM, busca, filtros, status, tags e responsável |
| `components/SimulationGenerator.jsx` | Edição e geração de simulações |
| `components/EmpreendimentoPresentation.jsx` | Apresentação comercial personalizada |
| `components/EmpreendimentoAdminTabs.jsx` | Dados do empreendimento e regras de entrada |
| `components/EmpreendimentoRegrasEntradaForm.jsx` | Configuração dos cálculos por empreendimento |
| `components/AdminUsersManager.jsx` | Cadastro e edição dos usuários |
| `components/AdminFinancialDashboard.jsx` | Interface financeira e diferenças por perfil |
| `components/LeadDistributionDashboard.jsx` | Fila da roleta e histórico |
| `components/PropertyForm.jsx` | Cadastro imobiliário e de empreendimentos |
| `lib/admin-auth.js` | Sessão, refresh, guards e conta efetiva |
| `lib/admin-profiles.js` | Perfis, vínculos, referências dos links pessoais |
| `lib/admin-access.js` | Escopo por responsável e validação de acesso |
| `lib/simulation-registrations.js` | Persistência dos cadastros e atribuição |
| `lib/simulation-registration-schema.js` | Validação e normalização do formulário |
| `lib/simulations.js` | Persistência das simulações |
| `lib/financial.js` | Vendas, despesas, recebimentos e escopo financeiro |
| `lib/financial-calculations.js` | Distribuição das comissões em centavos |
| `lib/crm-automations.js` | Avaliação e execução das regras automáticas |
| `lib/calendar-activities.js` | Agenda individual |
| `lib/prospecting.js` | Operações de prospecção |
| `lib/whatsapp-master.js` | Integração de WhatsApp |
```

## 5. Área pública e rotas

| Rota | Finalidade |
|---|---|
| `/` | Site e portfólio público |
| `/empreendimentos/[id]` | Página pública individual |
| `/simulacao` | Formulário de interesse em financiamento |
| `/simulacao?ref=<referencia>` | Formulário com atribuição ao dono do link |
| `/simulacao/equipe` | Entrada pública da roleta |
| `/simulacao?ref=equipe` | Referência de distribuição reconhecida pelo backend |
| `/captacao` | Captação pública |
| `/captacao?ref=<referencia>` | Captação vinculada a usuário |
| `/venda-seu-imovel` | Página pública de captação |
| `/politica-de-privacidade` | Política de privacidade |

O cadastro público coleta, entre outros campos: nome, telefone, data de nascimento, simulação individual ou conjunta, tipo de renda, renda mensal, estado civil, tempo de registro, dependentes, imóvel residencial e recursos disponíveis. Uma etapa de preferências permite registrar características desejadas do imóvel.

`SimulationForm.jsx` lê `ref` da URL e envia `brokerRef` no corpo do POST. O backend resolve essa referência em `admin_users`; o rótulo visível no menu não determina a atribuição.

## 6. Rotas do painel e organização dos menus

| Rota | Uso |
|---|---|
| `/admin/login` | Login |
| `/admin/reset-password` | Recuperação de acesso |
| `/admin/simulacoes` | Lista principal de clientes |
| `/admin/simulacoes/nova` | Cadastro manual / nova simulação |
| `/admin/simulacoes/[id]` | Edição da simulação |
| `/admin/simulacoes/[id]/empreendimentos` | Apresentação de empreendimentos para o cliente |
| `/admin/cadastros` e `/admin/cadastros/[id]` | Cadastros de simulação |
| `/admin/calendario` | Agenda |
| `/admin/prospeccao` | Prospecção |
| `/admin` | Administração dos imóveis |
| `/admin?area=gestao` | Administração dos empreendimentos |
| `/admin/novo` | Cadastro de imóvel |
| `/admin/empreendimentos` | Catálogo interno de empreendimentos publicados |
| `/admin/empreendimentos/consulta/[id]` | Consulta interna do produto |
| `/admin/empreendimentos/novo` | Novo empreendimento |
| `/admin/empreendimentos/[id]?aba=regras` | Edição das regras e valores |
| `/admin/captacoes` e `/admin/captacoes/[id]` | Captações |
| `/admin/depoimentos` | Depoimentos |
| `/admin/corretores` | Usuários e alteração de conta |
| `/admin/automacoes` | Regras e roleta |
| `/admin/desempenho` | Visão de desempenho |
| `/admin/relatorio-diario` | Relatório diário |
| `/admin/financeiro` | Financeiro |
| `/admin/notificacoes` | Notificações existentes |
| `/admin/whatsapp-master` | Configuração da integração de WhatsApp |

O menu do administrador usa CRM, CADASTROS e GESTÃO. Corretores e associados usam CRM, CADASTROS e DESEMPENHO, com opções conforme o perfil. Gestores possuem sua própria composição, incluindo acesso a empreendimentos e desempenho. O catálogo interno de CRM não é a mesma tela que o cadastro administrativo de empreendimentos.

Gestores ganharam um atalho em Cadastros para a lista administrativa dos empreendimentos. Esse atalho ainda leva à rota `?area=gestao`, portanto a categoria ativa pode passar a Gestão após a navegação.

## 7. Perfis e autorização

| Perfil | Regra funcional pretendida e base implementada |
|---|---|
| Administrador | Administração geral e visão global; proprietário possui tratamento especial por e-mail |
| Gestor | Dados próprios e dos integrantes vinculados à sua equipe; financeiro e valores dos empreendimentos conforme guards |
| Corretor | Clientes próprios e financeiro próprio |
| Associado | Clientes próprios e do corretor ao qual está vinculado; visão financeira adaptada |

Campos importantes de `admin_users`: `id`, `auth_user_id`, `role`, `status`, `manager_id`, `linked_broker_id`, `simulation_ref`, `captacao_ref`, percentuais e configuração da distribuição de leads.

O escopo de gestor é montado em `attachDataAccessScope`: inclui o próprio gestor, subordinados diretos e associados vinculados aos corretores subordinados. A lista resultante chega como `managedUserIds` ao backend.

`applyResponsibleUserScope` filtra consultas por `responsible_user_id`. `assertCanAccessResponsibleUser` valida operações individuais. A filtragem visual nunca deve substituir essas verificações do servidor.

Solicitações funcionais preservadas: gestor vê o responsável, filtra por corretor e transfere clientes dentro da equipe; associado pode modificar status e tags dos clientes acessíveis; tarefas de agenda pertencem ao usuário que as cria.

Ponto para revisão específica de segurança: a atualização de responsável em `updateSimulationRegistration` atualmente utiliza `assertCanAccessResponsibleUser` para o destino. Essa função também aceita os IDs permitidos a corretores/associados. A interface só mostra o seletor a admin/gestor, mas é necessário distinguir permissão de visualizar de permissão de transferir ao revisar chamadas diretas à API. Não considerar o menu como barreira de autorização.

Não houve auditoria completa de todas as APIs nesta documentação. Também é importante revisar configurações que vinculem um administrador como subordinado de gestor: a construção de equipe deve respeitar a regra de privacidade do proprietário.

## 8. Autenticação e Alterar conta

O login e a renovação de sessão utilizam Supabase Auth. Cookies usados pelo painel:

- `mm_admin_access_token`: cookie de acesso, duração configurada de uma hora.
- `mm_admin_refresh_token`: renovação, duração configurada de sete dias.
- `mm_admin_view_as`: seleção de conta efetiva.

Cookies são HttpOnly, SameSite=Lax e Secure em HTTPS/produção. O `proxy.js` verifica presença de sessão antes de abrir áreas restritas e aplica `no-store` ao painel e às APIs. A autenticação real é verificada pelos guards, incluindo consulta do usuário no Supabase.

O recurso chamado na interface de Alterar conta ainda usa nomes internos antigos: `AdminViewAsSelector`, `/api/admin/view-as`, `applyViewAsProfile` e `mm_admin_view_as`. Não interpretar esses nomes como garantia de modo somente leitura.

O administrador real permanece autenticado, enquanto o contexto efetivo passa a usar o perfil selecionado; `realUser`, `realProfile` e `accountSwitchMode` preservam a distinção. Não se trata de obter a senha do outro usuário nem de iniciar uma sessão Supabase independente para ele. POST/DELETE dessa rota exigem administrador real.

## 9. CRM, clientes e histórico

A lista principal reúne registros de `simulation_registrations` e `simulations`. Há busca, paginação, filtros de responsável, tags, pendências, status e etapas comerciais.

Etapas visíveis incluem Todos, Atendimentos, Simulação, Documentação, Aprovação, Venda e Arquivados, além de estados específicos. O enum e o agrupamento completos estão em `lib/client-status.js` e `AdminSimulationList.jsx`.

O estado interno `simulation_sent` continua existindo, embora o botão específico Simulação enviada tenha sido removido da apresentação do submenu.

Ações incluem abrir apresentação, editar cadastro, agendar, abrir WhatsApp, alterar status, aplicar tags, excluir e trocar responsável quando autorizado. O clique de WhatsApp chama uma API para registrar o contato antes de abrir o link externo. Isso registra uma ação do usuário; não comprova que uma conversa ou mensagem foi efetivamente enviada.

Datas relevantes: criação técnica do registro, nascimento, início do atendimento, conclusão da venda, último contato e histórico de status. Clientes antigos podem ser lançados com datas comerciais anteriores; não confundir essas datas com `created_at`.

## 10. Links pessoais e roleta

Os links são construídos em `buildBrokerSimulationLink` e `buildBrokerCaptacaoLink`, usando referências do perfil e `getSiteBaseUrl`.

Fluxo pessoal:

1. Formulário envia a referência da URL.
2. Backend busca usuário ativo por `simulation_ref` ou `captacao_ref`.
3. O registro recebe o ID desse usuário como responsável.
4. O cadastro pessoal não recebe a marca `round_robin`.

Isso também se aplica ao gestor: os cadastros do link pessoal pertencem ao próprio gestor, não são distribuídos para sua equipe automaticamente.

Fluxo de equipe:

1. Referência `equipe` aciona a função PostgreSQL `assign_round_robin_lead`.
2. A função escolhe usuário ativo com distribuição habilitada, considerando a fila.
3. O registro recebe `distribution_type = 'round_robin'`.
4. Há histórico de entrada e transferência em `lead_distribution_history`.
5. O recebedor vai para o fim da fila; as operações usam bloqueio transacional na função do banco.

A regra solicitada é transferência contínua a cada 10 minutos sem clique de contato no WhatsApp, apenas para origem roleta. O código verifica origem e último contato; o atraso efetivo depende da regra configurada e da execução do agendador. A periodicidade de produção precisa ser conferida no banco e no job, não apenas no JavaScript.

### Incidente de telefone repetido, corrigido em 08/09/2026

Uma migration de 05/09 criou `simulation_registrations_phone_normalized_unique`. Ela passou a impedir novo cadastro com telefone existente, contrariando a regra de permitir novo atendimento, inclusive com outro corretor.

Os logs de produção confirmaram violação desse índice no envio de Luana. O formatador de erro convertia qualquer mensagem contendo o nome da tabela em instrução de criar tabela inexistente.

Correções: remoção do índice UNIQUE, manutenção do índice comum de busca e tratamento separado de erros de duplicidade, validação e chave estrangeira. A migration corretiva está em `supabase/migrations/20260908204500_allow_repeat_simulation_phone.sql`.

Não recriar exclusividade por telefone. Um telefone pode ter vários registros; identidade do cadastro é seu ID. Rotinas que agrupem por telefone precisam ser revisadas para não fundir atendimentos distintos.

Verificação realizada: abertura HTTP dos oito links pessoais ativos e da roleta; dois INSERTs com mesmo telefone por usuário e três atribuições de roleta em transação desfeita. Isso verificou banco e atribuição, sem enviar notificações nem deixar clientes de teste. Não foi um teste de preenchimento visual completo de cada formulário no navegador. Teste SQL preservado em `supabase/tests/repeat_simulation_phone.sql`.

## 11. Imóveis, empreendimentos e moderação

`properties` guarda o conteúdo imobiliário. `isDevelopment` no modelo da aplicação diferencia empreendimento de imóvel comum. Essa separação é essencial: uma tela não deve apenas mudar o título e continuar listando os mesmos registros.

`empreendimentos` guarda as regras comerciais de cálculo em JSON, vinculadas pelo mesmo ID do produto. `lib/simulacao-entrada/repository.js` lê e salva essa configuração.

O cadastro suporta dados comerciais, construtora, localização, características, fotos, materiais, e-book/catálogo, publicação e informações internas. A apresentação interna deve permanecer separada da página pública para impedir exposição de informações de negociação.

Corretores podem cadastrar imóveis e depoimentos; a publicação deve passar por moderação de administrador ou gestor. Conferir `canPublish`, páginas e endpoints de publicação ao alterar esse fluxo. Captações possuem operações próprias.

Admin e gestor podem editar regras de entrada em `/admin/empreendimentos/[id]?aba=regras`. GET e PUT de `/api/empreendimentos/[id]` usam o guard `requireFinancialManagerApi`.

## 12. Simulação e apresentação de entrada

Motor em uso:

- `lib/simulacao-entrada/types.ts`: contratos.
- `lib/simulacao-entrada/calculator.ts`: cálculo.
- `lib/simulacao-entrada/repository.js`: persistência.
- `/api/simular-entrada`: cálculo no servidor.

A pasta `mcmv-calculator` contém exemplos, SQL e outra versão do motor; não é a importação usada pela API atual. Alterações feitas apenas nela não corrigem a produção.

Dados de entrada: valor do imóvel, descontos cadastrados, financiamento aprovado, subsídio MCMV, Casa Paulista, recursos/FGTS, renda e condições específicas do empreendimento.

Ordem geral:

```text
valor final = valor cheio - descontos do imóvel
cobertura = financiamento aprovado + subsídio MCMV + Casa Paulista aceito
entrada = max(0, valor final - cobertura)+saldo após recursos = max(0, entrada - FGTS/recursos disponíveis)
excedente ao limite parcelável -> ato
saldo parcelável -> prazo, juros e limites das parcelas
```

Modelos implementados: ATO + parcelas; período de obra + pós-obra + balões; tabela de condições. Existe alternativa de engenharia quando configurada.

A regra de ATO + parcelas considera limite parcelável, número máximo, preferência manual, parcela mínima, parcela máxima e juros mensais. Nos blocos com juros, há cálculo de prestação por fator financeiro; no caso sem juros, divisão do principal pelo prazo.

O motor procura prazo válido respeitando a parcela mínima já com juros. Ao aumentar o ato manual, o saldo precisa ter prazo e juros recalculados. Caso validado: entrada de R$ 28.811,00, ato de R$ 20.000,00, saldo de R$ 8.811,00, taxa de 0,89% e mínimo de R$ 500,00 produz 19 parcelas de aproximadamente R$ 506,11.

Não confundir limite do principal parcelável com soma das prestações acrescidas de juros. A aplicação preserva o principal em `valorParcela * parcelas` e pode expor a prestação com juros em `valorParcelaComJuros`.

Apresentação ao cliente:

- Troca de empreendimento altera os resultados.
- Valor cheio em destaque; descontos e benefícios discriminados.
- Subsídio MCMV de zero não deve aparecer.
- Documentação gratuita equivale a 5% do valor cheio, exibida como benefício quando configurada.
- Total visual de descontos e benefícios soma descontos, subsídio, Casa Paulista e documentação gratuita; não deve ser abatido novamente do principal, pois isso duplicaria benefícios.
- A documentação gratuita é economia de custo externo; o cálculo principal não a subtrai automaticamente do preço do imóvel.
- Ato e prazo são editáveis; aplicação ocorre por Recalcular valores.
- Prazo digitado é sincronizado com o prazo calculado após a resposta.
- Recursos de FGTS/entrada são considerados automaticamente; o checkbox foi removido.
- Primeira e última prestação do financiamento são exibidas a partir da simulação; não são as parcelas da entrada.
- Fotos alternam a cada cinco segundos; há avanço manual e ampliação.
- Há e-book quando cadastrado e link de localização para Google Maps.

Pontos de atenção: a apresentação atualmente prepara Casa Paulista com valor de R$ 10.000,00 e o aplica quando o empreendimento aceita. Isso é regra do produto implementada, não consulta automática de elegibilidade a programa público. A localização usa busca por texto de localização/nome, não necessariamente coordenadas verificadas.

## 13. Financeiro

Dados principais: venda/VGV, data da venda, percentual e comissão bruta, despesas, repasses, recebimentos e status. Estados de venda financeira: pendente, parcial, recebido e cancelado. Recebimentos possuem previsto, recebido, atrasado e cancelado.

Cálculo básico em `lib/financial.js`:

```text
dedução por nota = comissão bruta * 15%, se invoiceIssued
comissão livre = max(0, comissão bruta - dedução - despesas)
a receber = max(0, comissão livre - recebido)
```

O controle Gerar nota/nota emitida é identificado no código como `invoiceIssued`. Não foi identificada nesta revisão integração fiscal com prefeitura ou emissão oficial de NFS-e. Não descrevê-lo como emissão fiscal automática sem implementar e comprovar essa integração.

Distribuição em `financial-calculations.js`: comissão de gestor, quando habilitada, sai primeiro da comissão livre; o saldo é dividido entre corretor e imobiliária. Percentuais de corretor e imobiliária precisam totalizar 100%. O cálculo usa centavos para controlar arredondamento.

A visão de associado é produzida no servidor por `toAssociateFinancialView`: 10% da comissão livre e 10% dos recebimentos, com despesas e participação imobiliária/gestor ocultadas na projeção. O percentual de 10% está fixo no código nessa transformação, não é uma regra totalmente configurável por usuário.

A regra solicitada para Benck é participação nas vendas do corretor vinculado, exibindo apenas os ganhos relevantes. A transformação atual se aplica à visão financeira de associado; não presumir que todos os cenários de venda própria e múltiplas participações foram modelados separadamente.

Há criação automática de venda ao entrar em determinados status comerciais, tanto por código quanto por trigger do banco. Ao manter essa integração, preservar a prevenção de duplicidade por cliente em `financial_sales`.

## 14. Agenda, prospecção e automações

Agenda: `calendar_activities`, com responsável, cliente opcional, título, tipo, prioridade, data, status, conclusão e reagendamento. Listagem e criação usam o usuário efetivo atual. O usuário pode escolher clientes dentro de seu escopo, mas a atividade pertence a ele.

Também existem campos históricos de atividade em `simulation_registrations`. Não considerar que a agenda nova e todos os agendamentos legados são a mesma estrutura.

Prospecção: fila de contatos, assumir atendimento, tentativas, indisponibilidade temporária, devolução, não contactar, importação/operações em lote e atribuição administrativa. Arquivos principais: `lib/prospecting.js`, `lib/prospecting-auto-return.js` e `components/ProspectingManager.jsx`.

Automações: regras configuráveis, gatilhos, atrasos, ações, notificações e histórico de execução. A rotina `runCrmAutomations` é chamada pelo endpoint `/api/cron/scheduled-activities`, que também processa notificações agendadas.

O endpoint de cron valida bearer token com `CRON_SECRET` ou hash de token do Supabase. Há migrations de agendamento no banco. Não há `vercel.json` na raiz consultada nesta data; não presumir que a existência do endpoint signifique cron Vercel ativo.

## 15. Banco de dados

Tabelas públicas confirmadas na consulta de 08/09/2026:

| Grupo | Tabelas |
|---|---|
| Usuários | `admin_users` |
| Catálogo | `properties`, `empreendimentos`, `testimonials`, `captacoes`, `leads` |
| CRM e simulações | `simulation_registrations`, `simulations`, `simulation_properties`, `simulation_property_benefits` |
| Status e tags | `client_status_history`, `tags`, `client_tags` |
| Agenda | `calendar_activities` |
| Automação | `crm_automation_rules`, `crm_automation_executions`, `crm_notifications`, `crm_settings` |
| Distribuição | `lead_distribution_state`, `lead_distribution_history` |
| Prospecção | `prospecting_contacts`, `prospecting_history` |
| Financeiro | `financial_sales`, `financial_expenses`, `financial_payments` |
| WhatsApp | `whatsapp_master_events` |

Relações importantes: responsável do cadastro aponta para `admin_users`; venda financeira aponta para cliente; despesas e pagamentos apontam para venda; tags ligam-se ao cadastro por tabela associativa; simulações e produtos têm relações próprias.

As migrations são incrementais e incluem funções, triggers, índices e permissões. O schema inicial sozinho não representa o sistema atual. Nomes de arquivos antigos usam formatos de data variados. Antes de reinstalar ou sincronizar, comparar o histórico remoto com o local; não reaplicar indiscriminadamente migrations antigas, principalmente a que criava telefone único.

A chave administrativa do Supabase é usada no servidor. Por isso, controles de escopo na aplicação são críticos mesmo quando existem políticas RLS. Não enviar essa chave para o browser. Para handoff completo, exportar separadamente schema, funções, triggers, políticas, jobs e backups de dados por processo autorizado.

## 16. APIs por domínio

| Prefixo / rota | Função |
|---|---|
| `/api/admin/session` | Sessão |
| `/api/admin/view-as` | Alteração de conta efetiva |
| `/api/admin-users` | Usuários |
| `/api/properties` | Imóveis e empreendimentos |
| `/api/empreendimentos/[id]` | Regras de entrada |
| `/api/simular-entrada` | Cálculo de apresentação |
| `/api/simulation-registrations` | Recepção pública de cadastros |
| `/api/simulation-registrations/manual` | Cadastro manual |
| `/api/simulation-registrations/[id]` | Alteração/exclusão |
| Sufixos `/preferences`, `/tags`, `/whatsapp-contact` | Preferências, tags e registro de contato |
| `/api/simulations` | Simulações |
| `/api/financeiro` | Financeiro |
| `/api/calendar-activities` | Agenda |
| `/api/daily-report` | Relatório diário |
| `/api/prospecting` | Prospecção e operações de fila/lote |
| `/api/lead-distribution` | Roleta |
| `/api/crm-automation-rules` | Regras automáticas |
| `/api/crm-notifications/[id]` | Notificações |
| `/api/client-tags` | Tags |
| `/api/captacoes`, `/api/testimonials` | Captações e depoimentos, incluindo publicação |
| `/api/leads` | Leads públicos |
| `/api/uploads/*` | Mídia |
| `/api/analyze` | Extração assistida de dados de texto/URL |
| `/api/crm-settings/whatsapp-master` | Configuração da integração |
| `/api/webhooks/whatsapp-master` | Webhook do WhatsApp |
| `/api/cron/scheduled-activities` | Processamento agendado |

Consultar cada `route.js` para métodos, payloads, validação e guard. Nem todas as APIs são públicas; a abertura de uma página não define a autorização de um endpoint.

## 17. Integrações e configuração

Variáveis encontradas no código, somente nomes:

```text
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
SUPABASE_TESTIMONIALS_BUCKET
ADMIN_EMAIL
ADMIN_EMAILS
ADMIN_OWNER_EMAILS
APP_SECRET
ENABLE_SQLITE
CRON_SECRET
SUPABASE_CRON_TOKEN_HASH
RESEND_API_KEY
RESEND_FROM_EMAIL
SIMULATION_NOTIFICATION_EMAIL
CAPTACAO_NOTIFICATION_EMAIL
OPENAI_API_KEY
OPENAI_MODEL
WHATSAPP_ACCESS_TOKEN
WHATSAPP_APP_SECRET
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_DISPLAY_PHONE_NUMBER
WHATSAPP_GRAPH_API_VERSION
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_REMINDER_TEMPLATE_LANGUAGE
WHATSAPP_REMINDER_TEMPLATE_NAME
WHATSAPP_WEBHOOK_VERIFY_TOKEN
VERCEL
VERCEL_URL
VERCEL_PROJECT_PRODUCTION_URL
```

Existência de código de integração não comprova credencial ativa, entrega de mensagens ou configuração externa atual. Resend é utilizado nas notificações por e-mail. A integração de WhatsApp utiliza a API da Meta e templates/configurações. OpenAI é opcional na análise de conteúdo: sem chave, o endpoint tem extração heurística.

Não entregar `.env`, cookies, chaves administrativas ou exportações de clientes em documento público. Conceder acessos de Vercel, Supabase, domínio e integrações diretamente ao desenvolvedor responsável, conforme o trabalho contratado.

## 18. PWA e interface

`app/manifest.js` define nome Painel Matheus, modo standalone, ícones e entrada `/admin/simulacoes`. `public/sw.js` e `public/offline.html` compõem o suporte à PWA. Não presumir funcionamento offline de operações autenticadas ou sincronização offline de dados.

Identidade visual: português do Brasil, azul institucional, fundos claros, tipografia forte, navegação por categorias e controles responsivos. Datas e horários usam utilitários com referência a America/Sao_Paulo; valores monetários usam BRL e separadores brasileiros.

Mudanças em componentes compartilhados afetam desktop e mobile. Para alterações exclusivas de app/mobile, verificar breakpoints, manifest, service worker e redirecionamentos de login sem alterar os deep links.

## 19. Desenvolvimento, publicação e testes

Comandos declarados:

```powershell
pnpm install
pnpm dev
pnpm build
pnpm start
```

`pnpm dev` normalmente usa porta 3000. Configurar ambiente local com valores adequados e não fazer testes de escrita em produção por padrão.

Publicação utilizada neste projeto:

```powershell
pnpm dlx vercel --prod --yes
```

`.vercel/project.json` identifica o vínculo local; conferir a conta e o projeto antes de publicar. Uma publicação precisa chegar a READY e ser associada ao domínio de produção. Build local bem-sucedido não significa que o site já recebeu o código.

O `package.json` não tem scripts próprios de lint ou suíte geral de testes. Há testes pontuais, como `lib/financial-calculations.test.js`, e teste SQL para telefone repetido. O build executa compilação e verificação TypeScript, mas não certifica todos os fluxos nem permissões.

Validações recomendadas conforme a alteração: login/refresh, entrada PWA, escopo dos quatro perfis, alteração de conta, cadastro por referência, repetição de telefone, roleta sem consumir fila real em testes, aprovação de conteúdo, status/tags, agenda individual, cálculos de entrada e comissão.

Regressões prioritárias para o motor: ato zero, ato manual, excedente automático, máximo de parcelas, mínimo com e sem juros, quitação integral, descontos/subsídios sem contagem dupla e troca entre empreendimentos com regras distintas.

## 20. Limitações e cuidados de manutenção

1. O README legado não descreve todo o sistema; usar esta referência com o código atual.
2. Não confundir `properties` com as regras JSON da tabela `empreendimentos`.
3. Não corrigir somente o motor de exemplo `mcmv-calculator`.
4. Não criar UNIQUE por telefone nem deduplicar atendimentos automaticamente sem rever a regra comercial.
5. Permissões precisam estar no backend, além de menus e botões.
6. Há e-mails do proprietário e perfis de fallback fixos em bibliotecas; alterações de titularidade exigem revisão explícita.
7. O recurso Alterar conta reutiliza nomes de Visualizar como; ele não é simplesmente uma tela de auditoria somente leitura.
8. O associado recebe projeção fixa de 10% no financeiro; futuras exceções exigem modelagem própria.
9. O total visual de descontos e benefícios não equivale integralmente a redução do preço do imóvel.
10. A automação de contato considera o clique no WhatsApp; não confirma conversa realizada.
11. As operações de criação de cadastro, simulação pendente e notificações não formam uma única transação. O cadastro pode existir mesmo se uma etapa secundária falhar.
12. Na entrada de roleta, a atribuição RPC ocorre antes do INSERT do cliente em chamada separada; uma falha posterior pode avançar a fila sem concluir o cadastro. Atomicidade e idempotência são pontos de evolução, não garantias já implementadas.
13. A detecção de erro foi melhorada para o incidente de duplicidade, mas outras mensagens de schema ainda possuem tratamento legado e merecem revisão específica.
14. Histórico local de migrations e remoto deve ser reconciliado antes de reconstruir um ambiente.
15. Integrações de banco, domínio, Storage, Auth, cron e mensagens não são transferidas automaticamente ao copiar a pasta.

## 21. Entrega ao próximo desenvolvedor

Entregar o repositório completo, este documento e acesso autorizado às plataformas. Não são necessários `node_modules` nem `.next`: podem ser recriados. Não excluir os arquivos de configuração, lockfile, migrations, testes, assets ou documentação.

Solicitar ao desenvolvedor um inventário inicial do estado do Git, schema remoto e jobs, confirmação das variáveis necessárias sem expor seus valores, ambiente de teste, backup verificado e um primeiro build reproduzível.

Descrição resumida para proposta técnica: plataforma imobiliária em Next.js/React com PostgreSQL, Supabase Auth/Storage e publicação Vercel, composta por site público, CRM multiperfil com escopo por equipe/responsável, captação, roleta e automações de leads, agenda, prospecção, financeiro com divisão de comissões e motor configurável de parcelamento de entrada para apresentações comerciais de empreendimentos.
