import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Trava do item 27 (WhatsApp individual, 2026-09-28), reforçada pela
// automação da Meta Diária (2026-09-29): o Disparo em massa NUNCA pode falar
// com lib/whatsapp-individual.js — é a sessão pessoal do corretor, e mandar
// campanha em massa por ela é o tipo de uso que bane o número. Teste
// estrutural (lê o código-fonte) em vez de rodar o Disparo de verdade, que
// exigiria banco — o objetivo aqui é travar QUALQUER import futuro do canal
// individual nesses arquivos, não testar o envio em si.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceOf(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

// Só examina as linhas de import de verdade (não o texto de comentários,
// que explicam a trava e por isso citam o nome do arquivo proibido).
function importLines(source) {
  return source.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");
}

for (const file of ["lib/whatsapp-broadcasts.js", "lib/whatsapp-broadcast-schedules.js", "app/api/cron/whatsapp-broadcast-dispatch/route.js"]) {
  test(`${file} não importa nada do canal WhatsApp individual`, () => {
    const imports = importLines(sourceOf(file));
    assert.doesNotMatch(imports, /whatsapp-individual(?!-routing)/, `${file} não pode importar de lib/whatsapp-individual.js`);
    assert.doesNotMatch(imports, /sendIndividualMessage/, `${file} não pode importar sendIndividualMessage`);
  });
}

test("lib/whatsapp-broadcasts.js mantém o comentário de GUARD documentando a trava", () => {
  const source = sourceOf("lib/whatsapp-broadcasts.js");
  assert.match(source, /GUARD \(WhatsApp individual/);
});
