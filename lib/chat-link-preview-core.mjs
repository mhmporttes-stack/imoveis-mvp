// Prévia de link no Chat (cartão "como no WhatsApp", pedido do dono em 2026-10-09) — regras PURAS, sem Node nem rede,
// usadas no servidor (lib/whatsapp-chat.js, lib/chat-link-preview.js) e no componente (só o padrão de link).
//  - Links do PRÓPRIO site: a prévia sai dos MESMOS textos/imagens de Open Graph que o site serve (sem buscar nada).
//  - Links externos: validação de URL/IP contra SSRF e leitura das tags Open Graph do HTML baixado pelo servidor.
import { CAPTACAO_SHARE, SHARE_DESCRIPTION, SHARE_IMAGE, SHARE_IMAGE_ALT, SHARE_TITLE } from "./simulacao-share.mjs";
import { CANONICAL_SITE_URL } from "./site-url.mjs";

// Link dentro do texto (o mesmo que o Chat deixa clicável).
export const CHAT_LINK_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/gi;

export function firstLinkInText(text = "") {
  const match = String(text || "").match(new RegExp(CHAT_LINK_PATTERN.source, "i"));
  return match ? match[1] : "";
}

const OWN_HOSTS = new Set(["matheusmachadoimoveis.com.br", "www.matheusmachadoimoveis.com.br", "imoveis-mvp.vercel.app"]);

