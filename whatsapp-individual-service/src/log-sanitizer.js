// FILTRO ÚNICO DO CONSOLE — nada de material de criptografia nos registros da Railway (REGRA OFICIAL — dono, 2026-10-13).
//
// Por que existe: o libsignal (dentro do Baileys) imprime com console.info/warn/error o objeto inteiro de uma sessão do
// protocolo Signal ('Closing session:', 'Opening session:', 'Removing old closed session:', 'Session already closed' +
// SessionEntry com privKey, rootKey, chainKey, baseKey, ephemeralKeyPair...). Quem lê o log lê as chaves da conversa.
// Também despeja ruído sem chave ('Closing open session in favor of incoming prekey bundle', 'Failed to decrypt message
// with any known session...', 'Session error:Error: Bad MAC' + stack). Mensagens conforme libsignal-node (commit fixado no
// package-lock do Baileys 6.7.24): src/session_record.js, session_cipher.js, session_builder.js.
//
// Regra: a chamada do console que contenha QUALQUER argumento sensível (instância SessionEntry, objeto com essas chaves em
// qualquer nível, ou texto que as cite) ou que seja uma mensagem conhecida do libsignal NUNCA é impressa como veio: sai UMA
// linha curta, do tipo '[libsignal] sessão fechada (3)', sem argumento nenhum do original. O resto passa intacto.
// Módulo puro (sem rede, sem Baileys). Instalado por console-guard.js, o primeiro import de server.js.
// Testes: tests/whatsapp-log-sanitizer.test.mjs.

export const SENSITIVE_KEYS = new Set([
  "privKey", "rootKey", "chainKey", "baseKey", "ephemeralKeyPair",
  "lastRemoteEphemeralKey", "remoteIdentityKey", "messageKeys"
]);
const SENSITIVE_TEXT = /\b(?:privKey|rootKey|chainKey|baseKey|ephemeralKeyPair|lastRemoteEphemeralKey|remoteIdentityKey|messageKeys)\b|\bSessionEntry\b/;
const MAX_DEPTH = 5;
const MAX_ITEMS = 60;
const MAX_NODES = 2000;

// Mensagens do libsignal (início do 1º argumento) -> rótulo curto SEM nenhum dado do original.
const LIBSIGNAL_MESSAGES = [
  [/^Closing open session in favor of incoming prekey bundle/i, "sessão aberta substituída por novo prekey bundle"],
  [/^Closing stale open session/i, "sessão aberta antiga fechada"],
  [/^Closing session/i, "sessão fechada"],
  [/^Session already closed/i, "sessão já estava fechada"],
  [/^Session already open/i, "sessão já estava aberta"],
  [/^Opening session/i, "sessão aberta"],
  [/^Removing old closed session/i, "sessão antiga removida"],
  [/^Migrating session/i, "sessão migrada"],
  [/^V1 session storage migration error/i, "erro ao migrar sessão"],
  [/^Failed to decrypt message with any known session/i, "falha ao decifrar com as sessões conhecidas"],
  [/^Decrypted message with closed session/i, "mensagem decifrada com sessão fechada"],
  [/^Session error:/i, "erro de sessão"]
];
const GENERIC_LABEL = "dados de criptografia omitidos";

export const CONSOLE_METHODS = Object.freeze(["log", "info", "warn", "error", "debug"]);

function isBinary(value) {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

// Algum argumento carrega (ou parece carregar) material de chave? Percurso limitado (profundidade, itens por nível e total
// de nós visitados), seguro contra ciclos; objeto grande demais para conferir inteiro fica pelo que deu para conferir.
// Objeto que não dá para inspecionar (getter que lança, Proxy) conta como sensível: na dúvida, não imprime.
export function isSensitiveValue(value, depth = 0, seen = new WeakSet(), budget = { nodes: MAX_NODES }) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return SENSITIVE_TEXT.test(value);
  if (typeof value !== "object" && typeof value !== "function") return false;
  if (isBinary(value)) return false;
  try {
    if (value.constructor?.name === "SessionEntry") return true;
    if (seen.has(value) || budget.nodes-- <= 0) return false;
    seen.add(value);
    if (value instanceof Error && SENSITIVE_TEXT.test(`${value.message || ""}\n${value.stack || ""}`)) return true;
    if (depth >= MAX_DEPTH) return false;
    const keys = (Array.isArray(value) ? [...value.keys()] : Object.keys(value)).slice(0, MAX_ITEMS);
    if (keys.some((key) => SENSITIVE_KEYS.has(String(key)))) return true;
    return keys.some((key) => isSensitiveValue(value[key], depth + 1, seen, budget));
  } catch {
    return true;
  }
}

function libsignalLabel(args) {
  const first = typeof args[0] === "string" ? args[0].trimStart() : "";
  if (!first) return "";
  for (const [pattern, label] of LIBSIGNAL_MESSAGES) {
    if (!pattern.test(first)) continue;
    // O erro de sessão mais comum tem nome próprio no log antigo; só ele é repetido (texto fixo, nunca o do original).
    return label === "erro de sessão" && /Bad MAC/i.test(first) ? "erro de sessão: Bad MAC" : label;
  }
  return "";
}

export function createConsoleSanitizer() {
  const counts = new Map();
  return {
    // -> null (a chamada passa como está) | string (a ÚNICA linha que substitui a chamada inteira)
    sanitize(args) {
      const label = libsignalLabel(args) || (args.some((arg) => isSensitiveValue(arg)) ? GENERIC_LABEL : "");
      if (!label) return null;
      const n = (counts.get(label) || 0) + 1;
      counts.set(label, n);
      return `[libsignal] ${label} (${n})`;
    },
    counts
  };
}

const INSTALLED = Symbol.for("mm.whatsappIndividual.consoleSanitizer");

// Troca log/info/warn/error/debug do console por versões filtradas (a linha substituta sai pelo MESMO método, preservando
// stdout/stderr). Idempotente. Falha ao filtrar nunca imprime o original: sai a linha genérica. -> função que desfaz.
export function installConsoleSanitizer(target = console, sanitizer = createConsoleSanitizer()) {
  if (target[INSTALLED]) return target[INSTALLED].restore;
  const originals = {};
  for (const method of CONSOLE_METHODS) {
    const original = target[method];
    if (typeof original !== "function") continue;
    originals[method] = original;
    target[method] = (...args) => {
      let replacement = null;
      try {
        replacement = sanitizer.sanitize(args);
      } catch {
        replacement = `[libsignal] ${GENERIC_LABEL}`;
      }
      return replacement === null ? original.apply(target, args) : original.call(target, replacement);
    };
  }
  const restore = () => {
    for (const [method, original] of Object.entries(originals)) target[method] = original;
    delete target[INSTALLED];
  };
  Object.defineProperty(target, INSTALLED, { value: { restore }, configurable: true, enumerable: false });
  return restore;
}
