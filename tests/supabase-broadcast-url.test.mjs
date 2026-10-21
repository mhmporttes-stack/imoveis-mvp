// Broadcast do Realtime (Chat do WhatsApp, supervisão, alertas): a variável de produção do Supabase traz "/rest/v1" e
// a URL saía ".../rest/v1/realtime/v1/api/broadcast" (404 nos logs, 2026-10-21). Só a origem pode ser usada.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeSupabaseUrl } from "../lib/supabase-url.js";

test("URL do broadcast usa só a origem do Supabase", () => {
  assert.equal(`${normalizeSupabaseUrl("https://abc.supabase.co/rest/v1/")}/realtime/v1/api/broadcast`, "https://abc.supabase.co/realtime/v1/api/broadcast");
  for (const file of ["lib/whatsapp-chat.js", "lib/supervision-messages.js", "lib/crm-alerts.js"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /const url = normalizeSupabaseUrl\(process\.env\.NEXT_PUBLIC_SUPABASE_URL \|\| ""\);/, file);
    assert.doesNotMatch(source, /const url = process\.env\.NEXT_PUBLIC_SUPABASE_URL/, file);
  }
});
