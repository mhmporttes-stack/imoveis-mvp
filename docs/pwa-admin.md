# PWA do Painel Administrativo

O painel administrativo pode ser instalado no iPhone pelo Safari usando **Compartilhar > Adicionar à Tela de Início**.

## O Que Foi Configurado

- Manifest da PWA com nome `Painel Matheus`.
- `start_url` em `/admin/abrir` (porta de entrada: dono → Início; demais → Clientes — `docs/BUSINESS_RULES.md` INI-6).
- Abertura em modo `standalone`.
- Ícones próprios em `public/icons`.
- `apple-touch-icon`.
- Metadados Apple no layout principal.
- Service worker em `public/sw.js`.
- Página offline segura em `public/offline.html`.
- Botão de instalar o app para corretores acessando pelo navegador do celular: no Android/Chrome captura o evento `beforeinstallprompt` e mostra um botão real ("Instalar app") que dispara a instalação nativa; no iPhone/Safari (que não dispara esse evento) mantém a orientação manual de Compartilhar > Adicionar à Tela de Início, com a mesma apresentação visual.
- Detecção de atualização disponível (aplicada na próxima troca de tela, nunca ao sair/voltar — ver "Versão nova sem recarregar ao voltar").
- Renovação periódica da sessão administrativa via `/api/admin/session`.
- Navegação de app no celular (< 768px): barra inferior fixa `components/AdminBottomNav.jsx` (4 destinos por perfil + Chat Marketplace ao lado do Chat desde 2026-10-21 + "Mais"), respeitando a área segura do iPhone; o menu do topo só aparece do tablet para cima. Detalhes: `.claude/skills/design-crm/references/sistema-visual.md` §4.1.

## Segurança Do Cache

O service worker não armazena páginas administrativas nem respostas de API.

Rotas tratadas como privadas:

- `/admin`
- `/api`

Somente recursos estáticos seguros são armazenados, como:

- ícones;
- assets institucionais;
- arquivos estáticos do Next.js;
- página offline sem dados privados.

Desde 2026-10-22 (velocidade, etapa 2), os arquivos de `/_next/static/*` (hash do conteúdo no nome) ficam no cache sem versão `painel-matheus-next-static` (máx. 600 entradas, os mais antigos saem), que sobrevive às publicações; os demais ficam em `painel-matheus-v4-<build>-static`, apagado a cada deploy. Trava: `tests/sw-next-static-cache.test.mjs`.

## Versão nova sem recarregar ao voltar (2026-10-26)

Dono: "Quando eu saio do app por um tempo e volto, ele tem que carregar tudo de novo." Cada publicação muda `public/sw.js`; antes o `PwaLifecycle` recarregava a página ao sair do app (ou logo ao voltar) quando havia versão nova — com dezenas de publicações por dia, quase toda volta recarregava. Agora (`components/PwaLifecycle.jsx` + regra pura `components/pwa-update-policy.mjs`, testes `tests/pwa-update-policy.test.mjs`):

- Sair/voltar **nunca** recarrega: a tela continua onde estava. A busca por versão nova ao voltar espera 4 s (não disputa a rede com a tela) e segue a cada 10 min.
- A versão nova fica pendente e entra no **próximo toque num link do painel** (abre a tela pedida por completo, já na versão nova) ou, se a troca de tela veio de `router.push`, logo depois dela (nunca com campo sendo digitado). Link com `data-no-hard-nav` (ou um ancestral) fica fora. Abrir o app do zero já usa a versão nova.
- Primeira instalação do service worker não conta como versão nova. A pendência fica no módulo (sobrevive à remontagem do `PwaLifecycle` entre painel/Academia/`/chat-app`).
- Aviso pequeno no canto: "Nova versão: entra ao trocar de tela" (sem botão, decisão do dono de 2026-10-14).
- **Limite do iPhone:** se o iOS descartar o app da memória em segundo plano (comum depois de um bom tempo ou com pouca memória), a volta é uma abertura do zero — o painel é baixado de novo (páginas e APIs são privadas, nunca guardadas no service worker). Os arquivos estáticos (`/_next/static`, fontes, ícones) já vêm do cache. ~~O cache de dados das telas é só memória ("nada vai para o disco")~~ — **substituído em 2026-10-26 pelo dono ("Sim, quero que guarde")**: as telas principais guardam o último conteúdo no aparelho e abrem com ele na hora (seção "Cache das telas no aparelho" abaixo).

