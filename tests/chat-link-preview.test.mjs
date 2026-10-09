import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  checkExternalUrl,
  firstLinkInText,
  isBlockedIp,
  isOwnSiteUrl,
  ownSitePreview,
  parseOpenGraph,
  SITE_DEFAULT_SHARE
} from "../lib/chat-link-preview-core.mjs";
import { CAPTACAO_SHARE, SHARE_IMAGE, SHARE_TITLE } from "../lib/simulacao-share.mjs";
import { buildShareMetadata } from "../lib/simulation-presentation-share.mjs";
import { isPresentationToken } from "../lib/simulation-presentation-core.mjs";

// Prévia de link do Chat (cartão "como no WhatsApp", 2026-10-09).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const TOKEN = "aB3dEfGhIjKlMnOpQrStUvW9";

test("acha o primeiro link do texto (sem pontuação final)", () => {
  assert.equal(firstLinkInText("Preenche aqui: https://www.matheusmachadoimoveis.com.br/s/mhm. Obrigado"), "https://www.matheusmachadoimoveis.com.br/s/mhm");
  assert.equal(firstLinkInText("sem link nenhum"), "");
  assert.equal(firstLinkInText("dois: http://a.com.br/x e https://b.com"), "http://a.com.br/x");
});

test("links do próprio site: domínio da marca, www e o host técnico da Vercel", () => {
  assert.equal(isOwnSiteUrl("https://matheusmachadoimoveis.com.br/s"), true);
  assert.equal(isOwnSiteUrl("https://www.matheusmachadoimoveis.com.br/c/abc123"), true);
  assert.equal(isOwnSiteUrl("https://imoveis-mvp.vercel.app/simulacao?ref=mhm"), true);
  assert.equal(isOwnSiteUrl("https://matheusmachadoimoveis.com.br.evil.com/s"), false);
  assert.equal(isOwnSiteUrl("https://exemplo.com.br/s"), false);
  assert.equal(isOwnSiteUrl("javascript:alert(1)"), false);
});

test("prévia do site usa os mesmos textos/imagens de Open Graph do site", () => {
  for (const url of ["https://www.matheusmachadoimoveis.com.br/s", "https://www.matheusmachadoimoveis.com.br/s/mhm", "https://matheusmachadoimoveis.com.br/c/abc123", "https://www.matheusmachadoimoveis.com.br/simulacao?ref=bruna"]) {
    const preview = ownSitePreview(url);
    assert.equal(preview.title, SHARE_TITLE, url);
    assert.equal(preview.image, SHARE_IMAGE, url);
    assert.equal(preview.domain, "matheusmachadoimoveis.com.br");
    assert.equal(preview.own, true);
  }
  for (const url of ["https://www.matheusmachadoimoveis.com.br/v", "https://www.matheusmachadoimoveis.com.br/v/mhm", "https://www.matheusmachadoimoveis.com.br/captacao"]) {
    assert.equal(ownSitePreview(url).title, CAPTACAO_SHARE.title, url);
    assert.equal(ownSitePreview(url).image, CAPTACAO_SHARE.image, url);
  }
  const journey = ownSitePreview("https://www.matheusmachadoimoveis.com.br/j/abc");
  assert.equal(journey.title, "Minha Jornada");
  assert.equal(journey.image, SITE_DEFAULT_SHARE.image);
  assert.equal(ownSitePreview("https://www.matheusmachadoimoveis.com.br/").title, SITE_DEFAULT_SHARE.title);
  assert.equal(ownSitePreview("https://imoveis-mvp.vercel.app/s").domain, "imoveis-mvp.vercel.app");
  // Painel e API: sem prévia.
  assert.equal(ownSitePreview("https://www.matheusmachadoimoveis.com.br/admin/chat"), null);
  assert.equal(ownSitePreview("https://www.matheusmachadoimoveis.com.br/api/x"), null);
  assert.equal(ownSitePreview("https://exemplo.com.br/s"), null);
});

