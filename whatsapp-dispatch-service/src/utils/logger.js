import pino from "pino";

// Logs estruturados (JSON). Campos sensíveis são redigidos; telefones aparecem mascarados (maskPhone).
const REDACT = [
  "authorization", "*.authorization", "headers.authorization", "req.headers.authorization",
  "token", "*.token", "access_token", "*.access_token", "secret", "*.secret", "password", "*.password",
  "headers['x-service-secret']", "headers['x-hub-signature-256']", "*.text", "*.body"
];

export function createLogger(level = process.env.LOG_LEVEL || "info") {
  return pino({
    level,
    base: { service: "whatsapp-dispatch-service" },
    redact: { paths: REDACT, censor: "[redigido]" },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export const logger = createLogger();

export function maskPhone(phone) {
  const s = String(phone || "");
  if (s.length < 6) return s ? "***" : "";
  return `${s.slice(0, 5)}****${s.slice(-2)}`;
}

// Remove qualquer token que tenha escapado numa mensagem de erro de terceiro (ex.: URL com access_token).
export function sanitizeText(value, max = 500) {
  return String(value ?? "")
    .replace(/(access_token=)[^&\s"]+/gi, "$1[redigido]")
    .replace(/(Bearer|OAuth)\s+[A-Za-z0-9._\-]+/g, "$1 [redigido]")
    .slice(0, max);
}
