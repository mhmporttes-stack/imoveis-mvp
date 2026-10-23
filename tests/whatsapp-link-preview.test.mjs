// Prévia de link nas mensagens do WhatsApp do corretor (dono, 2026-10-23). Sem rede: fetch falso. Nada é enviado.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINK_PREVIEW_USER_AGENT, buildLinkPreview, firstUrl, parseOpenGraph } from "../whatsapp-individual-service/src/link-preview.js";

const HTML = `<!doctype html><html><head><title>Sua simulação</title>
<meta property="og:title" content="Ana, sua simulação está pronta">
<meta property="og:description" content="Veja as condições &amp; parcelas">
<meta property="og:image" content="https://www.matheusmachadoimoveis.com.br/s/AbCdEf123456789012345678/og">
</head><body></body></html>`;

const response = (body, { status = 200, url = "" } = {}) => ({ ok: status >= 200 && status < 300, status, url, body: null, arrayBuffer: async () => (typeof body === "string" ? new TextEncoder().encode(body).buffer : body) });

test("primeira URL do texto, sem pontuação final", () => {
  assert.equal(firstUrl("Oi! https://www.matheusmachadoimoveis.com.br/s/AbC123."), "https://www.matheusmachadoimoveis.com.br/s/AbC123");
  assert.equal(firstUrl("veja (https://x.com/a?b=1)"), "https://x.com/a?b=1");
  assert.equal(firstUrl("sem link"), "");
});

test("lê og:title/og:description/og:image (com entidades e imagem relativa virando absoluta)", () => {
  assert.deepEqual(parseOpenGraph(HTML, "https://www.matheusmachadoimoveis.com.br/s/x"), {
    title: "Ana, sua simulação está pronta",
    description: "Veja as condições & parcelas",
    image: "https://www.matheusmachadoimoveis.com.br/s/AbCdEf123456789012345678/og"
  });
  const relative = parseOpenGraph(`<title>T</title><meta content="/img.png" property="og:image">`, "https://site.com/p/1");
  assert.equal(relative.title, "T");
  assert.equal(relative.image, "https://site.com/img.png");
});

test("monta a prévia com miniatura, pedindo a página como o robô do WhatsApp", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ua: options.headers["User-Agent"] });
    return url.endsWith("/og") ? response(new Uint8Array([1, 2, 3]).buffer) : response(HTML);
  };
  const thumb = Buffer.from("jpg");
  const { preview, reason } = await buildLinkPreview({ text: "Sua simulação: https://www.matheusmachadoimoveis.com.br/s/AbCdEf123456789012345678", fetchImpl, makeThumbnail: async (buffer) => {
    assert.equal(buffer.length, 3);
    return { jpegThumbnail: thumb, highQualityThumbnail: { directPath: "/x" } };
  } });
  assert.equal(reason, "ok");
  assert.equal(preview.title, "Ana, sua simulação está pronta");
  assert.equal(preview["matched-text"], "https://www.matheusmachadoimoveis.com.br/s/AbCdEf123456789012345678");
  assert.equal(preview.jpegThumbnail, thumb);
  assert.deepEqual(preview.highQualityThumbnail, { directPath: "/x" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.ua === LINK_PREVIEW_USER_AGENT));
});

test("falhas nunca impedem o envio: sem prévia ou prévia sem imagem, com o motivo", async () => {
  assert.deepEqual(await buildLinkPreview({ text: "sem link" }), { preview: null, reason: "sem_link" });
  assert.equal((await buildLinkPreview({ text: "https://a.com", fetchImpl: async () => response("", { status: 404 }) })).reason, "pagina_404");
  assert.equal((await buildLinkPreview({ text: "https://a.com", fetchImpl: async () => { throw new Error("rede"); } })).reason, "pagina_erro");
  assert.equal((await buildLinkPreview({ text: "https://a.com", fetchImpl: async () => response("<html></html>") })).reason, "sem_titulo");
  const noImage = await buildLinkPreview({ text: "https://a.com", fetchImpl: async (url) => (url.endsWith("/og") ? response("", { status: 500 }) : response(HTML)), makeThumbnail: async () => ({}) });
  assert.equal(noImage.preview.title, "Ana, sua simulação está pronta");
  assert.equal(noImage.reason, "imagem_500");
  const slowThumb = await buildLinkPreview({ text: "https://a.com", timeoutMs: 50, fetchImpl: async (url) => (url.endsWith("/og") ? response(new Uint8Array([1]).buffer) : response(HTML)), makeThumbnail: () => new Promise(() => {}) });
  assert.equal(slowThumb.reason, "imagem_prazo");
  assert.equal(slowThumb.preview.jpegThumbnail, undefined);
});

test("prazo da página: abort vira 'pagina_prazo'", async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))));
  const keepAlive = setTimeout(() => {}, 1000); // o timer do AbortSignal.timeout não segura o processo sozinho
  assert.deepEqual(await buildLinkPreview({ text: "https://a.com", fetchImpl, timeoutMs: 30 }), { preview: null, reason: "pagina_prazo" });
  clearTimeout(keepAlive);
});

test("fiação: todo envio de texto com link espera a prévia; sem prévia vai null (o Baileys não tenta de novo)", () => {
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(sessions, /if \(!media\?\.url && firstUrl\(text\)\) content\.linkPreview = await prepareLinkPreview\(userId, sock, text\);/);
  assert.match(sessions, /return result\.preview \|\| null;/);
  assert.match(sessions, /mediaTypeOverride: "thumbnail-link"/);
});