test("apresentação /s/<token>: imagem por token e título genérico do próprio site", () => {
  assert.equal(isPresentationToken(TOKEN), true);
  const meta = buildShareMetadata({ token: TOKEN, firstName: "" });
  const preview = ownSitePreview(`https://www.matheusmachadoimoveis.com.br/s/${TOKEN}`);
  assert.equal(preview.title, meta.openGraph.title);
  assert.equal(preview.description, meta.openGraph.description);
  assert.equal(preview.image, meta.openGraph.images[0].url);
  assert.equal(preview.imageAlt, meta.openGraph.images[0].alt);
});

test("textos fixos continuam iguais aos metadados das páginas", () => {
  const layout = read("app/layout.jsx");
  assert.ok(layout.includes(`title: "${SITE_DEFAULT_SHARE.title}"`));
  assert.ok(layout.includes(`description: "${SITE_DEFAULT_SHARE.description}"`));
  assert.ok(layout.includes(SITE_DEFAULT_SHARE.image));
  assert.ok(read("app/minha-jornada/[token]/page.jsx").includes('title: "Minha Jornada"'));
  assert.ok(read("app/simulacao/equipe/page.jsx").includes('title: "Simulação de financiamento | Equipe Matheus Machado"'));
});

test("SSRF: bloqueia IPs privados, locais e reservados (v4 e v6)", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "[::1]"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "2804:14c::1", "::ffff:8.8.8.8", "exemplo.com.br"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("SSRF: URL externa só http/https, porta padrão, sem credencial nem host local", () => {
  assert.equal(checkExternalUrl("https://www.exemplo.com.br/a?b=1").ok, true);
  assert.equal(checkExternalUrl("http://exemplo.com:80/").ok, true);
  for (const url of ["file:///etc/passwd", "ftp://exemplo.com", "http://localhost:3000", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "https://user:pass@exemplo.com", "https://exemplo.com:8080/", "http://intranet/", "http://servidor.local/", "", "não é url"]) {
    assert.equal(checkExternalUrl(url).ok, false, url);
  }
});

test("Open Graph: título, descrição, imagem absoluta https e domínio", () => {
  const html = `<!doctype html><html><head><title>Fallback</title>
    <meta property="og:title" content="Casa &amp; Jardim — 2 quartos">
    <meta content="Ótima casa em Marília" property="og:description">
    <meta property="og:image" content="/img/capa.jpg">
    </head><body><meta property="og:title" content="ignorado"></body></html>`;
  const preview = parseOpenGraph(html, "https://www.exemplo.com.br/anuncio/1");
  assert.equal(preview.title, "Casa & Jardim — 2 quartos");
  assert.equal(preview.description, "Ótima casa em Marília");
  assert.equal(preview.image, "https://www.exemplo.com.br/img/capa.jpg");
  assert.equal(preview.domain, "exemplo.com.br");
  assert.equal(preview.own, false);
});

test("Open Graph: fallback para <title>/description; imagem http ou interna é descartada; página vazia = null", () => {
  const preview = parseOpenGraph(`<head><title> Só título </title><meta name="description" content="desc"><meta property="og:image" content="http://exemplo.com/a.jpg"></head>`, "https://exemplo.com/");
  assert.equal(preview.title, "Só título");
  assert.equal(preview.description, "desc");
  assert.equal(preview.image, "");
  assert.equal(parseOpenGraph(`<head><meta property="og:image" content="https://127.0.0.1/x.png"></head>`, "https://exemplo.com/"), null);
  assert.equal(parseOpenGraph("<html><body>nada</body></html>", "https://exemplo.com/"), null);
});

test("Chat: rota de prévia tem guard e a tela nunca busca o Supabase", () => {
  const route = read("app/api/admin/whatsapp-chat/link-preview/route.js");
  assert.match(route, /const auth = await requireAdminApi\(request\);\s*if \(!auth\.ok\)/);
  const chat = read("components/WhatsappChat.jsx");
  assert.ok(!/supabase/i.test(chat.match(/function useLinkPreview[\s\S]*?\n}\n/)[0]));
  assert.match(read("lib/whatsapp-chat.js"), /\.\.\.messageLinkPreview\(row, revoked\)/);
});
