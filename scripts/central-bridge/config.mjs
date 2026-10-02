// Config LOCAL do poller: arquivo FORA do repositorio (%USERPROFILE%\.central-bridge.env) + variaveis de ambiente.
// Nada do payload das tarefas chega aqui: a config so e lida na partida, do ambiente local.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://www.matheusmachadoimoveis.com.br";

export function parseEnvFile(content) {
  const out = {};
  for (const line of String(content).split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export function loadConfig(env = process.env, readFile = (p) => readFileSync(p, "utf8")) {
  const file = env.CENTRAL_BRIDGE_ENV || join(homedir(), ".central-bridge.env");
  let fromFile = {};
  try {
    fromFile = parseEnvFile(readFile(file));
  } catch {
    // sem arquivo: usa so o ambiente
  }
  const get = (k, d = "") => String(env[k] ?? fromFile[k] ?? d);
  const poll = Number(get("CENTRAL_POLL_SECONDS", "15"));
  return {
    baseUrl: get("CENTRAL_BASE_URL", DEFAULT_BASE_URL).replace(/\/+$/, ""),
    executorSecret: get("CENTRAL_EXECUTOR_SECRET"),
    approverSecret: get("CENTRAL_APPROVER_SECRET"),
    pollSeconds: Number.isFinite(poll) ? Math.min(Math.max(poll, 5), 300) : 15,
    workerId: get("CENTRAL_WORKER_ID", "pc-central-1"),
    executor: get("CENTRAL_EXECUTOR", "echo"),
    claudeEnabled: get("CENTRAL_CLAUDE_EXECUTOR_ENABLED", "false").toLowerCase() === "true"
  };
}
