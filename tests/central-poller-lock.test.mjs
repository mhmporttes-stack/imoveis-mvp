// Trava de instancia unica + poller-ctl. Nenhum teste chama o Claude, a API ou o banco; nenhum inicia o poller real.
// Processos reais usados: so `node` dormindo, criados e encerrados pelo proprio teste.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, inspectLock, isPidAlive, releaseLock, stopRequestPath, touchLock, STALE_MS, EXIT_CODE_ALREADY_RUNNING } from "../scripts/central-bridge/poller-lock.mjs";
import { checkPoller, statusPoller, stopPoller } from "../scripts/central-bridge/poller-ctl.mjs";
import { main as pollerMain } from "../scripts/central-bridge/poller.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "central-lock-"));
const alive = (...pids) => ({ isAlive: (pid) => pids.includes(pid) });
const age = (path, ms) => {
  const t = new Date(Date.now() - ms);
  utimesSync(path, t, t);
};
const noSleep = () => Promise.resolve();

test("inicio ok: cria a trava de forma atomica com pid, inicio, script e host", () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const r = acquireLock(lock, { pid: 111, ...alive(111) });
  assert.equal(r.ok, true);
  const rec = JSON.parse(readFileSync(lock, "utf8"));
  assert.equal(rec.pid, 111);
  assert.equal(rec.token, r.token);
  assert.ok(!Number.isNaN(Date.parse(rec.startedAt)));
  assert.ok(Number.isFinite(rec.processStartTime) && Number.isFinite(rec.bootTime));
  assert.equal(typeof rec.host, "string");
  assert.equal(inspectLock(lock, alive(111)).state, "running");
  rmSync(dir, { recursive: true });
});

test("segundo inicio e recusado enquanto o primeiro vive; a trava do primeiro nao muda", () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const a = acquireLock(lock, { pid: 111, ...alive(111, 222) });
  const b = acquireLock(lock, { pid: 222, ...alive(111, 222) });
  assert.equal(b.ok, false);
  assert.equal(b.running.pid, 111);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, a.token);
  rmSync(dir, { recursive: true });
});

test("trava obsoleta com PID morto e assumida (ex.: apos reinicio ou kill forcado)", () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  acquireLock(lock, { pid: 111, ...alive(111) });
  const s = inspectLock(lock, alive()); // 111 morreu
  assert.equal(s.state, "stale");
  assert.match(s.reason, /nao existe/);
  const b = acquireLock(lock, { pid: 222, ...alive(222) });
  assert.equal(b.ok, true);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).pid, 222);
  rmSync(dir, { recursive: true });
});

test("PID reaproveitado: vivo, mas hora de inicio diferente OU sem batimento OU PC reiniciado = obsoleta", () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  acquireLock(lock, { pid: 111, ...alive(111) });
  // (a) hora de inicio do PID difere da registrada
  const a = inspectLock(lock, { ...alive(111), getStartTime: () => Date.now() + 3600_000 });
  assert.equal(a.state, "stale");
  assert.match(a.reason, /hora de inicio/);
  // hora de inicio igual: segue valendo
  const same = JSON.parse(readFileSync(lock, "utf8")).processStartTime;
  assert.equal(inspectLock(lock, { ...alive(111), getStartTime: () => same + 1000 }).state, "running");
  // (b) PID existe mas ninguem renova a trava
  age(lock, STALE_MS + 5000);
  const b = inspectLock(lock, alive(111));
  assert.equal(b.state, "stale");
  assert.match(b.reason, /sem batimento/);
  assert.equal(acquireLock(lock, { pid: 333, ...alive(111, 333) }).ok, true);
  // (c) o PC reiniciou (hora de boot muito diferente), mesmo com PID vivo e batimento recente
  const lock2 = join(dir, "q.lock");
  acquireLock(lock2, { pid: 111, ...alive(111), osUptimeSec: () => 100000 });
  const c = inspectLock(lock2, { ...alive(111), osUptimeSec: () => 50 });
  assert.equal(c.state, "stale");
  assert.match(c.reason, /reiniciou/);
  rmSync(dir, { recursive: true });
});

test("trava ilegivel: recente = em criacao (recusa); antiga = obsoleta (assume)", () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  writeFileSync(lock, "{parcial");
  assert.equal(acquireLock(lock, { pid: 5, ...alive(5) }).ok, false);
  age(lock, 60000);
  assert.equal(acquireLock(lock, { pid: 5, ...alive(5) }).ok, true);
  rmSync(dir, { recursive: true });
});

test("saida limpa remove so a trava propria (token); trava de outro nunca e removida", () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const a = acquireLock(lock, { pid: 111, ...alive(111) });
  assert.equal(releaseLock(lock, "token-de-outro"), false);
  assert.ok(existsSync(lock));
  assert.equal(releaseLock(lock, a.token), true);
  assert.ok(!existsSync(lock));
  assert.equal(releaseLock(lock, a.token), false); // ja nao existe
  rmSync(dir, { recursive: true });
});

