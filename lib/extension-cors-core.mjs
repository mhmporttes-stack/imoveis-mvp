// CORS da extensão do Marketplace (ferramentas/marketplace-publicador), usado por proxy.js. A extensão chama
// /api/marketplace/* com chave própria (Bearer mkp_…, sem cookie). Quando o Chrome não aplica a permissão de site da
// extensão, o pedido vira CORS e o preflight sem Access-Control-Allow-Origin derrubava tudo ("Failed to fetch" /
// "CRM indisponível", 2026-10-26). Libera só origem chrome-extension:// nessas rotas, sem credenciais — a autorização
// continua sendo a chave conferida em cada rota.
export const EXTENSION_API_PREFIX = "/api/marketplace/";
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

// → null (sem CORS) ou os cabeçalhos a aplicar.
export function extensionCorsHeaders(pathname, origin) {
  if (!String(pathname || "").startsWith(EXTENSION_API_PREFIX) || !EXTENSION_ORIGIN.test(String(origin || ""))) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Version",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}
