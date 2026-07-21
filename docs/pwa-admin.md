# PWA do Painel Administrativo

O painel administrativo pode ser instalado no iPhone pelo Safari usando **Compartilhar > Adicionar à Tela de Início**.

## O Que Foi Configurado

- Manifest da PWA com nome `Painel Matheus`.
- `start_url` em `/admin`.
- Abertura em modo `standalone`.
- Ícones próprios em `public/icons`.
- `apple-touch-icon`.
- Metadados Apple no layout principal.
- Service worker em `public/sw.js`.
- Página offline segura em `public/offline.html`.
- Aviso discreto de instalação para iPhone/Safari.
- Detecção de atualização disponível.
- Renovação periódica da sessão administrativa via `/api/admin/session`.

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

## Limitações

- O iOS não oferece botão automático de instalação. A instalação precisa ser feita pelo menu Compartilhar do Safari.
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
- `components/AppChrome.jsx`;
- `proxy.js`;

Depois, restaure `app/layout.jsx` para renderizar diretamente o cabeçalho, conteúdo, rodapé e botões flutuantes.
