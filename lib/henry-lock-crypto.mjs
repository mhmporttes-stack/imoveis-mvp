// Hash da senha da tela de bloqueio do Henry (HENRY-LOCK) e do token do desbloqueio. SÓ NO SERVIDOR (node:crypto).
// Senha: scrypt com salt aleatório de 16 bytes, guardada como "scrypt$N$r$p$salt$hash" (base64url). Nunca a senha em si,
// nunca em log. Comparação em tempo constante.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { isValidHenryPin } from "./henry-lock-core.mjs";

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });

export function hashHenryPin(pin, { salt = randomBytes(16) } = {}) {
  if (!isValidHenryPin(pin)) throw new Error("A senha precisa ter 6 dígitos.");
  const hash = scryptSync(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, Buffer.from(salt).toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyHenryPin(pin, stored) {
  if (!isValidHenryPin(pin) || typeof stored !== "string") return false;
  const [kind, n, r, p, saltText, hashText] = stored.split("$");
  if (kind !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!expected.length || !Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false;
  const actual = scryptSync(pin, Buffer.from(saltText, "base64url"), expected.length, { N, r: R, p: P });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Token do desbloqueio: aleatório no cookie HttpOnly; no banco só o SHA-256 dele.
export function newHenryUnlockToken() {
  return randomBytes(32).toString("base64url");
}

export function hashHenryUnlockToken(token) {
  return typeof token === "string" && token.length >= 20 ? createHash("sha256").update(token).digest("hex") : "";
}