## Velocidade, etapa 3 (2026-10-22)

- Troca de tela: `loading.jsx` com `components/AdminRouteLoading.jsx` em cada seção de `app/admin`, menos Meta Diária, `/admin/simulacoes` (cenas), Chat e Alexa. Não criar `app/admin/loading.jsx` (cobriria os destinos das cenas). Trava: `tests/painel-velocidade-etapa3.test.mjs`.
- Avisos globais (Mensagem do Dia, Celebração, Supervisão, Central de Alertas): `components/DeferredPanelGates.jsx` (`next/dynamic` + ocioso).
- Login e redefinir senha: código em `app/painel-acesso/` (layout leve); `proxy.js` reescreve `/admin/login` e `/admin/reset-password` para lá — a URL vista pelo usuário, pelo `usePathname` e pelo service worker continua `/admin/...`.

## Pré-carregamento do painel (AdminWarmup)

Dono, 2026-10-22: botões do app prontos antes do toque, Clientes primeiro. `components/AdminWarmup.jsx` (montado em `app/admin/layout.jsx`) roda no celular e no computador, 2 s depois que o painel abre, um item por vez com o navegador ocioso e o app visível:

1. **Clientes** — rota inteira (`router.prefetch(href, { kind: "full" })`) + 1ª página da lista padrão (`/api/simulation-registrations/list?page=1&pageSize=20`).
2. **Barra inferior do perfil** (`warmupTargets` no layout) **+ atalhos do cabeçalho** (Chat, Chat Marketplace, Agenda), com os dados que as telas já guardam por conta: lista do Chat (`?warm=1`, sem recibo/lida), lista do Marketplace, números do Desempenho (admin geral) e mês atual da Agenda.
3. **Todos os itens do menu do perfil** (`getAdminMenuGroups` — o mesmo do menu lateral e do "Mais"), na ordem do menu, 1,2 s entre um e outro.

Regras (`components/admin-warmup-plan.mjs`, teste `tests/admin-warmup-plan.test.mjs`):
- Só rota (sem montar a tela no servidor): Meta Diária (MD-16), Anúncios (abrir chama a Meta e grava miniaturas), Início e Alexa.
- Janela: barra/cabeçalho refeitos no máximo a cada 5 min (validade da tela pré-carregada no Next) e menu a cada 30 min — só quando a pessoa volta ao app ou troca de tela, nunca por relógio. Dados só se ainda não estão na memória (a tela atualiza ao abrir de qualquer jeito).
- Economia de dados / 2G: só as rotas da barra e do cabeçalho, sem montar tela, sem dados e sem menu.
- Memória por conta real + efetiva (`components/chat-view-cache.js`); desde 2026-10-26 também no aparelho (seção abaixo; "Alterar conta" continua só na memória da aba); sair e "Alterar conta" limpam tudo (inclusive as marcas de "já aqueceu", `sessionStorage` `mm-warmup:v2:*`) e chamam `router.refresh()`, que descarta as telas guardadas pelo Next.
- Nenhuma consulta nova no servidor: pré-carregar uma tela é o mesmo que abri-la (só leitura).

## Cache das telas no aparelho (2026-10-26)

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-26]** "Sim, quero que guarde": guardar no próprio aparelho os últimos dados das telas principais para que, mesmo quando o iOS tira o app da memória, a tela apareça na hora com o último conteúdo e atualize por trás. Substitui a escolha anterior de privacidade "nada vai para o disco" (2026-10-12).

