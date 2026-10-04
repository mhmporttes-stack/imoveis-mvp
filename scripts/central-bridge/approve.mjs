// CLI local minimo de aprovacao: node approve.mjs <task_id> approve|reject|resume
// Usa CENTRAL_APPROVER_SECRET (credencial propria `approver`, distinta do ChatGPT e do executor). O segredo e lido
// do arquivo local e nunca e impresso.
//  approve/reject -> POST /api/central/approver/tasks/{id}/decision (so de AGUARDANDO_DECISAO; repetir = 200 sem efeito)
//  resume         -> POST /api/central/approver/tasks/{id}/resume   (so ERRO ja aprovada, com tentativas sobrando)
import { loadConfig } from "./config.mjs";

const [id, action] = process.argv.slice(2);
const config = loadConfig();
if (!id || !["approve", "reject", "resume"].includes(action) || !config.approverSecret) {
  console.error("uso: node approve.mjs <task_id> approve|reject|resume (requer CENTRAL_APPROVER_SECRET local)");
  process.exit(1);
}
const path = action === "resume" ? "resume" : "decision";
const res = await fetch(`${config.baseUrl}/api/central/approver/tasks/${encodeURIComponent(id)}/${path}`, {
  method: "POST",
  headers: { authorization: `Bearer ${config.approverSecret}`, "content-type": "application/json" },
  body: JSON.stringify(action === "resume" ? {} : { decision: action })
});
const json = await res.json().catch(() => ({}));
console.log(res.status, json.status || json.error?.code || "", json.idempotent_replay ? "(sem efeito: ja estava assim)" : "");
process.exit(res.ok ? 0 : 1);
