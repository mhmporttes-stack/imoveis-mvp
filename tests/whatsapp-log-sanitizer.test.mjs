import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Console } from "node:console";
import { Writable } from "node:stream";
import { inspect } from "node:util";
import { createConsoleSanitizer, installConsoleSanitizer, isSensitiveValue } from "../whatsapp-individual-service/src/log-sanitizer.js";

// REGRA OFICIAL (dono, 2026-10-13): nenhum material de criptografia nos registros da Railway. O libsignal (dentro do Baileys)
// despeja objetos 'SessionEntry' (privKey, rootKey, chainKey, baseKey, ephemeralKeyPair...) com console.info/warn/error.
// As amostras abaixo reproduzem esses despejos (formato do libsignal-node: session_record.js / session_cipher.js /
// session_builder.js). Chaves FALSAS (bytes fixos); nada de rede, de Baileys ou de sessão real.

const FORBIDDEN_OUTPUT = /privKey|rootKey|chainKey|baseKey|ephemeralKeyPair|remoteIdentityKey|lastRemoteEphemeralKey|messageKeys|SessionEntry|<Buffer/;

// Mesma forma do SessionEntry do libsignal-node (classe com _chains, registrationId, currentRatchet, indexInfo, pendingPreKey).
class SessionEntry {
  constructor() { this._chains = {}; }
}
function sessionEntry({ closed = -1 } = {}) {
  const entry = new SessionEntry();
  entry.registrationId = 1234567;
  entry.currentRatchet = {
    ephemeralKeyPair: { pubKey: Buffer.alloc(33, 5), privKey: Buffer.alloc(32, 7) },
    lastRemoteEphemeralKey: Buffer.alloc(33, 6),
    previousCounter: 0,
    rootKey: Buffer.alloc(32, 9)
  };
  entry.indexInfo = { baseKey: Buffer.alloc(33, 3), baseKeyType: 2, closed, used: 1760000000000, created: 1760000000000, remoteIdentityKey: Buffer.alloc(33, 4) };
  entry._chains[Buffer.alloc(33, 5).toString("base64")] = { chainKey: { counter: 3, key: Buffer.alloc(32, 8) }, chainType: 1, messageKeys: { 1: Buffer.alloc(32, 2) } };
  entry.pendingPreKey = { signedKeyId: 1, baseKey: Buffer.alloc(33, 3), preKeyId: 22 };
  return entry;
}

// Console de verdade (formatação real do Node) escrevendo em memória.
function capture() {
  const out = { stdout: "", stderr: "" };
  const sink = (name) => new Writable({ write(chunk, _enc, done) { out[name] += chunk.toString(); done(); } });
  const real = new Console({ stdout: sink("stdout"), stderr: sink("stderr"), colorMode: false });
  const restore = installConsoleSanitizer(real);
  return { console: real, out, restore };
}

test("controle: sem o filtro o despejo do SessionEntry vaza as chaves (a amostra é realista)", () => {
  const sink = { stdout: "" };
  const raw = new Console({ stdout: new Writable({ write(chunk, _e, done) { sink.stdout += chunk.toString(); done(); } }), colorMode: false });
  raw.info("Closing session:", sessionEntry());
  assert.match(sink.stdout, /SessionEntry/);
  assert.match(sink.stdout, /privKey/);
  assert.match(sink.stdout, /rootKey/);
  assert.match(sink.stdout, /chainKey/);
  assert.match(sink.stdout, /baseKey/);
  assert.match(sink.stdout, /ephemeralKeyPair/);
});

