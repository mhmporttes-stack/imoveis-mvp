// Domínio que vai nos links enviados a clientes. O host técnico da Vercel (*.vercel.app) NUNCA deve aparecer:
// se NEXT_PUBLIC_SITE_URL estiver apontando para ele (foi assim que o link antigo "imoveis-mvp.vercel.app" chegou
// aos clientes), usa o domínio da marca.
export const CANONICAL_SITE_URL = "https://www.matheusmachadoimoveis.com.br";

export function resolveSiteBaseUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return CANONICAL_SITE_URL;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const host = new URL(withProtocol).hostname.toLowerCase();
    if (host.endsWith(".vercel.app") || host === "vercel.app") return CANONICAL_SITE_URL;
  } catch {
    return CANONICAL_SITE_URL;
  }
  return withProtocol.replace(/\/+$/, "");
}