// Espelham os metadados das páginas (app/layout.jsx, app/minha-jornada/[token]/page.jsx, app/simulacao/equipe/page.jsx,
// lib/simulation-presentation-share.mjs). tests/chat-link-preview.test.mjs confere que continuam iguais.
export const SITE_DEFAULT_SHARE = {
  title: "Matheus Machado - Corretor de Imóveis",
  description: "Empreendimentos imobiliários em Marília com atendimento consultivo.",
  image: `${CANONICAL_SITE_URL}/assets/og-matheus-machado-v2.png`,
  imageAlt: "Matheus Machado - Corretor de Imóveis"
};
const SIMULATION_SHARE = { title: SHARE_TITLE, description: SHARE_DESCRIPTION, image: SHARE_IMAGE, imageAlt: SHARE_IMAGE_ALT };
const TEAM_SIMULATION_TITLE = "Simulação de financiamento | Equipe Matheus Machado";
const JOURNEY_TITLE = "Minha Jornada";
// Apresentação da simulação (/s/<token>): o site põe o primeiro nome no título; aqui vai o título genérico do próprio
// site (sem consultar a apresentação, que contaria visualização) e a mesma imagem de prévia por token (que já traz o nome).
const PRESENTATION_TITLE = "Sua simulação de financiamento está pronta";
const PRESENTATION_DESCRIPTION = "Matheus Machado · Corretor de imóveis";
const PRESENTATION_IMAGE_ALT = "Sua simulação de financiamento está pronta | Matheus Machado, Corretor de Imóveis";
// Mesmo formato de proxy.js (PRESENTATION_TOKEN_PATH) / isPresentationToken.
const PRESENTATION_TOKEN = /^(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{24}$/;

export function displayDomain(url = "") {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function parseUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function isOwnSiteUrl(raw) {
  const url = parseUrl(raw);
  return Boolean(url && OWN_HOSTS.has(url.hostname.toLowerCase()));
}

// Apresentação da simulação enviada PELO NÚMERO OFICIAL (pedido do dono, 2026-10-09): em vez do link cru, vai uma mensagem
// com a imagem de prévia no topo e o botão "Visualizar simulação". Só vale quando o texto é APENAS o link /s/<token> do
// próprio site (o que "Enviar simulação" deixa no campo). Qualquer outra mensagem segue como texto normal. Rótulo: máx. 20
// caracteres (limite do botão da Meta).
export const PRESENTATION_BUTTON_LABEL = "Visualizar simulação";

export function presentationCtaFromText(text = "", { firstName = "" } = {}) {
  const raw = String(text || "").trim();
  if (!raw || /\s/.test(raw)) return null;
  const url = parseUrl(raw);
  if (!url || !OWN_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = url.pathname.match(/^\/s\/([A-Za-z0-9]+)\/?$/);
  if (!match || !PRESENTATION_TOKEN.test(match[1])) return null;
  const name = String(firstName || "").trim().split(/\s+/)[0] || "";
  return {
    url: url.toString(),
    imageUrl: `${url.origin}/s/${match[1]}/og`,
    label: PRESENTATION_BUTTON_LABEL,
    bodyText: name ? `${name}, sua simulação de financiamento está pronta.` : "Sua simulação de financiamento está pronta."
  };
}

// Prévia de um link do próprio site, ou null (link externo, painel/API, URL inválida).
export function ownSitePreview(raw) {
  const url = parseUrl(raw);
  if (!url || !OWN_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const [first = "", second = ""] = parts;
  const head = first.toLowerCase();
  if (head === "admin" || head === "api" || head === "dev") return null;
  let share = SITE_DEFAULT_SHARE;
  if (head === "s" && PRESENTATION_TOKEN.test(second)) {
    share = { title: PRESENTATION_TITLE, description: PRESENTATION_DESCRIPTION, image: `${CANONICAL_SITE_URL}/s/${second}/og`, imageAlt: PRESENTATION_IMAGE_ALT };
  } else if (head === "apresentacao" && PRESENTATION_TOKEN.test(second)) {
    share = { title: PRESENTATION_TITLE, description: PRESENTATION_DESCRIPTION, image: `${CANONICAL_SITE_URL}/s/${second}/og`, imageAlt: PRESENTATION_IMAGE_ALT };
  } else if (head === "simulacao" && second.toLowerCase() === "equipe") {
    share = { ...SITE_DEFAULT_SHARE, title: TEAM_SIMULATION_TITLE };
  } else if (head === "s" || head === "c" || head === "simulacao") {
    share = SIMULATION_SHARE;
  } else if (head === "v" || head === "captacao" || head === "venda-seu-imovel") {
    share = CAPTACAO_SHARE;
  } else if (head === "j" || head === "minha-jornada") {
    share = { ...SITE_DEFAULT_SHARE, title: JOURNEY_TITLE };
  }
  return { url: url.href, domain: displayDomain(url.href), title: share.title, description: share.description, image: share.image, imageAlt: share.imageAlt || "", own: true };
}

// ---------- SSRF: endereços que o servidor nunca pode buscar ----------

function ipv4Parts(value) {
  const parts = String(value).split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? numbers : null;
}

function isBlockedIpv4([a, b]) {
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
}

// Expande um IPv6 em 8 grupos de 16 bits (aceita IPv4 no fim, ex.: ::ffff:10.0.0.1). null se não for IPv6.
function ipv6Groups(value) {
  let text = String(value).toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!text.includes(":")) return null;
  const tail = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const v4 = ipv4Parts(tail[1]);
    if (!v4) return null;
    text = `${text.slice(0, -tail[1].length)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? left.length !== 8 : missing < 1) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

// true quando o texto É um IP (v4 ou v6) privado/local/reservado. Nome de host (não-IP) → false.
export function isBlockedIp(address = "") {
  const v4 = ipv4Parts(address);
  if (v4) return isBlockedIpv4(v4);
  const g = ipv6Groups(address);
  if (!g) return false;
  if (g.every((n) => n === 0)) return true; // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  // IPv4 embutido: ::ffff:a.b.c.d, ::a.b.c.d e 64:ff9b::a.b.c.d
  const embedded = (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0))
    || (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0));
  if (embedded) return isBlockedIpv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
  return (g[0] & 0xfe00) === 0xfc00 // fc00::/7 (privado)
    || (g[0] & 0xffc0) === 0xfe80 // fe80::/10 (link local)
    || (g[0] & 0xff00) === 0xff00 // multicast
    || (g[0] === 0x2001 && g[1] === 0x0db8); // documentação
}

// Valida um link externo antes de qualquer busca: só http/https, sem usuário/senha, porta padrão, sem host local e
// sem IP privado escrito direto. (A resolução de DNS é checada de novo no servidor, no momento da conexão.)
export function checkExternalUrl(raw) {
  const text = String(raw || "").trim();
  if (!text || text.length > 2048) return { ok: false, reason: "invalid" };
  const url = parseUrl(text);
  if (!url) return { ok: false, reason: "protocol" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) return { ok: false, reason: "port" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || (!host.includes(".") && !host.includes(":"))) return { ok: false, reason: "host" };
  if (isBlockedIp(host)) return { ok: false, reason: "private_ip" };
  return { ok: true, url: url.href };
}

// ---------- leitura das tags Open Graph ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
export function decodeHtmlEntities(value = "") {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    result[match[1].toLowerCase()] = decodeHtmlEntities(match[3] ?? match[4] ?? match[5] ?? "");
  }
  return result;
}

const clean = (value, max) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

// Título/descrição/imagem do HTML de uma página. Imagem só https (o painel é https; http viraria conteúdo misto).
// null quando a página não tem nem título nem imagem.
export function parseOpenGraph(html = "", pageUrl = "") {
  const source = String(html || "");
  const headEnd = source.search(/<\/head>|<body[\s>]/i);
  const head = headEnd > 0 ? source.slice(0, headEnd) : source;
  const meta = {};
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = attrs.content;
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = clean(meta["og:title"] || meta["twitter:title"] || (titleTag ? decodeHtmlEntities(titleTag[1]) : ""), 200);
  const description = clean(meta["og:description"] || meta["twitter:description"] || meta.description || "", 300);
  let image = "";
  const rawImage = meta["og:image:secure_url"] || meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || meta["twitter:image:src"] || "";
  if (rawImage) {
    try {
      const resolved = new URL(rawImage.trim(), pageUrl || undefined);
      if (resolved.protocol === "https:" && checkExternalUrl(resolved.href).ok) image = resolved.href;
    } catch {
      image = "";
    }
  }
  if (!title && !image) return null;
  return { url: pageUrl, domain: displayDomain(pageUrl), title, description, image, imageAlt: clean(meta["og:image:alt"] || "", 200), own: false };
}
