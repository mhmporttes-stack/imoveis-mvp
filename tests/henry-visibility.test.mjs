// Henry OCULTO no CRM por decisão do dono (2026-11-13): interruptor único, reversível, sem apagar nada.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { HENRY_HIDDEN_BY_OWNER, isHenryVisible } from "../lib/henry-visibility.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("padrão oculto; religar é só trocar o interruptor", () => {
  assert.equal(HENRY_HIDDEN_BY_OWNER, true);
  assert.equal(isHenryVisible(), false);
  assert.equal(isHenryVisible(true), false);
  assert.equal(isHenryVisible(false), true);
});

test("o painel só monta o Henry atrás do interruptor (botão, voz, avisos, bloqueio) e os cartões de /admin/alexa também", () => {
  const layout = read("app/admin/layout.jsx");
  assert.match(layout, /isHenryVisible\(\) && auth\.ok && !auth\.accountSwitchMode && isOwnerAdminEmail\(auth\.user\?\.email\) \? \(\s*<HideInFinanceiroApp>\s*<HenryVoiceAssistant \/>/);
  const alexa = read("app/admin/alexa/page.jsx");
  assert.match(alexa, /isHenryVisible\(\) \? <HenrySettingsCard \/> : null/);
  assert.match(alexa, /isHenryVisible\(\) \? <HenryTrainingCard \/> : null/);
});

test("nada do Henry foi apagado (código, rotas e rule continuam)", () => {
  for (const file of ["components/henry/HenryVoiceAssistant.jsx", "lib/henry-voice.js", "app/api/admin/henry/route.js", "app/api/cron/henry-treino/route.js", ".claude/rules/henry-assistente-voz.md"]) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
});

test("o pré-carregamento (AdminWarmup/DATA_WARMERS) e o menu não dependem do Henry", () => {
  for (const file of ["components/AdminWarmup.jsx", "components/admin-warmup-plan.mjs", "components/panel-cache-names.js"]) assert.ok(!/henry/i.test(read(file)), file);
  assert.ok(!/henry/i.test(read("components/AdminMenu.jsx").replace(/data-henry-target=\{[^}]*\}/g, "")));
});
