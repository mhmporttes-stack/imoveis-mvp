// Controle individual de ACESSO AOS RECURSOS WHATSAPP por corretor (pedido do dono, 2026-10-04) — regras
// PURAS, testadas em tests/whatsapp-access.test.mjs. Conceito DIFERENTE da automação ligada/desligada
// (daily_goal_auto_settings.enabled, que só liga/desliga os disparos automáticos): aqui o admin/gestor libera
// ou bloqueia o USO do WhatsApp do CRM por corretor. A leitura/gravação fica em lib/whatsapp-access.js; a
// barreira central das rotas em lib/admin-auth.js (requireAdminApi) e dos envios em lib/whatsapp-individual.js.
//
// Bloquear NÃO desconecta sessão, NÃO apaga credenciais, fila, histórico, cliente, funil ou pontuação.

export const WHATSAPP_ACCESS_BLOCKED_CODE = "WHATSAPP_ACCESS_BLOCKED";
export const WHATSAPP_ACCESS_BLOCKED_MESSAGE = "Seu acesso aos recursos de WhatsApp está bloqueado. Fale com a gestão.";

// APIs do corretor que um perfil BLOQUEADO nunca pode chamar (nem direto pela URL). Método opcional.
// Fora desta lista de propósito: supervisão do admin/gestor (team-overview, daily-goal-auto/*, ranking,
// configurações), clientes, agenda, financeiro e tudo que não é recurso de WhatsApp.
const PROTECTED_API_RULES = [
  { pattern: /^\/api\/admin\/whatsapp-chat(\/|$)/ }, // Chat inteiro (listar, abrir, enviar, mídia, atribuir…)
  // conexão, QR, status, restrição própria, desconectar — a SUPERVISÃO das restrições da equipe (admin/gestor) fica livre
  { pattern: /^\/api\/admin\/whatsapp-individual(?!\/restriction\/(?:team|validate|close|history)(?:\/|$))(?:\/|$)/ },
  { pattern: /^\/api\/admin\/client-documents\/from-chat(\/|$)/ }, // documentos puxados do Chat
  { pattern: /^\/api\/daily-goal$/ }, // Meta Diária do corretor
  { pattern: /^\/api\/daily-goal\/(attempt|auto|message-override)(\/|$)/ }, // tentativa, painel da automação, mensagem
  { pattern: /^\/api\/prospecting\/extra-dispatch(\/|$)/ }, // estado do "Disparar"
  { pattern: /^\/api\/prospecting\/(?!bulk$|broker-bases$|extra-dispatch$|clients$)[^/]+$/, methods: ["POST"] } // "Disparar"
];

export function isWhatsappPathProtected(pathname, method = "GET") {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  const verb = String(method || "GET").toUpperCase();
  return PROTECTED_API_RULES.some((rule) => rule.pattern.test(path) && (!rule.methods || rule.methods.includes(verb)));
}

// Páginas (não API) que um perfil bloqueado não abre.
export function isWhatsappPagePath(pathname) {
  const path = String(pathname || "");
  return path === "/admin/chat" || path.startsWith("/admin/chat/");
}

// O bloqueio vale para quem OPERA o WhatsApp como corretor; o administrador geral nunca é bloqueado.
export function isEffectivelyBlocked(profile) {
  if (!profile || profile.role === "admin") return false;
  return profile.whatsappAccessBlocked === true;
}

// Itens de navegação que o corretor bloqueado NÃO deve ver (não renderizar — nada de botão cinza):
// Chat e a Meta Diária do corretor. A Meta Diária de supervisão (admin/gestor) e os demais itens ficam.
export function hiddenNavKeys({ blocked = false, isBrokerOrAssociate = false } = {}) {
  if (!blocked) return new Set();
  const keys = new Set(["chat"]);
  if (isBrokerOrAssociate) keys.add("daily-goal");
  return keys;
}
