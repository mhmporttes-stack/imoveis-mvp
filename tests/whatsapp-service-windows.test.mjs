// Servico do WhatsApp no PC Windows do dono (regra do dono, 2026-10-29): scripts presentes, .env.exemplo
// cobre toda variavel lida em src/, nenhum segredo no repositorio, scripts PowerShell so em ASCII
// (o PowerShell 5.1 le .ps1 sem BOM como ANSI e o `irm | iex` nao lida bem com BOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const service = new URL("../whatsapp-individual-service/", import.meta.url).pathname;
const win = join(service, "windows");
const read = (p) => readFileSync(p, "utf8");

test("scripts e guia existem", () => {
  for (const f of ["INSTALAR.bat", "instalar.ps1", "TUNEL.bat", "tunel.ps1", "VERIFICAR.bat", "verificar.ps1", "comum.ps1", ".env.exemplo", "GUIA-PC.md"]) {
    assert.ok(existsSync(join(win, f)), `falta windows/${f}`);
  }
  for (const bat of readdirSync(win).filter((f) => f.endsWith(".bat"))) {
    const ps1 = read(join(win, bat)).match(/%~dp0([\w-]+\.ps1)/)?.[1];
    assert.ok(ps1 && existsSync(join(win, ps1)), `${bat} chama um .ps1 que nao existe`);
  }
});

test(".env.exemplo lista toda variavel lida em src/ (exceto as que a Railway injeta)", () => {
  const src = join(service, "src");
  const names = new Set();
  for (const f of readdirSync(src).filter((n) => n.endsWith(".js"))) {
    const code = read(join(src, f));
    for (const m of code.matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
    for (const m of code.matchAll(/envInt\("([A-Z][A-Z0-9_]+)"/g)) names.add(m[1]);
    for (const m of code.matchAll(/REQUIRED_ENV = \[([^\]]+)\]/g)) for (const n of m[1].matchAll(/"([A-Z0-9_]+)"/g)) names.add(n[1]);
  }
  const exemplo = read(join(win, ".env.exemplo"));
  const missing = [...names].filter((n) => !n.startsWith("RAILWAY_") && !exemplo.includes(n));
  assert.deepEqual(missing, []);
  for (const req of ["APP_WEBHOOK_URL", "WHATSAPP_INDIVIDUAL_SERVICE_SECRET", "SESSION_ENCRYPTION_KEY", "PORT"]) {
    assert.match(exemplo, new RegExp(`^${req}=`, "m"), `${req} precisa estar ativa no exemplo`);
  }
  assert.doesNotMatch(exemplo, /^WHATSAPP_LEASE_DISABLED=/m, "lease nunca desligado no PC");
  // Primeira linha e comentario: um BOM do Bloco de Notas nunca gruda no nome de uma variavel.
  assert.ok(exemplo.startsWith("#"));
});

test("nenhum segredo nos arquivos do PC", () => {
  const exemplo = read(join(win, ".env.exemplo"));
  for (const k of ["APP_WEBHOOK_URL", "WHATSAPP_INDIVIDUAL_SERVICE_SECRET", "SESSION_ENCRYPTION_KEY"]) {
    assert.match(exemplo, new RegExp(`^${k}=\\s*$`, "m"), `${k} deve vir vazia`);
  }
  for (const f of readdirSync(win)) {
    const text = read(join(win, f));
    assert.doesNotMatch(text, /\b[0-9a-f]{32,}\b/i, `${f}: parece conter chave/segredo`);
    assert.doesNotMatch(text, /(tskey-|sk-[A-Za-z0-9]{10,}|eyJhbGci)/, `${f}: parece conter token`);
  }
});

test("scripts PowerShell/.bat so com ASCII", () => {
  for (const f of readdirSync(win).filter((n) => /\.(ps1|bat)$/.test(n))) {
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(read(join(win, f))), `${f} tem caractere fora de ASCII`);
  }
});

test("guia cita a variavel que o CRM realmente le", () => {
  const lib = read(new URL("../lib/whatsapp-individual.js", import.meta.url));
  assert.match(lib, /process\.env\.WHATSAPP_INDIVIDUAL_SERVICE_URL/);
  assert.match(read(join(win, "GUIA-PC.md")), /WHATSAPP_INDIVIDUAL_SERVICE_URL/);
});
