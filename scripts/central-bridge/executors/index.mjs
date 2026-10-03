import { echoExecutor } from "./echo.mjs";
import { createClaudeExecutor } from "./claude.mjs";

// A escolha vem so da config local do poller, nunca do payload.
export function selectExecutor(config) {
  if (config.executor === "claude") {
    return createClaudeExecutor({
      enabled: config.claudeEnabled === true,
      ...(config.claudeBin ? { bin: config.claudeBin } : {}),
      ...(config.claudeCwd ? { cwd: config.claudeCwd } : {}),
      ...(config.claudeTimeoutMs ? { timeoutMs: config.claudeTimeoutMs } : {}),
      ...(config.log ? { log: config.log } : {})
    });
  }
  return echoExecutor;
}