- **Onde:** IndexedDB do navegador/app (`mm-painel-cache`, um registro só), `components/device-view-cache.js`; regras puras em `components/device-view-cache-core.mjs` (testes `tests/device-view-cache.test.mjs`). A memória da aba (`components/chat-view-cache.js`) continua sendo a primeira camada; cada gravação nela agenda a cópia no aparelho (agrupada em 0,8 s e gravada na hora quando o app vai para o fundo).
- **De quem:** uma conta por aparelho. Chave = usuário REAL + perfil efetivo (`lib/chat-viewer-key.mjs`). Ao abrir com outra pessoa, o registro anterior é apagado antes de qualquer coisa aparecer. **"Alterar conta" nunca vai para o disco** (fica só na memória da aba, 30 min sem uso, como antes) e entrar/sair dela apaga o aparelho — decisão mais segura: o dado de outra conta nunca fica gravado no aparelho do admin.
- **Por quanto tempo:** 24 h por item (mais velho é descartado ao ler e ao gravar); versão do formato (`DEVICE_CACHE_SCHEMA`) — outra versão apaga tudo.
- **O que guarda:** Clientes (1ª página da visão padrão, como a memória já fazia), Chat (lista da visão padrão + até 8 conversas abertas recentemente, últimas 60 mensagens de cada), Chat Marketplace (lista padrão + últimas conversas), Desempenho (mês), Agenda (mês atual) e Início (resumo, mês e visão do dono). Meta Diária: nada — a tela é montada inteira no servidor (MD-16), não há dado buscado no cliente para guardar.
- **O que nunca guarda:** CPF, PIS, data de nascimento, tokens/senhas, documentos/arquivos (só contagens), mídia e endereços de arquivo (só a rota do próprio CRM, que confere o login; nome de arquivo sai), `data:`/base64. O service worker continua sem guardar API/HTML.
- **Como aparece:** a 1ª pintura é a do servidor (sem diferença de hidratação); logo depois a tela mostra o guardado com o selo "Atualizando…" (`components/DeviceCacheRefreshing.jsx`) e troca tudo pela resposta do servidor. O guardado nunca é gravado de novo (não renova a validade) e não serve de base para gravar nada (ex.: "Abrir simulação" de cliente sem simulação espera a lista do servidor). Chat: a lista guardada só entra se os filtros da abertura forem os mesmos; nenhuma conversa é aberta sozinha (abrir marca como lida). Início: o carregamento da tela (`app/admin/inicio/loading.jsx` → `components/inicio/InicioDeviceCache.jsx`) mostra o último Início desta conta enquanto o servidor monta o novo.
- **Limpeza:** botão Sair (`AdminLogoutButton`, espera apagar), sessão caída (`AdminSessionKeeper`), tela de login (`components/DeviceCacheWipe.jsx`, cobre expiração detectada pelo servidor), "Alterar conta" (entrar e sair) e troca de usuário na abertura. Sem IndexedDB (navegação privada, erro) o painel funciona como antes, sem cache.

## Login Persistente

O login administrativo continua usando Supabase Auth.

A sessão é mantida por cookies HTTP-only:

- `mm_admin_access_token`;
- `mm_admin_refresh_token`.

Quando o access token expira, o servidor tenta renovar a sessão com o refresh token. O app também chama `/api/admin/session` periodicamente para manter os cookies atualizados enquanto o painel está aberto.

## Como Instalar No iPhone

1. Abra o Safari no iPhone.
2. Acesse `https://www.matheusmachadoimoveis.com.br/admin`.
3. Faça login com o usuário administrador autorizado.
4. Toque no botão de compartilhar do Safari.
5. Toque em **Adicionar à Tela de Início**.
6. Confirme o nome **Painel Matheus**.
7. Abra pelo ícone criado na tela inicial.

## Como Testar

1. Abra o site público sem login e confirme que continua funcionando.
2. Acesse `/admin` sem login e confirme o redirecionamento para `/admin/login`.
3. Faça login com o administrador autorizado.
4. Feche o Safari e abra novamente.
5. Confirme que o painel permanece conectado enquanto a sessão é válida.
6. Adicione à tela inicial.
7. Abra pelo ícone e confirme que a interface do Safari não aparece.
8. Crie ou edite um registro de teste.
9. Toque em **Sair** e confirme retorno para `/admin/login`.
10. Desative a internet e confirme que nenhuma informação privada aparece offline.

## Notificações Push (Web Push / VAPID)

O painel pode enviar notificações push reais para o celular do corretor (mesmo com o navegador fechado), usando o padrão Web Push com chaves VAPID — sem depender de Firebase ou de qualquer serviço pago.

O que foi implementado:

