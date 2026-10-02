# PRODUCT-UX — experiência, informação, fluxos, psicologia de uso, mobile

Carregar para: tela, fluxo, formulário, dashboard, navegação, revisão de usabilidade. Pergunta de abertura: **qual problema de experiência estamos resolvendo?** (não "como deixo mais bonito?").

## 1. Diagnóstico antes de desenho

- **Onde falha?** passo/tela/operação. **O que não dá para fazer?** entender, decidir, operar, digitar, esperar. **Quem sofre?** novato, especialista, corretor no celular com pressa, cliente leigo, tecnologia assistiva, rede lenta.
- **Sucesso =** métrica concreta (taxa de conclusão, tempo, erros, cliques). Sem métrica, defina o que observar depois de publicar.
- **Evidência:** reclamação do dono/corretor, funil, abandono, tempo entre etapas. Peça dado ao `analista-dados` pela Central; não invente persona. Triangule (relato + comportamento + o que você vê na tela). Problema de fluxo parece problema visual com frequência; teste a hipótese de fluxo primeiro.

## 2. Arquitetura de informação

- Liste o conteúdo e dê **prioridade (1/2/3)**, depois agrupe por **significado** (o que se decide junto), não por tabela do banco. Nomeie com o vocabulário do usuário e use o mesmo verbo para a mesma ação em todo lugar.
- **Divulgação progressiva** (NN/g): mostre o essencial, revele o resto sob demanda (detalhes recolhíveis, gaveta, "Ver como chegamos nesse número"). Nunca esconda o que o usuário precisa para decidir; nunca despeje tudo para "não esconder".
- **Navegação:** poucos destinos estáveis; o usuário sempre sabe onde está, como volta e o que mudou. Mobile: alcance do polegar, barra inferior, voltar previsível.
- **Dashboard/painel:** responde "como estou? o que preciso fazer agora?". Números que decidem em cima; operação (pendências, vencidos) logo abaixo; análise e histórico depois. Cada número tem comparação (vs. anterior, meta) ou não merece destaque.
- **Remover antes de reorganizar.** Informação que ninguém usa para decidir sai da tela principal (vai para detalhe ou some).

## 3. Psicologia de uso (carga cognitiva)

Avalie sempre: carga cognitiva, excesso de escolha, expectativa, memória, reconhecimento, prevenção de erro, feedback, confiança, atrito, abandono, atenção, percepção de progresso.
1. **Não quebre o contexto atual:** sem transição brusca, sem perda de informação, sem abuso de modal.
2. **Previna erro:** restrição de entrada, valor padrão sensato, feedback imediato, confirmação só onde o custo é alto, **desfazer** onde dá.
3. **Reconhecimento > memorização:** mostre as opções, não peça para lembrar (ex.: status com rótulo, não código).
4. **Consistência:** mesma coisa, mesmo comportamento e mesma posição.
5. **Reduza passos e escolhas:** padrões, agrupar, estágios (Hick/Miller em espírito: menos opções simultâneas, blocos pequenos).
6. **Progresso visível** em tarefas longas; feedback em < 100 ms para toque, estado de carregamento depois disso.
7. **Erros que ensinam:** o que houve, por quê, como resolver (no campo, em linguagem simples). Não é "Erro 400".
Design não deve só **parecer** simples: deve **ser** simples de compreender (teste: alguém novo diz em 5 s o que a tela quer dele?).

## 4. Fluxos e formulários

- Um objetivo por tela/etapa; campos na ordem do raciocínio do usuário; só pergunte o necessário **agora**.
- Rótulo visível sempre (placeholder não é rótulo); obrigatório/opcional claros; máscara e teclado certos (`inputmode`); validação ao sair do campo e ao enviar, sem apagar o que a pessoa digitou.
- Ação principal única e evidente; secundária visualmente mais fraca; destrutiva separada e confirmada.
- Pós-ação: confirme o que mudou e para onde a pessoa vai (toast + estado atualizado); ofereça desfazer ou próximo passo.
- Regras de negócio no formulário (datas obrigatórias, valores previstos × realizados etc.) vêm do módulo/rule; você desenha o caminho, não inventa a regra.

## 5. Estados são especificação

Para cada tela/componente liste: padrão · hover · foco · ativo · carregando (formato do conteúdo) · desabilitado (e **por quê**) · vazio (convite à ação) · erro (como resolver) · sucesso · sem permissão · conteúdo longo (quebra/trunca com título) · conteúdo curto/zero · offline/lento · mobile. Se um estado não foi desenhado, ele será improvisado em produção.

## 6. Responsivo e mobile (não é desktop espremido)

- **Mesma intenção, composição diferente.** Defina por largura qual é o 1º/2º/3º elemento; no celular a ordem segue a tarefa, não a do desktop.
- Larguras de referência: 360, 390, 768, 1280, 1440. Sem rolagem horizontal da página; tabela larga vira lista de cartões ou rola dentro do próprio bloco.
- Polegar: ação principal ao alcance (parte inferior), alvos ≥ 44px, espaço entre alvos; teclado virtual não cobre o campo; áreas seguras (`env(safe-area-inset-*)`).
- Sticky só se ajuda a tarefa e não rouba área útil; densidade menor no mobile **sem** esconder função (leve para "Mais" ou gaveta, nunca remover).
- PWA/offline e barra inferior: ver `.claude/rules/frontend-pwa.md` e `sistema-visual.md` §4.1.

## 7. Perfis e permissões

Admin, gestor, corretor, associado veem coisas diferentes. Desenhe por perfil e verifique cada um na vitrine (`?perfil=`). Esconder na UI nunca substitui guard no servidor; função indisponível para o perfil deve sumir ou explicar, nunca falhar em silêncio.

## 8. Checklist rápido de UX

[ ] Problema e métrica definidos · [ ] prioridade 1/2/3 · [ ] vocabulário do usuário · [ ] cada elemento ajuda uma decisão · [ ] estados completos · [ ] erro previnido ou reversível · [ ] mobile pensado, não espremido · [ ] perfis conferidos · [ ] nada de dado/regra inventado.
