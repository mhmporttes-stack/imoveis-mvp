// Regras PURAS do app de desktop (sem Electron, testáveis com node --test). Pedido do dono em 2026-10-23
// (docs/BUSINESS_RULES.md HENRY-1, "App de desktop"): o app só abre o CRM de produção; o resto vai para o navegador.
// Toda decisão de segurança (origem, permissão, navegação, ações da ponte) mora aqui — main.js só aplica.
"use strict";

const CRM_HOME = "https://www.matheusmachadoimoveis.com.br/admin";
const ALLOWED_ORIGINS = Object.freeze(["https://www.matheusmachadoimoveis.com.br", "https://matheusmachadoimoveis.com.br"]);
// Permissões concedidas sozinhas, só para as origens acima: microfone/câmera, notificação, tela cheia e "copiar".
const AUTO_PERMISSIONS = Object.freeze(["media", "notifications", "fullscreen", "clipboard-sanitized-write"]);
// Protocolos que podem sair para o sistema (navegador padrão, Spotify, e-mail, telefone, WhatsApp).
const EXTERNAL_PROTOCOLS = Object.freeze(["https:", "http:", "mailto:", "tel:", "spotify:", "whatsapp:"]);
const SPOTIFY_URI = /^spotify:(track|playlist|album|artist):[A-Za-z0-9]+$/;
const MAX_TITLE = 80;
const MAX_BODY = 200;
const MAX_URL = 2000;

function parseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function isAllowedOrigin(value) {
  const url = parseUrl(value);
  return Boolean(url) && url.protocol === "https:" && ALLOWED_ORIGINS.includes(url.origin);
}

// Para onde vai uma navegação/janela nova: "app" (fica no app), "external" (sistema) ou "block".
function classifyNavigation(value) {
  if (isAllowedOrigin(value)) return "app";
  const url = parseUrl(value);
  if (!url || String(value).length > MAX_URL) return "block";
  return EXTERNAL_PROTOCOLS.includes(url.protocol) ? "external" : "block";
}

function shouldGrantPermission({ permission, origin, mediaTypes } = {}) {
  if (!isAllowedOrigin(origin)) return false;
  if (!AUTO_PERMISSIONS.includes(permission)) return false;
  if (permission === "media" && Array.isArray(mediaTypes)) return mediaTypes.every((type) => type === "audio" || type === "video");
  return true;
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Lista FECHADA de ações da ponte (window.mmDesktop). Devolve { ok, action, args } ou { ok: false, error }.
// Nada de comando arbitrário: cada ação tem o seu formato e nada mais passa.
function validateAction(action, payload) {
  const args = payload && typeof payload === "object" ? payload : {};
  switch (action) {
    case "openSpotify": {
      const uri = String(args.uri || "");
      return SPOTIFY_URI.test(uri) ? { ok: true, action, args: { uri } } : { ok: false, error: "uri_invalida" };
    }
    case "openUrl": {
      const url = parseUrl(args.url);
      if (!url || url.protocol !== "https:" || String(args.url).length > MAX_URL) return { ok: false, error: "url_invalida" };
      return { ok: true, action, args: { url: url.toString() } };
    }
    case "notify": {
      const title = cleanText(args.title, MAX_TITLE);
      if (!title) return { ok: false, error: "titulo_vazio" };
      return { ok: true, action, args: { title, body: cleanText(args.body, MAX_BODY) } };
    }
    case "screenOff":
    case "screenOn":
      return { ok: true, action, args: {} };
    default:
      return { ok: false, error: "acao_desconhecida" };
  }
}

// Linha do log local: data, ação, resultado e no máximo o destino (URI do Spotify / endereço) — nunca o texto do aviso.
function formatLogLine({ at = new Date(), action = "", ok = false, detail = "" } = {}) {
  const safeDetail = cleanText(detail, 300);
  return `${at.toISOString()} ${cleanText(action, 40) || "?"} ${ok ? "ok" : "recusado"}${safeDetail ? ` ${safeDetail}` : ""}\n`;
}

module.exports = {
  CRM_HOME,
  ALLOWED_ORIGINS,
  AUTO_PERMISSIONS,
  EXTERNAL_PROTOCOLS,
  SPOTIFY_URI,
  isAllowedOrigin,
  classifyNavigation,
  shouldGrantPermission,
  validateAction,
  formatLogLine
};
