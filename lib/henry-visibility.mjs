// INTERRUPTOR ÚNICO do Henry no painel (REGRA OFICIAL — dono, 2026-11-13: "o Henry não se mostrou eficaz, deixar OCULTO").
// Nada foi apagado (código, tabelas, rules e rotas continuam): só a parte VISÍVEL do CRM deixa de montar o Henry —
// botão/anel flutuante, avisos e bom dia falados, tela de bloqueio, cartões de configuração e treino em /admin/alexa.
// Para RELIGAR: troque `HENRY_HIDDEN_BY_OWNER` para `false` e publique (nenhuma migration, nenhum dado muda).
// Consumidores: app/admin/layout.jsx e app/admin/alexa/page.jsx. Trava: tests/henry-visibility.test.mjs.
export const HENRY_HIDDEN_BY_OWNER = true;

export function isHenryVisible(hidden = HENRY_HIDDEN_BY_OWNER) {
  return hidden !== true;
}
