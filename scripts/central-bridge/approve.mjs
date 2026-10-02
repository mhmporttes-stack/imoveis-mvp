// CLI local minimo de aprovacao: node approve.mjs <task_id> approve|reject
// Usa CENTRAL_APPROVER_SECRET (credencial propria, distinta do ChatGPT e do executor).
import { loadConfig } from "./config.mjs";

const [id, decision] = process.argv.slice(2);
const config = loadConfig();
if (!id || !["approve", "reject"].includes(decision) || !config.approverSecret) {
  console.error("uso: node approve.mjs <task_id> approve|reject (requer CENTRAL_APPROVER_SECRET local)");
  process.exit(1);
}
const res = await fetch(`${config.baseUrl}/api/central/approver/tasks/${encodeURIComponent(id)}/decision`, {
  method: "POST",
  headers: { authorization: `Bearer ${config.approverSecret}`, "content-type": "application/json" },
  body: JSON.stringify({ decision })
});
const json = await res.json().catch(() => ({}));
console.log(res.status, json.status || json.error?.code || "");
process.exit(res.ok ? 0 : 1);
