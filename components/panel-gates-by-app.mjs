// Avisos do painel por app da tela inicial (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24). Puro, testado em
// tests/panel-gates-by-app.test.mjs. `app` = getMmApp() ("" | "financeiro" | "chat", components/pwaHome.js).
//  - Painel (sem app): todos os avisos, como sempre.
//  - App "Financeiro": nenhum aviso (como antes).
//  - App "Chat": SÓ os bloqueios — o alerta "Importante" da Central e a janela obrigatória do cliente esfriado (FUN-15,
//    que chega pela Central como Importante). Mensagem do dia, Celebração, Supervisão e o Informativo continuam fora.
// "Alterar conta" não muda aqui: o layout já manda `alerts = null` nesse modo, e null continua null.
export function gatesForApp(app = "", { daily = null, celebration = null, supervision = null, alerts = null } = {}) {
  if (app === "financeiro") return { daily: null, celebration: null, supervision: null, alerts: null };
  if (app === "chat") return { daily: null, celebration: null, supervision: null, alerts: alerts ? { ...alerts, importantOnly: true } : null };
  return { daily, celebration, supervision, alerts };
}
