// Histórico completo do cliente (pedido do dono, 2026-10-06): o cadastro criado por reentrada por anúncio mostra
// também a linha do tempo do(s) cadastro(s) anterior(es) da mesma pessoa — quando entrou pela 1ª vez e para quem foi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("linha do tempo mescla os cadastros anteriores ligados por ad_reentry_of, marcados com o código de origem", () => {
  const lib = read("lib/client-journey.js");
  assert.match(lib, /acquisition_context\?\.metadata\?\.ad_reentry_of/);
  assert.match(lib, /MAX_PREVIOUS_RECORDS = 5/, "trava de profundidade contra ciclo");
  assert.match(lib, /seen\.has\(previousId\)/, "nunca entra em ciclo");
  assert.match(lib, /previousRecord: \{ clientCode: record\.clientCode \}/);
  assert.match(lib, /id: `\$\{record\.id\}:\$\{event\.id\}`/, "ids únicos entre cadastros");
  // o acesso continua decidido pelo cadastro aberto (getSimulationRegistration com auth)
  assert.match(lib, /const registration = await getSimulationRegistration\(id, auth\);\n\s+if \(!registration\) throw/);
  // só leitura: nada é gravado/copiado entre cadastros
  const previous = /async function loadPreviousRecords[\s\S]*?\n}\n/.exec(lib)?.[0] || "";
  assert.ok(previous && !/\.(insert|update|upsert|delete)\(/.test(previous));
});

test("tela: selo 'Cadastro anterior', 'Primeiro cadastro' com o corretor, e 'Primeira entrada' no cabeçalho", () => {
  const ui = read("components/ClientJourneyActions.jsx");
  assert.match(ui, /Cadastro anterior \{event\.previousRecord\.clientCode\}/);
  assert.match(ui, /PRIMEIRO CADASTRO/);
  assert.match(ui, /Corretor: \$\{d\.initialResponsibleName\}/);
  assert.match(ui, /label="Primeira entrada"/);
});

test("roleta sem corretor on-line: histórico registra com quem o cliente ficou (não mais '—')", () => {
  const lib = read("lib/simulation-registrations.js");
  assert.match(lib, /toUserId: responsibleUserId \|\| registration\.responsibleUserId \|\| null/);
  assert.match(lib, /heldByOwner: true/);
  const ui = read("components/ClientJourneyActions.jsx");
  assert.match(ui, /if \(d\.heldByOwner\)/);
});