test("as mensagens reais do libsignal saem como UMA linha curta, sem nenhum argumento do original", () => {
  const cap = capture();
  const badMac = new Error("Bad MAC");
  const session = sessionEntry();
  cap.console.info("Closing session:", session);
  cap.console.info("Opening session:", sessionEntry({ closed: Date.now() }));
  cap.console.info("Removing old closed session:", sessionEntry({ closed: 1 }));
  cap.console.warn("Session already closed", session);
  cap.console.warn("Session already open");
  cap.console.info("Migrating session to:", 4);
  cap.console.warn("Closing open session in favor of incoming prekey bundle");
  cap.console.error("Failed to decrypt message with any known session...");
  cap.console.error("Session error:" + badMac, badMac.stack);
  cap.console.warn("Decrypted message with closed session.");
  cap.console.error("V1 session storage migration error: registrationId", undefined, "for open session version", 1);

  assert.equal(cap.out.stdout, [
    "[libsignal] sessão fechada (1)",
    "[libsignal] sessão aberta (1)",
    "[libsignal] sessão antiga removida (1)",
    "[libsignal] sessão migrada (1)",
    ""
  ].join("\n"));
  assert.equal(cap.out.stderr, [
    "[libsignal] sessão já estava fechada (1)",
    "[libsignal] sessão já estava aberta (1)",
    "[libsignal] sessão aberta substituída por novo prekey bundle (1)",
    "[libsignal] falha ao decifrar com as sessões conhecidas (1)",
    "[libsignal] erro de sessão: Bad MAC (1)",
    "[libsignal] mensagem decifrada com sessão fechada (1)",
    "[libsignal] erro ao migrar sessão (1)",
    ""
  ].join("\n"));
  assert.doesNotMatch(cap.out.stdout + cap.out.stderr, FORBIDDEN_OUTPUT);
  assert.doesNotMatch(cap.out.stdout + cap.out.stderr, /\n\s+at /, "nenhum stack trace");
  cap.restore();
});

test("o contador por tipo cresce a cada ocorrência (uma linha por chamada)", () => {
  const cap = capture();
  for (let i = 0; i < 3; i += 1) cap.console.info("Closing session:", sessionEntry());
  cap.console.info("Opening session:", sessionEntry());
  assert.equal(cap.out.stdout, "[libsignal] sessão fechada (1)\n[libsignal] sessão fechada (2)\n[libsignal] sessão fechada (3)\n[libsignal] sessão aberta (1)\n");
});

test("qualquer argumento com chaves de criptografia é suprimido, em log/info/warn/error/debug, mesmo com mensagem desconhecida", () => {
  const cap = capture();
  const secretish = { ephemeralKeyPair: { privKey: Buffer.alloc(32, 1) } };
  cap.console.log("algo novo do libsignal:", sessionEntry());
  cap.console.info("sem classe:", secretish);
  cap.console.warn("aninhado:", { a: [{ b: { chainKey: { key: Buffer.alloc(32, 1) } } }] });
  cap.console.error("texto com dump:", "currentRatchet: { rootKey: <Buffer 01 02> }");
  cap.console.debug(secretish);
  const all = cap.out.stdout + cap.out.stderr;
  assert.doesNotMatch(all, FORBIDDEN_OUTPUT);
  assert.doesNotMatch(all, /algo novo|sem classe|aninhado|texto com dump/, "nenhum argumento do original sobrevive");
  assert.equal(all.trim().split("\n").length, 5, "no máximo uma linha por chamada");
  assert.match(all, /^\[libsignal\] dados de criptografia omitidos \(1\)$/m);
  cap.restore();
});

