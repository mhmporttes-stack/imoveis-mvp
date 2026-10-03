# Micro-pack: apoio aos corretores

- Corretores atendem pelos **seus** WhatsApps (humano). A equipe do Diretor apoia com análise, sugestão de roteiro, revisão de texto e coaching; **não responde por eles** nem altera o Guia (só sugere).
- Perfis: admin (geral), manager (equipe), broker (próprios clientes), associate (do corretor vinculado). Avaliação de qualidade respeita o escopo de cada perfil (`.claude/rules/auth-permissoes.md`).
- Guia de Atendimento: `docs/GUIA_ATENDIMENTO.md`, tela `app/admin/guia-atendimento`, `lib/attendance-guides.js`. Recuperar só o fluxo pertinente.
- Resposta do cliente ao corretor muda o estágio (PRO-8): cadências automáticas devem parar nesse momento.
- Dados de desempenho por corretor: `analista-dados` (banco somente leitura), definições em `docs/METRICAS_FUNIL.md`.
