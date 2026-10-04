---
paths:
  - "components/academia/**"
  - "app/academia/**"
  - "app/api/admin/academia/**"
  - "app/dev/vitrine/academia/**"
  - "lib/academy-*"
  - "tests/academy-*"
---

# Academia (formação dos corretores)

Referência: `docs/ACADEMIA.md` (estado, mapa de arquivos, limitações); plano e repasse de design em `docs/academia/`; detalhe e pendências em `docs/BUSINESS_RULES.md` grupo ACA-x. Chave de liberação: `ACADEMIA_ENABLED` (padrão desligada; só o nome da variável).

- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Quem edita o conteúdo.** **Admin e Gerente (gestor)** podem criar e editar conteúdos da Academia; corretor e associado só estudam. Substitui a proposta anterior do plano ("só o admin geral"). Ainda não implementada (F3): toda rota de edição exige guard de gestão no servidor (`requireBrokerManagementApi` ou equivalente, a confirmar na F3); esconder o botão na UI nunca substitui a checagem. **Refinado em 2026-10-04 (2ª decisão):** Admin e Gerente também **publicam diretamente**, sem etapa adicional de aprovação (guard de gestão também em publicar).
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Nota mínima dos quizzes: 70% (7,0).** Implementação: `settings.pass_score` (70) em `lib/academy-sample.mjs` (dados de exemplo); a aplicação real no servidor vem na F4. **Refinado em 2026-10-04 (2ª decisão):** provas de módulo e prova final exigem os mesmos 70% (7,0), com **máximo de 3 tentativas por prova** (não implementado; vem na F4). Se o gestor pode liberar nova tentativa: **[PENDENTE DE VALIDAÇÃO]** (ACA-2).
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Identidade visual.** Fonte **Fraunces** (com Manrope), hospedada no app (`components/academia/fonts/`, `next/font/local`, sem Google Fonts em runtime), e a **metáfora do prédio com guindaste** (um andar aceso por aula; `components/academia/scene/**`). Não troque sem pedido do dono (ACA-3, ACA-4).
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Orçamento de peso.** O teto de **150 KB (JS gz)** vale **somente para a parte própria da Academia** (hoje 21,5 KB), não para o peso base do site. Fontes de **≈92 KB** aprovadas. Medir em `.next/diagnostics/route-bundle-stats.json` (ACA-5, ACA-6).
- **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]** F0/F1: rota `/academia` atrás da chave; dados de exemplo em memória (`lib/academy-sample*.mjs`), sem banco, sem API e sem rede depois de carregar; zoom liberado só nesta rota. Acesso real a dados (F2+) só por `lib/`.
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Formação Inicial, certificado e histórico.** (1) A Formação Inicial é **obrigatória para novos associados e corretores**; os atuais: **[PENDENTE DE VALIDAÇÃO]** (ACA-7). (2) O **certificado** só sai com **100% da formação concluída** e a nota mínima cumprida; a **verificação pública** do certificado fica para fase posterior. (3) **Associados participam normalmente** da Academia. (4) **Todo o histórico** (progresso, tentativas, aprovações, conclusões) **é preservado**: nunca apagar, só arquivar. Ainda não implementado (F2 em diante). Detalhes: ACA-7 a ACA-9.
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] "Alterar conta" na Academia: somente leitura.** Em "Alterar conta" o admin só vê a Academia; toda escrita de progresso, tentativa ou certificado é recusada no servidor (F2). Vale só para a Academia e **não altera** o comportamento de "Alterar conta" no resto do CRM (`auth-permissoes.md`). Hoje não há escrita real, então o comportamento já é somente leitura (ACA-10).