test("instância de SessionEntry é sensível mesmo vazia, e objeto circular/inspecionável só por exceção não derruba nem vaza", () => {
  assert.equal(isSensitiveValue(new SessionEntry()), true);
  const circular = { name: "ciclo" };
  circular.self = circular;
  assert.equal(isSensitiveValue(circular), false);
  const hostile = { get boom() { throw new Error("getter hostil"); } };
  assert.equal(isSensitiveValue(hostile), true, "na dúvida, não imprime");
  const cap = capture();
  cap.console.log("hostil:", hostile);
  cap.console.log("ciclo:", circular);
  assert.match(cap.out.stdout, /^\[libsignal\] dados de criptografia omitidos \(1\)$/m);
  assert.match(cap.out.stdout, /ciclo: <ref \*1> \{ name: .ciclo./);
  assert.doesNotMatch(cap.out.stdout, /hostil/);
});

test("log comum do serviço passa intacto (texto, objetos sem chave, erros, formatação %s/%d)", () => {
  const cap = capture();
  const plain = new Console({ stdout: new Writable({ write(chunk, _e, done) { cap.out.reference = (cap.out.reference || "") + chunk.toString(); done(); } }), colorMode: false });
  const cases = [
    ["[abc] Sessão retomada após subir o processo."],
    ["whatsapp-individual-service ouvindo na porta %d", 3100],
    ["[abc] Falha ao conectar:", "Connection Closed"],
    ["Status", { status: "connected", attempts: 2, nested: { ok: true } }],
    ["Lista", [1, 2, { a: "b" }]],
    ["Buffer de mídia", Buffer.alloc(4, 1)],
    ["Erro comum", new Error("falha qualquer")]
  ];
  for (const args of cases) {
    plain.log(...args);
    cap.console.log(...args);
  }
  assert.equal(cap.out.stdout, cap.out.reference);
});

test("o filtro troca o método certo (stdout x stderr), é idempotente e desfaz", () => {
  const calls = [];
  const fake = {
    log: (...a) => calls.push(["log", a]), info: (...a) => calls.push(["info", a]), warn: (...a) => calls.push(["warn", a]),
    error: (...a) => calls.push(["error", a]), debug: (...a) => calls.push(["debug", a])
  };
  const originalInfo = fake.info;
  const restore = installConsoleSanitizer(fake);
  assert.equal(installConsoleSanitizer(fake), restore, "segunda instalação não empilha outro filtro");
  fake.info("Closing session:", sessionEntry());
  fake.warn("Session already closed", sessionEntry());
  fake.error("Session error:Error: Bad MAC", "stack");
  fake.log("normal", 1);
  assert.deepEqual(calls, [
    ["info", ["[libsignal] sessão fechada (1)"]],
    ["warn", ["[libsignal] sessão já estava fechada (1)"]],
    ["error", ["[libsignal] erro de sessão: Bad MAC (1)"]],
    ["log", ["normal", 1]]
  ]);
  for (const [, args] of calls) assert.equal(args.filter((arg) => typeof arg === "object").length, 0);
  restore();
  assert.equal(fake.info, originalInfo);
  fake.info("Closing session:", "x");
  assert.deepEqual(calls.at(-1), ["info", ["Closing session:", "x"]]);
});

test("falha dentro do filtro nunca imprime o original: sai a linha genérica", () => {
  const calls = [];
  const fake = { log: (...a) => calls.push(a), info() {}, warn() {}, error() {}, debug() {} };
  installConsoleSanitizer(fake, { sanitize() { throw new Error("quebrou"); } });
  fake.log("Closing session:", sessionEntry());
  assert.deepEqual(calls, [["[libsignal] dados de criptografia omitidos"]]);
});

test("o resultado nunca contém texto do original, mesmo com mensagem do libsignal seguida de dados", () => {
  const sanitizer = createConsoleSanitizer();
  const line = sanitizer.sanitize(["Closing session:", sessionEntry(), "segredo-que-nao-pode-sair"]);
  assert.equal(line, "[libsignal] sessão fechada (1)");
  assert.equal(sanitizer.sanitize(["mensagem comum", { a: 1 }]), null);
  assert.equal(sanitizer.sanitize([]), null);
  assert.equal(sanitizer.sanitize([undefined, null, 42]), null);
  assert.ok(!inspect(line).includes("Buffer"));
});

test("travas: console-guard é o PRIMEIRO import de server.js e o filtro não depende de rede nem do Baileys", () => {
  const server = readFileSync(new URL("../whatsapp-individual-service/src/server.js", import.meta.url), "utf8");
  const imports = server.split("\n").filter((line) => /^import /.test(line));
  assert.equal(imports[0], 'import "./console-guard.js";');
  const guard = readFileSync(new URL("../whatsapp-individual-service/src/console-guard.js", import.meta.url), "utf8");
  assert.match(guard, /installConsoleSanitizer\(\);/);
  const sanitizer = readFileSync(new URL("../whatsapp-individual-service/src/log-sanitizer.js", import.meta.url), "utf8");
  assert.ok(!/baileys|fetch\(|require\(|from "(?!node:)/i.test(sanitizer.replace(/\/\/.*$/gm, "")), "módulo puro");
});
