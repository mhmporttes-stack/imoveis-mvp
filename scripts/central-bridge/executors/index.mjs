import { echoExecutor } from "./echo.mjs";
import { createClaudeExecutor } from "./claude.mjs";

// A escolha vem so da config local do poller, nunca do payload.
export function selectExecutor(config) {
  if (config.executor === "claude") return createClaudeExecutor({ enabled: config.claudeEnabled });
  return echoExecutor;
}
