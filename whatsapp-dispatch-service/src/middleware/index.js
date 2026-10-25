import { ZodError } from "zod";
import { HttpError } from "../utils/errors.js";
import { safeEqual, sha256Hex } from "../utils/crypto.js";
import { sanitizeText } from "../utils/logger.js";

// Autenticação por token (Bearer) com papel: crm | admin | viewer. Tokens só em variável de ambiente.
export function authenticate(config) {
  const tokens = [
    ["admin", config.ADMIN_API_TOKEN],
    ["crm", config.CRM_API_TOKEN],
    ["viewer", config.READONLY_API_TOKEN]
  ].filter(([, t]) => t && t.length >= 32);
  return (req, res, next) => {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const match = token ? tokens.find(([, t]) => safeEqual(token, t)) : null;
    if (!match) return res.status(401).json({ error: "Não autenticado.", code: "unauthorized" });
    req.role = match[0];
    req.actor = `api:${match[0]}`;
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (req.role === "admin" || roles.includes(req.role)) return next();
    return res.status(403).json({ error: "Sem permissão para esta operação.", code: "forbidden" });
  };
}

// Limite de requisições por chave (token/IP) em memória — funciona mesmo com Redis fora.
export function rateLimit({ perMinute }) {
  const buckets = new Map();
  setInterval(() => buckets.clear(), 10 * 60 * 1000).unref();
  return (req, res, next) => {
    const key = req.headers.authorization ? `t:${sha256Hex(String(req.headers.authorization)).slice(0, 16)}` : `ip:${req.ip}`;
    const now = Date.now();
    const b = buckets.get(key) || { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
    b.at = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "Muitas requisições.", code: "rate_limited" });
    }
    b.tokens -= 1;
    buckets.set(key, b);
    next();
  };
}

// CORS restritivo: só as origens listadas em CORS_ALLOWED_ORIGINS. Sem lista = nenhuma origem de navegador.
export function cors(allowed) {
  const set = new Set(allowed);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    if (!set.has(origin)) return res.status(403).json({ error: "Origem não permitida.", code: "cors_forbidden" });
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  };
}

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

export function requestLog(logger) {
  return (req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      // Sem query string (pode conter hub.verify_token) e sem corpo.
      logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started, role: req.role || null }, "http");
    });
    next();
  };
}

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: "Dados inválidos.", code: "invalid_request", details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido.", code: "invalid_json" });
    if (error?.type === "entity.too.large") return res.status(413).json({ error: "Corpo grande demais.", code: "too_large" });
    logger.error({ err: sanitizeText(error?.message), path: req.path }, "erro interno");
    return res.status(500).json({ error: "Erro interno.", code: "internal_error" });
  };
}
