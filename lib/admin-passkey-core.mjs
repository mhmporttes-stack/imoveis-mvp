// Face ID / Windows Hello para DESBLOQUEAR a tela do Henry (REGRA OFICIAL — dono, 2026-10-24; docs/BUSINESS_RULES.md
// HENRY-LOCK "Face ID"). Parte PURA (sem banco, sem Next, sem biblioteca): domínio (RP ID), desafios de uso único,
// contador contra repetição, nome do aparelho e quem pode usar. Testes em tests/admin-passkeys.test.mjs.
// A biometria nunca sai do aparelho: o servidor guarda só a chave pública da chave de acesso (WebAuthn/passkey).
import { createHash } from "node:crypto";

// Domínio de produção. O RP ID é o domínio registrável: vale para www e sem www (o app de desktop abre o www).
export const PASSKEY_RP_ID = "matheusmachadoimoveis.com.br";
export const PASSKEY_RP_NAME = "Matheus Machado Corretor de Imóveis";
export const PASSKEY_PRODUCTION_ORIGINS = Object.freeze([`https://www.${PASSKEY_RP_ID}`, `https://${PASSKEY_RP_ID}`]);

export const PASSKEY_PURPOSE = Object.freeze({ REGISTER: "register", HENRY_UNLOCK: "henry_unlock" });
// Desafio vale pouco tempo e uma vez só (o pedido do Face ID tem 60–120 s para ser respondido).
export const PASSKEY_CHALLENGE_TTL_MS = Object.freeze({ register: 3 * 60 * 1000, henry_unlock: 2 * 60 * 1000 });
export const PASSKEY_TIMEOUT_MS = Object.freeze({ register: 120 * 1000, henry_unlock: 60 * 1000 });
// ES256 (iPhone, Mac, Android, Windows Hello novo) e RS256 (Windows Hello antigo).
export const PASSKEY_ALGORITHMS = Object.freeze([-7, -257]);
export const PASSKEY_MAX_DEVICES = 10;
const MAX_DEVICE_NAME = 60;

// Só a conta do dono, na conta real (fora de "Alterar conta") — o mesmo critério do Henry (HENRY-1). Gestores,
// corretores e associados não usam.
export function isPasskeyEligible({ ok = true, isOwner = false, accountSwitchMode = false } = {}) {
  return Boolean(ok && isOwner && !accountSwitchMode);
}

// De onde veio o pedido → RP ID e origens aceitas. Produção: www e sem www. Desenvolvimento local: só "localhost"
// (IP não pode ser RP ID). Qualquer outro endereço (ex.: imoveis-mvp.vercel.app) não usa Face ID → null.
export function resolvePasskeyRp({ hostname = "", origin = "", production = true } = {}) {
  const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (host === PASSKEY_RP_ID || host === `www.${PASSKEY_RP_ID}`) {
    return { rpID: PASSKEY_RP_ID, origins: [...PASSKEY_PRODUCTION_ORIGINS] };
  }
  if (!production && host === "localhost" && /^https?:\/\/localhost(:\d+)?$/.test(String(origin || ""))) {
    return { rpID: "localhost", origins: [String(origin)] };
  }
  return null;
}

export const PASSKEY_WRONG_HOST_MESSAGE = `O Face ID só funciona no endereço oficial (${PASSKEY_RP_ID}).`;

// No banco fica só o SHA-256 do desafio (o desafio em si vai ao aparelho e volta assinado).
export function hashPasskeyChallenge(challenge) {
  return createHash("sha256").update(String(challenge || "")).digest("hex");
}

export function passkeyChallengeExpiresAt(purpose, nowMs) {
  const ttl = PASSKEY_CHALLENGE_TTL_MS[purpose];
  if (!ttl) throw new Error("Finalidade de desafio desconhecida.");
  return new Date(nowMs + ttl).toISOString();
}

// Desafio aceito: mesma conta, mesma finalidade, mesmo hash, ainda não usado e dentro do prazo.
export function isPasskeyChallengeUsable(row, { userId, purpose, challengeHash, nowMs }) {
  return Boolean(
    row && userId && row.user_id === userId && row.purpose === purpose && row.challenge_hash === challengeHash &&
      !row.used_at && new Date(row.expires_at).getTime() > nowMs
  );
}

// Contador de assinaturas (WebAuthn §7.2): se o aparelho conta (qualquer lado > 0), o novo tem que ser MAIOR que o
// guardado — igual ou menor = assinatura repetida/clonada. Chave sincronizada do iCloud manda sempre 0: aí a proteção
// contra repetição é o desafio de uso único.
export function isPasskeyCounterAccepted(storedCounter, newCounter) {
  const stored = Number(storedCounter) || 0;
  const next = Number(newCounter) || 0;
  if (next === 0 && stored === 0) return true;
  return next > stored;
}

// Nome do aparelho na lista do cartão (o dono reconhece qual remover). Nome digitado vence; senão, pelo navegador.
export function passkeyDeviceName({ name = "", userAgent = "", nowMs = Date.now() } = {}) {
  const typed = String(name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_DEVICE_NAME);
  if (typed) return typed;
  const ua = String(userAgent || "");
  const kind = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? /Electron/.test(ua) ? "Windows (app do CRM)" : "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : "Aparelho";
  const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(nowMs));
  return `${kind} — ${date}`;
}

// Só os transportes conhecidos do WebAuthn vão para o banco (o resto do navegador é ignorado).
const KNOWN_TRANSPORTS = new Set(["internal", "hybrid", "usb", "nfc", "ble", "smart-card", "cable"]);
export function cleanPasskeyTransports(list) {
  return Array.isArray(list) ? [...new Set(list.filter((item) => KNOWN_TRANSPORTS.has(item)))] : [];
}
