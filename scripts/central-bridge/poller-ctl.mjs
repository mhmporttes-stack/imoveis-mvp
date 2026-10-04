// Controle do poller da Central: status | stop | check. Deterministico: usa so a trava (PID registrado), sem busca textual.
//   node scripts\central-bridge\poller-ctl.mjs status   -> rodando/parado, PID, inicio
//   node scripts\central-bridge\poller-ctl.mjs stop     -> para exatamente o PID da trava e CONFIRMA 0 instancias
//   node scripts\central-bridge\poller-ctl.mjs check    -> codigo 0 se 0 instancias; 1 se ha poller rodando
// Nao inicia nada, nao le segredo, nao usa processo auxiliar (process.kill nativo).
import { pathToFileURL } from "node:url";
import { unlinkSync, writeFileSync } from "node:fs";
import { defaultLockPath, inspectLock, isPidAlive, readLock, stopRequestPath } from "./poller-lock.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function rm(path) {
  try {
    unlinkSync(path);
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
}

export function statusPoller({ lockPath = defaultLockPath(), deps = {} } = {}) {
  const s = inspectLock(lockPath, deps);
  const r = s.record;
  if (s.state === "running") {
    const line = r
      ? `RODANDO: PID ${r.pid}, inicio ${r.startedAt}, ultimo batimento ha ${Math.round(s.ageMs / 1000)}s`
      : "RODANDO: trava em criacao";
    return { instances: 1, running: true, line };
  }
  if (s.state === "stale") return { instances: 0, running: false, line: `PARADO (trava obsoleta: ${s.reason})` };
  return { instances: 0, running: false, line: "PARADO (sem trava)" };
}

// 0 = nenhuma instancia (trava ausente ou obsoleta); 1 = ha poller rodando.
export function checkPoller(opts = {}) {
  const s = statusPoller(opts);
  return { code: s.running ? 1 : 0, line: s.line };
}

export async function stopPoller({
  lockPath = defaultLockPath(),
  deps = {},
  graceMs = 20000,
  killWaitMs = 5000,
  pollMs = 250,
  sleep = wait,
  kill = (pid, sig) => process.kill(pid, sig),
  isAlive = isPidAlive,
  log = () => {}
} = {}) {
  const d = { ...deps, isAlive };
  const finish = (extra = {}) => {
    const after = checkPoller({ lockPath, deps: d });
    return { code: after.code, confirmed: after.code === 0, line: after.line, ...extra };
  };
  const before = inspectLock(lockPath, d);
  if (before.state === "absent") {
    log("nenhuma trava: poller ja parado");
    return finish({ killed: false });
  }
  if (before.state === "stale") {
    // Nao encerra nenhum processo: nada prova que o PID da trava e o poller. So limpa a trava obsoleta.
    log(`trava obsoleta (${before.reason}): removendo; nenhum processo encerrado`);
    rm(lockPath);
    rm(stopRequestPath(lockPath));
    return finish({ killed: false, note: before.reason });
  }
  const pid = before.record?.pid;
  const token = before.record?.token;
  if (!pid || pid === process.pid) {
    return { code: 1, confirmed: false, line: "trava em criacao ou invalida: tente de novo", killed: false };
  }
  // 1) graciosa: pedido por arquivo (o poller confere a cada batimento e encerra apos a tarefa atual)
  log(`pedindo parada graciosa ao PID ${pid} (ate ${Math.round(graceMs / 1000)}s)`);
  writeFileSync(stopRequestPath(lockPath), JSON.stringify({ token, requestedAt: new Date().toISOString() }));
  const t0 = Date.now();
  while (Date.now() - t0 < graceMs) {
    await sleep(pollMs);
    const s = inspectLock(lockPath, d);
    if (s.state !== "running" || s.record?.token !== token) break;
  }
  // 2) forcada, so se a MESMA trava ainda vale (confere de novo para nao atingir um PID alheio)
  let killed = false;
  const cur = inspectLock(lockPath, d);
  if (cur.state === "running" && cur.record?.token === token && isAlive(pid)) {
    log(`parada graciosa nao concluiu: encerrando o PID ${pid} a forca`);
    try {
      kill(pid, "SIGTERM");
      killed = true;
    } catch (e) {
      if (e?.code !== "ESRCH") throw e;
    }
    const t1 = Date.now();
    while (isAlive(pid) && Date.now() - t1 < killWaitMs) await sleep(pollMs);
    if (isAlive(pid)) {
      try {
        kill(pid, "SIGKILL");
      } catch (e) {
        if (e?.code !== "ESRCH") throw e;
      }
      const t2 = Date.now();
      while (isAlive(pid) && Date.now() - t2 < killWaitMs) await sleep(pollMs);
    }
  }
  // 3) limpeza: so remove a trava se ainda for a do PID encerrado
  if (!isAlive(pid)) {
    const lock = readLock(lockPath);
    if (lock && (lock.corrupt || lock.record?.token === token)) rm(lockPath);
  }
  rm(stopRequestPath(lockPath));
  return finish({ killed, pid });
}

export async function main(argv = process.argv.slice(2), io = { out: (m) => console.log(m) }) {
  const cmd = argv[0];
  if (cmd === "status") {
    io.out(statusPoller().line);
    return 0;
  }
  if (cmd === "check") {
    const c = checkPoller();
    io.out(`${c.code === 0 ? "OK 0 instancias" : "FALHA ha instancia ativa"}: ${c.line}`);
    return c.code;
  }
  if (cmd === "stop") {
    const r = await stopPoller({ log: io.out });
    io.out(`${r.confirmed ? "CONFIRMADO 0 instancias" : "AINDA HA INSTANCIA"}: ${r.line}`);
    return r.code;
  }
  io.out("uso: poller-ctl.mjs status | stop | check");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
