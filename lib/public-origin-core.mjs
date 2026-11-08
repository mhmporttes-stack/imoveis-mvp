// Atrás do túnel (Cloudflare → servidor local) o Next enxerga o endereço interno (127.0.0.1:3000). Com
// MM_PRODUCTION_HOST=1, rewrites e redirects usam o endereço público (x-forwarded-host/proto): rewrite com host
// diferente do da requisição vira "proxy externo" (500 EPROTO) e o redirect levaria o visitante ao endereço interno.
export function applyPublicOrigin(url, headers) {
  if (process.env.MM_PRODUCTION_HOST !== "1") return url;
  const host = (headers.get("x-forwarded-host") || "").split(",")[0].trim();
  const proto = (headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  if (host && /^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) {
    const [name, port = ""] = host.split(":");
    url.hostname = name;
    url.port = port;
  }
  if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
  return url;
}

// Rewrite fica DENTRO do servidor: com host/protocolo públicos o Next o trataria como proxy externo.
// Mantém o host que o Next já enxerga e usa http (o servidor local não fala TLS).
export function internalRewriteTarget(url) {
  if (process.env.MM_PRODUCTION_HOST === "1") url.protocol = "http:";
  return url;
}
