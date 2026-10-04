import { echoExecutor } from "./echo.mjs";
import { createClaudeExecutor } from "./claude.mjs";
import { createGitRunner, createWorktreeManager, defaultBaseDir } from "./worktree.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// A escolha vem so da config local do poller, nunca do payload.
export function selectExecutor(config) {
  if (config.executor === "claude") {
    // Escrita: so com a flag propria. Sem ela nao existe nem gerenciador de worktree.
    const writeOn = config.claudeWriteEnabled === true;
    const worktrees = writeOn
      ? createWorktreeManager({
          repoRoot: config.claudeCwd || REPO_ROOT,
          baseDir: config.writeWorktreeDir || defaultBaseDir(),
          runGit: createGitRunner({ gitBin: config.gitBin || "git" }),
          ...(config.log ? { log: config.log } : {})
        })
      : null;
    return createClaudeExecutor({
      writeEnabled: writeOn,
      worktrees,
      ...(config.claudeWriteTimeoutMs ? { writeTimeoutMs: config.claudeWriteTimeoutMs } : {}),
      enabled: config.claudeEnabled === true,
      useLocator: true,
      configuredBin: config.claudeBin || "",
      ...(config.claudeCwd ? { cwd: config.claudeCwd } : {}),
      ...(config.claudeTimeoutMs ? { timeoutMs: config.claudeTimeoutMs } : {}),
      ...(config.log ? { log: config.log } : {})
    });
  }
  return echoExecutor;
}