test("batimento: ok renova mtime; missing/foreign detectados", () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const a = acquireLock(lock, { pid: 111, ...alive(111) });
  age(lock, 60000);
  assert.equal(touchLock(lock, a.token), "ok");
  assert.ok(inspectLock(lock, alive(111)).ageMs < 5000);
  assert.equal(touchLock(lock, "outro"), "foreign");
  releaseLock(lock, a.token);
  assert.equal(touchLock(lock, a.token), "missing");
  rmSync(dir, { recursive: true });
});

test("status e check: parado, rodando, obsoleta", () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  assert.equal(checkPoller({ lockPath: lock }).code, 0);
  assert.match(statusPoller({ lockPath: lock }).line, /^PARADO \(sem trava\)/);
  acquireLock(lock, { pid: 111, ...alive(111) });
  const run = statusPoller({ lockPath: lock, deps: alive(111) });
  assert.equal(run.running, true);
  assert.match(run.line, /RODANDO: PID 111, inicio \d{4}-/);
  assert.equal(checkPoller({ lockPath: lock, deps: alive(111) }).code, 1);
  const stale = checkPoller({ lockPath: lock, deps: alive() });
  assert.equal(stale.code, 0); // trava obsoleta = 0 instancias
  assert.match(stale.line, /obsoleta/);
  rmSync(dir, { recursive: true });
});

test("stop (mock): encerra exatamente o PID da trava, remove a trava e confirma 0", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const table = new Set([111, 222]); // 111 = poller; 222 = outro processo qualquer
  acquireLock(lock, { pid: 111, isAlive: (p) => table.has(p) });
  const killed = [];
  const r = await stopPoller({
    lockPath: lock,
    graceMs: 30,
    killWaitMs: 100,
    pollMs: 5,
    isAlive: (p) => table.has(p),
    kill: (pid, sig) => {
      killed.push([pid, sig]);
      table.delete(pid);
    }
  });
  assert.deepEqual(killed, [[111, "SIGTERM"]]);
  assert.ok(table.has(222), "outro PID nao pode ser atingido");
  assert.equal(r.confirmed, true);
  assert.equal(r.code, 0);
  assert.ok(!existsSync(lock) && !existsSync(stopRequestPath(lock)));
  assert.equal(checkPoller({ lockPath: lock, deps: { isAlive: (p) => table.has(p) } }).code, 0);
  rmSync(dir, { recursive: true });
});

test("stop (mock): se o poller encerra sozinho ao ver o pedido gracioso, nao ha kill", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const table = new Set([111]);
  const a = acquireLock(lock, { pid: 111, isAlive: (p) => table.has(p) });
  let kills = 0;
  const r = await stopPoller({
    lockPath: lock,
    graceMs: 2000,
    pollMs: 5,
    isAlive: (p) => table.has(p),
    // o "poller" reage ao arquivo de parada: remove a trava e sai
    sleep: async () => {
      if (existsSync(stopRequestPath(lock))) {
        releaseLock(lock, a.token);
        table.delete(111);
      }
    },
    kill: () => {
      kills++;
    }
  });
  assert.equal(kills, 0);
  assert.equal(r.killed, false);
  assert.equal(r.confirmed, true);
  rmSync(dir, { recursive: true });
});

test("stop (mock): trava obsoleta (PID vivo mas sem batimento) so limpa a trava e NAO mata ninguem", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  acquireLock(lock, { pid: 111, ...alive(111) });
  age(lock, STALE_MS + 10000);
  let kills = 0;
  const r = await stopPoller({ lockPath: lock, isAlive: (p) => p === 111, kill: () => kills++ });
  assert.equal(kills, 0);
  assert.equal(r.confirmed, true);
  assert.ok(!existsSync(lock));
  rmSync(dir, { recursive: true });
});

test("stop (mock): sem trava = ja parado, confirma 0", async () => {
  const dir = tmp();
  const r = await stopPoller({ lockPath: join(dir, "p.lock"), kill: () => assert.fail("nao deve matar") });
  assert.equal(r.confirmed, true);
  rmSync(dir, { recursive: true });
});

test("stop (mock): processo que nao morre segue como instancia (code 1, sem fingir sucesso)", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  acquireLock(lock, { pid: 111, ...alive(111) });
  const r = await stopPoller({ lockPath: lock, graceMs: 20, killWaitMs: 30, pollMs: 5, isAlive: () => true, kill: () => {} });
  assert.equal(r.confirmed, false);
  assert.equal(r.code, 1);
  rmSync(dir, { recursive: true });
});

// ---------------- processos reais: um `node` dormindo ----------------
const sleeper = () => spawn(process.execPath, ["-e", "setTimeout(()=>{},120000)"], { stdio: "ignore" });
const waitExit = (child) => new Promise((resolve) => (child.exitCode !== null || child.signalCode ? resolve() : child.once("exit", resolve)));

