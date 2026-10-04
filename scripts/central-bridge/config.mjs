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
  const timeout = Number(get("CENTRAL_CLAUDE_TIMEOUT_SECONDS", "120"));
  const writeTimeout = Number(get("CENTRAL_CLAUDE_WRITE_TIMEOUT_SECONDS", "900"));
  return {
    baseUrl: get("CENTRAL_BASE_URL", DEFAULT_BASE_URL).replace(/\/+$/, ""),
    executorSecret: get("CENTRAL_EXECUTOR_SECRET"),
    approverSecret: get("CENTRAL_APPROVER_SECRET"),
    pollSeconds: Number.isFinite(poll) ? Math.min(Math.max(poll, 5), 300) : 15,
    workerId: get("CENTRAL_WORKER_ID", "pc-central-1"),
    executor: get("CENTRAL_EXECUTOR", "echo"),
    claudeEnabled: get("CENTRAL_CLAUDE_EXECUTOR_ENABLED", "false").toLowerCase() === "true",
    // Executor Claude (so usados se CENTRAL_EXECUTOR=claude E a flag acima = true). Nunca vem do payload.
    claudeBin: get("CENTRAL_CLAUDE_BIN", ""),
    claudeCwd: get("CENTRAL_CLAUDE_CWD", ""),
    // Escrita aprovada (worktree isolada): flag PROPRIA, separada da de consulta; padrao desligada. Nunca vem do payload.
    claudeWriteEnabled: get("CENTRAL_CLAUDE_WRITE_ENABLED", "false").toLowerCase() === "true",
    claudeWriteTimeoutMs: Number.isFinite(writeTimeout) ? Math.min(Math.max(writeTimeout, 60), 1800) * 1000 : 900000,
    writeWorktreeDir: get("CENTRAL_WRITE_WORKTREE_DIR", ""),
    gitBin: get("CENTRAL_GIT_BIN", "git"),
    claudeTimeoutMs: Number.isFinite(timeout) ? Math.min(Math.max(timeout, 10), 600) * 1000 : 120000
  };
}
