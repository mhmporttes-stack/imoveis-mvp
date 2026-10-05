// Resposta dos links curtos: um HTML mínimo com a prévia (Open Graph + Twitter Card) — é o que Instagram, WhatsApp e
// demais crawlers leem, direto no endereço curto, sem depender de seguir redirecionamentos (que o Instagram Direct não
// faz bem). Quem abre o link no navegador é levado na hora ao destino de sempre (meta refresh + script).
const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildSharePreviewHtml({ pageUrl, targetUrl, title, description, image, imageAlt }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(pageUrl);
  const i = escapeHtml(image);
  const a = escapeHtml(imageAlt);
  const target = escapeHtml(targetUrl);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${u}">
<meta property="og:type" content="website">
<meta property="og:url" content="${u}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:site_name" content="Matheus Machado Imóveis">
<meta property="og:locale" content="pt_BR">
<meta property="og:image" content="${i}">
<meta property="og:image:secure_url" content="${i}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${a}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${i}">
<meta name="twitter:image:alt" content="${a}">
<meta http-equiv="refresh" content="0;url=${target}">
<script>location.replace(${JSON.stringify(targetUrl).replace(/</g, "\u003c")});</script>
</head>
<body><p><a href="${target}">${t}</a></p></body>
</html>`;
}

export function sharePreviewResponse(request, targetUrl, preview) {
  const pageUrl = `${request.nextUrl.origin}${request.nextUrl.pathname}`;
  return new Response(buildSharePreviewHtml({ pageUrl, targetUrl: String(targetUrl), ...preview }), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" }
  });
}