- `lib/web-push.js`: implementação própria (sem dependências externas, pois este ambiente não tem npm/pnpm disponível para instalar a lib `web-push`) da assinatura VAPID (RFC 8292) e da criptografia da mensagem `aes128gcm` (RFC 8291), usando apenas o módulo `crypto` nativo do Node.
- `lib/push-subscriptions.js`: salva/lista/remove assinaturas no Supabase e envia notificações para todas as assinaturas de um corretor (`sendPushToUser`), removendo automaticamente assinaturas que o navegador já invalidou (respostas 404/410).
- Tabela `push_subscriptions` no Supabase (migration `20260913_push_subscriptions.sql`): guarda `user_id`, `endpoint`, `p256dh`, `auth` por assinatura (um corretor pode ter mais de um aparelho).
- `public/sw.js`: o service worker agora escuta os eventos `push` (mostra a notificação) e `notificationclick` (abre/foca o painel na URL indicada pela notificação).
- `components/AdminPushSubscription.jsx`: mostra um banner discreto "Ativar notificações" nas páginas `/admin` (exceto login) quando a permissão ainda não foi decidida. **Importante:** no iOS/Safari, `Notification.requestPermission()` só funciona quando chamado de forma síncrona dentro de um toque real do usuário — chamá-lo dentro de um `useEffect`/`setTimeout` é silenciosamente ignorado pelo WebKit (a Promise resolve sem mostrar nada e a permissão nunca sai de "default"). Por isso o pedido de permissão só acontece no clique do botão; se a permissão já tiver sido concedida antes, a (re)assinatura acontece sozinha, sem precisar de botão.
- Endpoints:
  - `POST /api/push/subscribe` — salva a assinatura do corretor logado.
  - `POST /api/push/unsubscribe` — remove uma assinatura.
  - `POST /api/push/test` — dispara uma notificação de teste para o próprio usuário logado (útil para validar manualmente).
- Canal `push` integrado ao lembrete de atividade agendada existente (`lib/scheduled-activity-notifications.js`), ao lado de WhatsApp e e-mail — o corretor responsável recebe um push quando uma atividade vence, além dos canais já existentes.

### Variáveis de ambiente necessárias

Adicionar no Vercel (Settings > Environment Variables) e no `.env` local:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — chave pública VAPID (pode ser exposta ao navegador).
- `VAPID_PUBLIC_KEY` — mesma chave pública, usada no servidor ao assinar o JWT.
- `VAPID_PRIVATE_KEY` — chave privada VAPID (segredo, nunca expor no cliente).
- `VAPID_SUBJECT` — contato do responsável pelo VAPID, formato `mailto:...`.

Para gerar um novo par de chaves, rode `generateVapidKeys()` de `lib/web-push.js` uma única vez e salve os valores retornados.

### Limitações

- Push exige HTTPS (produção já atende) — não funciona em `http://localhost` fora do Chrome com flags especiais, mas funciona normalmente em `https://` de preview/produção da Vercel.
- Como não há aparelho de teste conectado a este ambiente, o fluxo completo (permitir notificação → registrar → receber push real) foi validado por partes: a assinatura VAPID e a criptografia da mensagem foram testadas ponta a ponta com um par de chaves de teste (round-trip de criptografia/decriptografia confirmado), e o salvamento/listagem/remoção de assinaturas foi testado direto no Supabase de produção com um registro descartável. O teste com uma assinatura real de navegador (endpoint real da Push API) ainda precisa ser feito por alguém com um celular em mãos, usando `POST /api/push/test` logado no painel.

## Limitações

- O iOS não oferece o evento `beforeinstallprompt`, então não é possível instalar com um clique como no Android. O botão exibido no iPhone continua sendo uma orientação (Compartilhar > Adicionar à Tela de Início), não uma instalação automática.
- A tela de splash do iPhone é controlada pelo iOS a partir dos metadados e do ícone configurado.
- A PWA não mantém dados privados offline por decisão de segurança.

## Como Reverter

Para desfazer a PWA, remova:

- `app/manifest.js`;
- `public/sw.js`;
- `public/offline.html`;
- `public/icons`;
- `components/PwaLifecycle.jsx`;
- `components/AdminPwaInstallHint.jsx`;
- `components/AdminSessionKeeper.jsx`;
- `components/AdminPushSubscription.jsx`;
- `components/AppChrome.jsx`;
- `lib/web-push.js`;
- `lib/push-subscriptions.js`;
- `app/api/push/`;
- a tabela `push_subscriptions` no Supabase (migration `20260913_push_subscriptions.sql`);
- `proxy.js`;

Depois, restaure `app/layout.jsx` para renderizar diretamente o cabeçalho, conteúdo, rodapé e botões flutuantes.
