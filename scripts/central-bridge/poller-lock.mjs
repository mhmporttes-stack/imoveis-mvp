// Trava de instancia unica do poller da Central (por usuario, FORA do repositorio).
// Arquivo: %USERPROFILE%\.central-bridge.poller.lock (JSON), criado de forma atomica (flag "wx").
// Sem busca textual em linha de comando, sem processo auxiliar, sem porta: so fs, PID e relogio.
//
// Como se prova que a trava pertence a um poller VIVO (e nao a um PID reaproveitado):
//  1) o PID existe; 2) o PC nao reiniciou desde que a trava foi criada (bootTime);
//  3) o poller RENOVA a trava a cada HEARTBEAT_MS (mtime do arquivo): se o PID existe mas ninguem renova,
//     e outro programa que herdou o numero; 4) se houver como obter a hora de inicio do PID, ela tem de bater.
// Encerramento forcado no Windows nao roda handlers: por isso a trava obsoleta e detectada e assumida.
import { closeSync, openSync, readFileSync, statSync, unlinkSync, utimesSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, hostname, uptime as osUptime } from "node:os";
import { join } from "node:path";

export const HEARTBEAT_MS = 10000; // o poller renova a trava a cada 10 s
export const STALE_MS = 120000; // sem renovacao por 2 min = sem poller (cobre suspensao do PC)
export const BOOT_TOLERANCE_MS = 120000;
export const START_TOLERANCE_MS = 5000;
export const CREATING_GRACE_MS = 5000; // arquivo vazio/parcial mais novo que isso = alguem esta criando agora
export const EXIT_CODE_ALREADY_RUNNING = 3;

export function defaultLockPath(env = process.env) {
  return env.CENTRAL_BRIDGE_LOCK || join(homedir(), ".central-bridge.poller.lock");
}

// Pedido de parada graciosa (o poller confere a cada batimento). No Windows o sinal SIGTERM nao permite encerrar limpo.
export const stopRequestPath = (lockPath) => `${lockPath}.stop`;

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM"; // existe, mas sem permissao de sinalizar
  }
}

function defaults(deps = {}) {
  return {
    now: Date.now,
    pid: process.pid,
    isAlive: isPidAlive,
    getStartTime: null, // (pid) => epoch ms | null. Opcional: sem API nativa para PID alheio no Windows.
    uptimeSec: () => process.uptime(),
    osUptimeSec: () => osUptime(),
    host: hostname(),
    script: process.argv[1] || "",
    ...deps
  };
}

// Le a trava. null = nao existe. corrupt = existe mas nao e JSON valido (criacao em andamento ou truncada).
export function readLock(lockPath) {
  let stat;
  try {
    stat = statSync(lockPath);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
  let record = null;
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8"));
    if (parsed && Number.isInteger(parsed.pid) && typeof parsed.token === "string") record = parsed;
  } catch {
    record = null;
  }
  return { record, corrupt: record === null, mtimeMs: stat.mtimeMs };
}

// -> { state: "absent" | "running" | "stale", reason, record, ageMs, token }
export function inspectLock(lockPath, depsIn = {}) {
  const d = defaults(depsIn);
  const lock = readLock(lockPath);
  if (!lock) return { state: "absent", reason: "sem trava", record: null, ageMs: null };
  const ageMs = Math.max(0, d.now() - lock.mtimeMs);
  if (lock.corrupt) {
    return ageMs < CREATING_GRACE_MS
      ? { state: "running", reason: "trava em criacao", record: null, ageMs }
      : { state: "stale", reason: "trava ilegivel", record: null, ageMs };
  }
  const r = lock.record;
  const base = { record: r, ageMs };
  if (!d.isAlive(r.pid)) return { ...base, state: "stale", reason: `PID ${r.pid} nao existe` };
  if (Number.isFinite(r.bootTime) && Math.abs(d.now() - d.osUptimeSec() * 1000 - r.bootTime) > BOOT_TOLERANCE_MS) {
    return { ...base, state: "stale", reason: "o PC reiniciou depois da trava (PID reaproveitado)" };
  }
  if (d.getStartTime && Number.isFinite(r.processStartTime)) {
    const start = d.getStartTime(r.pid);
    if (Number.isFinite(start) && Math.abs(start - r.processStartTime) > START_TOLERANCE_MS) {
      return { ...base, state: "stale", reason: `PID ${r.pid} reaproveitado (hora de inicio diferente)` };
    }
  }
  if (ageMs > STALE_MS) {
    return { ...base, state: "stale", reason: `PID ${r.pid} existe, mas sem batimento ha ${Math.round(ageMs / 1000)}s (nao e o poller)` };
  }
  return { ...base, state: "running", reason: "poller ativo" };
}

function removeIfToken(lockPath, token) {
  const lock = readLock(lockPath);
  if (!lock) return false;
  if (token !== undefined && lock.record?.token !== token) return false;
  try {
    unlinkSync(lockPath);
    return true;
  } catch (e) {
    if (e?.code === "ENOENT") return false;
    throw e;
  }
}

// Assume a trava: { ok: true, token, record } ou { ok: false, running, reason, ageMs } (quem ja esta rodando).
export function acquireLock(lockPath, depsIn = {}) {
  const d = defaults(depsIn);
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = randomBytes(12).toString("hex");
    const nowMs = d.now();
    const record = {
      schema: 1,
      pid: d.pid,
      token,
      startedAt: new Date(nowMs).toISOString(),
      processStartTime: Math.round(nowMs - d.uptimeSec() * 1000),
      bootTime: Math.round(nowMs - d.osUptimeSec() * 1000),
      script: d.script,
      host: d.host
    };
    let fd;
    try {
      fd = openSync(lockPath, "wx"); // atomico: falha se ja existir
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      const seen = inspectLock(lockPath, d);
      if (seen.state === "running") return { ok: false, running: seen.record, reason: seen.reason, ageMs: seen.ageMs };
      if (seen.state === "absent") continue; // sumiu entre as chamadas: tenta de novo
      removeIfToken(lockPath, seen.record?.token); // obsoleta: remove e tenta assumir (se outro assumiu antes, o "wx" acima recusa)
      continue;
    }
    try {
      writeSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
    return { ok: true, token, record };
  }
  return { ok: false, running: null, reason: "disputa pela trava", ageMs: null };
}

// Batimento: renova o mtime. "ok" | "missing" | "foreign" (trava trocada por outro poller).
export function touchLock(lockPath, token, depsIn = {}) {
  const d = defaults(depsIn);
  const lock = readLock(lockPath);
  if (!lock) return "missing";
  if (lock.record?.token !== token) return "foreign";
  const t = new Date(d.now());
  utimesSync(lockPath, t, t);
  return "ok";
}

// Remove so se a trava ainda for deste processo (token). true se removeu.
export function releaseLock(lockPath, token) {
  return removeIfToken(lockPath, token);
}

export function describeRunning(running) {
  if (!running) return "outra instancia esta assumindo a trava";
  return `poller ja em execucao (PID ${running.pid}, desde ${running.startedAt})`;
}

// Limite o intervalo de batimento (so testes alteram) para nao zerar nem estourar STALE_MS.
export function resolveHeartbeatMs(env = process.env) {
  const n = Number(env.CENTRAL_BRIDGE_HEARTBEAT_MS);
  return Number.isFinite(n) && n >= 100 && n <= 30000 ? n : HEARTBEAT_MS;
}
