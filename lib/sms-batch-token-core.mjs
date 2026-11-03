// Lote de SMS: link único por contato (dono, 2026-11-03, PRO-18f). Regras puras do token, SEM node:crypto (este arquivo também
// roda no navegador: o formulário público lê o token). A geração (HMAC) fica em lib/sms-batch-links.mjs, só no servidor.
// - Token = 10 caracteres base32 minúsculos (a-z, 2-7 = 50 bits): opaco, não revela contato, nome nem telefone.
// - Link = `<link da campanha>?t=<token>` (curto /c/<código>); o roteador /c repassa como `sms_t` ao formulário. Link longo de
//   fallback (/simulacao?c=…) já leva `sms_t` direto.
// - O token NÃO é credencial: só liga clique/cadastro a um contato; a leitura de quem clicou é só no painel.

export const SMS_TOKEN_PATTERN = /^[a-z2-7]{10}$/;
export const SMS_TOKEN_LENGTH = 10;
export const SMS_TOKEN_PARAM = "t"; // parâmetro no link curto /c/<código>
export const SMS_TOKEN_QUERY = "sms_t"; // parâmetro que o formulário captura
export const SMS_TOKEN_COOKIE = "mm_sms_t";
export const SMS_TOKEN_MAX_AGE_DAYS = 30;

// Token válido (minúsculo) ou "" — mesma regra no servidor e no navegador.
export function cleanSmsToken(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return SMS_TOKEN_PATTERN.test(text) ? text : "";
}

// `<link da campanha>?t=<token>` (curto) ou `&sms_t=<token>` (link longo /simulacao?c=). Sem token válido devolve o link como está.
export function buildSmsTokenLink(baseLink, token) {
  const link = String(baseLink || "");
  const clean = cleanSmsToken(token);
  if (!link || !clean) return link;
  const isShort = /\/c\/[^/?#]+$/i.test(link.split("?")[0]);
  const separator = link.includes("?") ? "&" : "?";
  return `${link}${separator}${isShort ? SMS_TOKEN_PARAM : SMS_TOKEN_QUERY}=${clean}`;
}

// Cadastro: grava só o token válido em `source_metadata` (chave aditiva `sms_token`).
export function smsTokenMetadata(attribution) {
  const token = cleanSmsToken(attribution?.[SMS_TOKEN_QUERY]);
  return token ? { sms_token: token } : {};
}

// ---- Navegador (cookie de 1ª parte, 30 dias; só o token, nenhum dado pessoal) ----

export function readStoredSmsToken(cookieHeader) {
  const match = String(cookieHeader || "").split(/;\s*/).find((part) => part.startsWith(`${SMS_TOKEN_COOKIE}=`));
  return match ? cleanSmsToken(match.slice(SMS_TOKEN_COOKIE.length + 1)) : "";
}

export function serializeSmsTokenCookie(token, { secure = false } = {}) {
  return `${SMS_TOKEN_COOKIE}=${cleanSmsToken(token)}; Max-Age=${SMS_TOKEN_MAX_AGE_DAYS * 86400}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function tokenFromParams(searchParams) {
  return cleanSmsToken(searchParams && typeof searchParams.get === "function" ? searchParams.get(SMS_TOKEN_QUERY) : "");
}

// Token da URL de agora (`?sms_t=`) ou, sem ele, o guardado no cookie.
export function currentSmsToken(searchParams) {
  const fromUrl = tokenFromParams(searchParams);
  if (fromUrl) return fromUrl;
  return typeof document === "undefined" ? "" : readStoredSmsToken(document.cookie);
}

// Chamado em toda página pública: só grava quando a URL trouxe o token (clique novo substitui o guardado).
export function persistSmsToken(searchParams) {
  if (typeof document === "undefined") return;
  const token = tokenFromParams(searchParams);
  if (!token) return;
  try {
    document.cookie = serializeSmsTokenCookie(token, { secure: window.location.protocol === "https:" });
  } catch {
    // cookies bloqueados: o cadastro ainda leva o token da URL atual.
  }
}
