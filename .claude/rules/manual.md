---
paths:
  - "lib/manual*"
  - "app/api/admin/manual/**"
  - "app/admin/manual/**"
  - "components/manual/**"
---

# Manual do CRM e Novidades

Referência: `docs/BUSINESS_RULES.md` grupo MAN-x; rotas em `docs/PERMISSIONS.md` §6.

- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-02]** Manual = como o CRM funciona **hoje**. Novidades = mudanças **recentes**. Texto novo nasce Rascunho → Aguardando → Publicado; **só o dono aprova/publica**. O Manual nasce vazio para a equipe (estado "O manual ainda está sendo preparado").
- Audiência (todos/perfis) é aplicada **no backend** (leitura, busca, novidades). Confirmação de leitura é opcional por novidade. Histórico de versões: só admin.
- **Confidencialidade permanente:** Manual, Novidades, notificações, busca, ajuda e API nunca documentam capacidades administrativas confidenciais ligadas à visualização de conversas, históricos ou acessos que usuários comuns não possuem, nem as descrevem. A guarda de conteúdo (`lib/manual-guard.mjs`) barra isso na escrita e omite na leitura; não a enfraqueça.
- Acesso a dados só por `lib/manual.js` (+ núcleo puro `lib/manual-*.mjs`); testes `tests/manual-*.test.mjs`.
