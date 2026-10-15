import { SITE_URL } from "@/lib/public-seo";

// robots.txt (dono, 2026-10-15): o painel e as APIs ficam fora dos buscadores.
export default function robots() {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
