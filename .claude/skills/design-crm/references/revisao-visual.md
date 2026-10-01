# Revisão visual

## 1. Vitrine de componentes (somente desenvolvimento)

`app/dev/vitrine/` renderiza os **componentes reais** do painel com **dados fictícios**, sem login, sem Supabase e sem chamar API nenhuma — `_lib/mock-fetch.js` intercepta todo `fetch` para `/api/**` e responde com as fixtures (`_fixtures/<tela>.js`; rotas compartilhadas de menu/badges em `_fixtures/comum.js`).

- **Nunca existe em produção:** a página é `page.dev.jsx`, extensão que o `next.config.mjs` só registra no `next dev` (`PHASE_DEVELOPMENT_SERVER`); no `next build` o arquivo nem é compilado. Segunda trava: `notFound()` se `NODE_ENV === "production"`. `AppChrome` renderiza `/dev/*` sem cabeçalho/rodapé do site.
- **Abrir:** `pnpm dev` → `http://localhost:3000/dev/vitrine` (índice). Parâmetros: `tela` (fundacao, clientes, chat, meta-diaria, meta-diaria-equipe, desempenho), `perfil` (admin, gestor, corretor, associado), `estado` (normal, carregando = APIs nunca respondem, erro = APIs respondem 500), `fonte` (atual, manrope, inter — troca `--font-ui` só na vitrine), `limpo=1` (sem a barra amarela de dev). A barra inferior do celular aparece em todas as telas, com o item ativo simulado (`path` em `TELAS`).
- **Tela nova:** crie `_fixtures/<tela>.js` exportando os dados e `routes` (`{ method?, match: RegExp sobre pathname+search, response: objeto | ({url, init, method}) => objeto, status?, delay? }`), derive o formato lendo a `lib/` que a página real usa, e registre em `TELAS` no `VitrineClient.jsx` reproduzindo o `<main>` da página real. **Dados sempre inventados** — nunca copie dado real do banco (nome, telefone, CPF, renda).
- Limite honesto: o que a página server-side faz antes do componente (guard, `AdminSectionNav` com dados do servidor, cabeçalho de ranking) não é reproduzido — a vitrine mostra o menu (`AdminMenu`) e o componente da tela. Aviso `[vitrine] sem fixture para …` no console = endpoint sem fixture (o componente recebe `{}`): complete a fixture se afetar o que está sendo revisado.

## 2. Captura

Com `pnpm dev` rodando:

```
node .claude/skills/design-crm/scripts/capturar-vitrine.mjs --tela clientes --perfil corretor
node .claude/skills/design-crm/scripts/capturar-vitrine.mjs --tela chat --estado carregando --larguras 390,1280
```

Gera `scratch/vitrine/<tela>-<perfil>-<estado>[-<fonte>][-<sufixo>]-<largura>.png` (padrão 360, 390, 768, 1280, 1440; `--pagina-inteira` para página toda; `--fonte manrope`; `--clicar "texto"` ou `--clicar "botao:Mais"` + `--sufixo nome` para capturar após um clique), avisa rolagem horizontal e erros de console. Abra os PNG com a ferramenta Read para ver. Movimento reduzido ligado para capturas estáveis — revise animações à parte. No container web: Chromium em `/opt/pw-browsers` (Playwright global já configurado). Apague `scratch/vitrine/` ao terminar.

Para comparar antes × depois, capture antes de editar com `--saida scratch/vitrine/antes`.

## 3. Lentes (uma de cada vez — "decidiu ou usou o padrão?")

- **A · Hierarquia** (a mais valiosa): qual é o ponto focal e ele ganha (tamanho, peso, contraste, isolamento)? O resto foi rebaixado? Dá para distinguir primário / secundário / metadado sem ler?
- **B · Tipografia e cor**: hierarquia por tamanho + peso + cor (não só tamanho, não só caixa alta)? Escala real? Rampa de texto de 4 níveis? `tabular-nums` em números? Um acento (~10%) com significado; status com cor semântica?
- **C · Superfícies e profundidade**: uma estratégia (borda sutil + tom; sombra só no que flutua)? Bordas encontráveis, não gritantes? Raios da escala e concêntricos?
- **D · Composição e ritmo**: densidade varia por zona ou é tudo igual? Agrupamento por proximidade? Largura de conteúdo pensada? No mobile, a ordem é a da tarefa?
- **E · Estados, acabamento e movimento**: padrão/hover/pressionado/foco/desabilitado; carregando/vazio/erro; alvo ≥44px; movimento <300ms ease-out só em transform/opacity; nada animando em ação repetida.
- **F · Estrutura, reuso e conteúdo**: reinventou o que já existe (`<div onClick>`, modal caseiro sem foco/Esc, string de classes duplicada, cor crua em vez de token)? Gambiarras (margem negativa, `absolute` para fugir do fluxo, seletor por cadeia de utilitárias)? Os textos contam uma história coerente e usam o mesmo verbo?

## 4. Checklist responsivo e de acessibilidade

- [ ] 360 e 390: sem rolagem horizontal, nada cortado/sobreposto, texto ≥12px, inputs ≥16px, alvos ≥44px, ação principal ao alcance do polegar, safe-area respeitada.
- [ ] 768: layout intermediário intencional (não "mobile esticado" nem "desktop espremido").
- [ ] 1280 e 1440: largura de leitura controlada, sem vazios gigantes nem colunas esticadas sem motivo.
- [ ] Estados `carregando` e `erro` da vitrine revisados; vazio revisado (fixture vazia ou filtro).
- [ ] Foco visível navegando só por teclado; `Esc` fecha modal/sheet e o foco volta.
- [ ] Contraste AA; status não depende só de cor; ícones sem texto têm `aria-label`.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] Perfis: tela conferida em cada perfil que a acessa (`perfil=`).

## 5. Gravidade e barra de aprovação

- **Bloqueador:** sem ponto focal, hierarquia plana, layout monótono, cor tímida ou competindo, superfícies fragmentadas, estado ausente, gambiarra estrutural, controle interativo inacessível, quebra no mobile (rolagem horizontal, corte, alvo pequeno), funcionalidade escondida/perdida.
- **Deve corrigir:** lacuna real que um líder de design apontaria, mas a tela funciona.
- **Nota:** menor; cite uma vez.
- **Filtro de falso positivo:** gosto pessoal coerente com a intenção; escolha ousada funcionando; fora do escopo; ratificado no `sistema-visual.md`; assunto de lint/build.

Aprovado só com: ponto focal claro e hierarquia que sobrevive ao "apertar os olhos" · tipografia com tamanho + peso + cor · cor contida e com significado · uma estratégia de profundidade · ritmo e proporções intencionais · estados completos e movimento com propósito · reuso do sistema e primitivas acessíveis · sem gambiarra, conteúdo coerente · mobile real · não parece gerado por IA.
