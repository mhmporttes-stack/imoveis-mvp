// Gera o modelo de interação da skill "Central" (V1 + V2 + V3) a partir do catálogo
// e do cadastro de corretores.
//   node scripts/build-alexa-model.mjs [scripts/alexa-brokers.json] > docs/alexa-interaction-model.json
// O arquivo de corretores é o resultado de GET /api/admin/alexa/model?brokers=1 (cadastro do CRM,
// com id/nome completo); sem ele usa o último snapshot salvo. Importar no Console da Alexa
// (Build -> Interaction Model -> JSON Editor) e clicar em Build.
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_BROKERS, auditModel, buildInteractionModel } from "../lib/alexa-v2/model-core.mjs";

const file = process.argv[2] || "scripts/alexa-brokers.json";
const brokers = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : DEFAULT_BROKERS;
const model = buildInteractionModel({ brokers });
const problems = auditModel(model);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
process.stdout.write(JSON.stringify(model, null, 2) + "\n");
