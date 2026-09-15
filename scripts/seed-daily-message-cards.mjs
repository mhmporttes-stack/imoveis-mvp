// Importa a biblioteca inicial da Mensagem do Dia (210 cards: 150 BIB + 60
// REF) para public.daily_message_cards. Idempotente: upsert por
// editorial_id (onConflict), rodar de novo nunca duplica — apenas
// atualiza o conteúdo textual caso o card ainda não tenha sido editado
// manualmente (ver nota abaixo).
//
// Uso: node scripts/seed-daily-message-cards.mjs
// Requer as mesmas variáveis de ambiente já usadas pelo projeto
// (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — lidas do .env
// na raiz do projeto se ainda não estiverem no ambiente.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ALL_DAILY_MESSAGE_CARDS } from "./daily-message-seed-data.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(projectRoot, ".env");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    if (!(key in process.env)) process.env[key] = line.slice(idx + 1);
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Supabase não configurado (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const rows = ALL_DAILY_MESSAGE_CARDS.map((card) => ({
  editorial_id: card.id,
  type: card.type,
  main_text: card.mainText,
  source_text: card.sourceText,
  opening_message: card.openingMessage
}));

const { data, error } = await supabase
  .from("daily_message_cards")
  .upsert(rows, { onConflict: "editorial_id" })
  .select("editorial_id, type");

if (error) {
  console.error("Falha ao importar a biblioteca:", error.message);
  process.exit(1);
}

const bib = (data || []).filter((row) => row.type === "biblical").length;
const ref = (data || []).filter((row) => row.type === "reflection").length;
console.log(`Importação concluída: ${data.length} cards (BIB=${bib}, REF=${ref}).`);