test("real: stop encerra so o node dormindo da trava; o outro node dormindo continua vivo; confirma 0", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const target = sleeper();
  const decoy = sleeper();
  try {
    assert.ok(isPidAlive(target.pid) && isPidAlive(decoy.pid));
    assert.equal(acquireLock(lock, { pid: target.pid }).ok, true);
    assert.equal(acquireLock(lock, { pid: 999999 }).ok, false); // alvo real vivo: segundo inicio recusado
    const r = await stopPoller({ lockPath: lock, graceMs: 300, killWaitMs: 5000, pollMs: 50 });
    await waitExit(target);
    assert.equal(r.killed, true);
    assert.equal(r.confirmed, true);
    assert.equal(isPidAlive(target.pid), false);
    assert.equal(isPidAlive(decoy.pid), true, "o outro processo nao pode ser encerrado");
    assert.ok(!existsSync(lock));
    assert.equal(checkPoller({ lockPath: lock }).code, 0);
  } finally {
    target.kill();
    decoy.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real: PID de outro programa na trava sem batimento (PID reaproveitado) nao e encerrado", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const other = sleeper();
  try {
    acquireLock(lock, { pid: other.pid });
    age(lock, STALE_MS + 10000);
    const r = await stopPoller({ lockPath: lock, graceMs: 100, pollMs: 20 });
    assert.equal(r.killed, false);
    assert.equal(r.confirmed, true);
    assert.equal(isPidAlive(other.pid), true);
  } finally {
    other.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------- fiacao no poller (main com cliente/config falsos: sem rede) ----------------
const fakeConfig = () => ({ executorSecret: "segredo-de-teste", baseUrl: "http://127.0.0.1:9", workerId: "w", pollSeconds: 5 });
const fakeClient = (onRequeue = () => {}) => ({ requeue: async () => (onRequeue(), 0), claim: async () => null, renew: async () => {}, complete: async () => true });
const exitThrow = (code) => {
  throw new Error(`exit:${code}`);
};
const base = (lock, extra = {}) => ({
  loadConfigFn: fakeConfig,
  createClient: () => fakeClient(),
  selectExec: () => ({ name: "fake" }),
  lockPath: lock,
  heartbeatMs: 50,
  argv: [],
  exit: exitThrow,
  installHandlers: false,
  ...extra
});

test("poller main: cria a trava ao iniciar e remove na saida (--once)", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  let during = false;
  await pollerMain(base(lock, { argv: ["--once"], createClient: () => fakeClient(() => (during = existsSync(lock))) }));
  assert.equal(during, true);
  assert.ok(!existsSync(lock));
  rmSync(dir, { recursive: true });
});

test("poller main: com instancia viva, recusa (exit 3) antes de criar cliente/executor e nao mexe na trava", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const other = acquireLock(lock, { pid: 4242, ...alive(4242) });
  let created = 0;
  await assert.rejects(
    pollerMain(base(lock, { lockDeps: alive(4242), createClient: () => (created++, fakeClient()) })),
    new RegExp(`exit:${EXIT_CODE_ALREADY_RUNNING}`)
  );
  assert.equal(created, 0);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, other.token);
  rmSync(dir, { recursive: true });
});

test("poller main: trava obsoleta (PID morto) e assumida e liberada na saida", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  acquireLock(lock, { pid: 4242, ...alive(4242) });
  await pollerMain(base(lock, { argv: ["--once"], lockDeps: alive() }));
  assert.ok(!existsSync(lock));
  rmSync(dir, { recursive: true });
});

test("poller main: pedido de parada gracioso (arquivo .stop) encerra o laco e libera a trava", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const run = pollerMain(base(lock));
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(existsSync(lock));
  writeFileSync(stopRequestPath(lock), "{}");
  await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error("nao parou")), 3000))]);
  assert.ok(!existsSync(lock) && !existsSync(stopRequestPath(lock)));
  rmSync(dir, { recursive: true });
});

test("poller main: trava assumida por outra instancia => encerra e NAO remove a trava alheia", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  const run = pollerMain(base(lock));
  await new Promise((r) => setTimeout(r, 120));
  const rec = JSON.parse(readFileSync(lock, "utf8"));
  writeFileSync(lock, JSON.stringify({ ...rec, token: "token-alheio", pid: 31337 }));
  await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error("nao parou")), 3000))]);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, "token-alheio");
  rmSync(dir, { recursive: true });
});

test("poller main: falha ao selecionar o executor libera a trava", async () => {
  const dir = tmp();
  const lock = join(dir, "p.lock");
  await assert.rejects(
    pollerMain(base(lock, { selectExec: () => { throw new Error("falha-teste"); } })),
    /falha-teste/
  );
  assert.ok(!existsSync(lock));
  rmSync(dir, { recursive: true });
});

test("estatico: poller-lock e poller-ctl sem processo auxiliar, shell, rede nem segredo", () => {
  for (const f of ["scripts/central-bridge/poller-lock.mjs", "scripts/central-bridge/poller-ctl.mjs"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/child_process|\bspawn\b|\bexec(Sync|File)?\s*\(|taskkill|powershell|fetch\(|node:http|node:net|CENTRAL_[A-Z_]*SECRET|ANTHROPIC/i.test(src), `proibido em ${f}`);
  }
});
