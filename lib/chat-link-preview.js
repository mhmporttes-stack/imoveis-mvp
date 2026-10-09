import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { checkExternalUrl, isBlockedIp, isOwnSiteUrl, ownSitePreview, parseOpenGraph } from "./chat-link-preview-core.mjs";

// Prévia de link do Chat (cartão "como no WhatsApp"). Link do próprio site: textos fixos do site (sem rede).
// Link externo: o SERVIDOR baixa só o começo do HTML (≤ 3 s, ≤ 512 KB, até 3 redirecionamentos, cada um revalidado)
// e lê as tags Open Graph. Contra SSRF: URL validada (checkExternalUrl) e o IP é checado NA CONEXÃO (lookup próprio),
// o que também barra DNS que aponta para rede interna. Falhou → null (o Chat mostra só o link azul).
const TIMEOUT_MS = 3000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_OK_MS = 6 * 60 * 60 * 1000;
const CACHE_FAIL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length || list.some((entry) => isBlockedIp(entry.address))) {
      return callback(Object.assign(new Error("Endereço bloqueado para prévia de link."), { code: "BLOCKED_ADDRESS" }));
    }
    if (options?.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function requestOnce(url, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error("timeout"));
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, {
      lookup: safeLookup,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MatheusMachadoImoveis-LinkPreview/1.0; +https://www.matheusmachadoimoveis.com.br)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
        "Accept-Language": "pt-BR,pt;q=0.9"
      }
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.destroy();
        try {
          return resolve({ redirect: new URL(response.headers.location, url).href });
        } catch {
          return resolve({ html: "" });
        }
      }
      const type = String(response.headers["content-type"] || "").toLowerCase();
      if (status !== 200 || !type.includes("html")) {
        response.destroy();
        return resolve({ html: "" });
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        chunks.push(chunk);
        size += chunk.length;
        // O <head> basta: para cedo no limite de tamanho ou quando ele termina.
        if (size >= MAX_BYTES || chunk.toString("latin1").toLowerCase().includes("</head>")) response.destroy();
      });
      const finish = () => resolve({ html: Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8") });
      response.on("end", finish);
      response.on("close", finish);
      response.on("error", finish);
    });
    // Prazo TOTAL (não só de ociosidade): site que manda o HTML em gotas também é cortado em 3 s.
    const timer = setTimeout(() => request.destroy(new Error("timeout")), remaining);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}

async function fetchExternalPreview(startUrl) {
  const deadline = Date.now() + TIMEOUT_MS;
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await requestOnce(current, deadline);
    if (!result.redirect) return result.html ? parseOpenGraph(result.html, current) : null;
    const next = checkExternalUrl(result.redirect);
    if (!next.ok) return null;
    current = next.url;
  }
  return null;
}

function remember(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + (value ? CACHE_OK_MS : CACHE_FAIL_MS) });
  return value;
}

/** Prévia { url, domain, title, description, image, imageAlt, own } ou null. Erro de validação: lança com status 400. */
export async function getChatLinkPreview(rawUrl) {
  const own = ownSitePreview(rawUrl);
  if (own) return own;
  // Painel/API do próprio site: sem prévia (nunca busca o próprio servidor).
  if (isOwnSiteUrl(rawUrl)) return null;
  const checked = checkExternalUrl(rawUrl);
  if (!checked.ok) throw Object.assign(new Error("Link inválido para prévia."), { status: 400 });
  const hit = cache.get(checked.url);
  if (hit && hit.expires > Date.now()) return hit.value;
  let preview = null;
  try {
    preview = await fetchExternalPreview(checked.url);
  } catch (error) {
    // Site fora do ar, lento ou bloqueado: sem prévia (o Chat mostra o link). Fica registrado no log do servidor.
    console.warn("Prévia de link do Chat indisponível:", new URL(checked.url).hostname, error?.code || error?.message || error);
  }
  return remember(checked.url, preview);
}
