import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Regra do dono (2026-10-02): a ORIGEM decide.
//  - WhatsApp automático + número da equipe -> NÃO cria cliente.
//  - Formulário/link/captação/cadastro manual + número da equipe -> cria
//    normalmente (integrante pode testar a jornada como cliente).
// Teste estrutural: os caminhos automáticos do WhatsApp consultam
// lib/internal-phones.js; os caminhos intencionais NUNCA importam essa trava.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");
const imports = (file) => source(file).split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");

const AUTOMATIC = [
  "lib/whatsapp-individual-inbound.js", // WhatsApp individual: contato direto
  "lib/whatsapp-sponsored-lead.js", // número oficial: anúncio e contato orgânico
  "lib/whatsapp-automation-replies.js", // palavra-chave / Fluxo (roleta)
  "lib/whatsapp-master.js", // resposta automática por palavra-chave
  "lib/prospecting-reply.js" // resposta à Prospecção
];
const INTENTIONAL = [
  "lib/simulation-registrations.js", // formulário de simulação, links, cadastro manual
  "lib/captacoes.js", // link de captação
  "app/api/simulation-registrations/route.js",
  "app/api/simulation-registrations/manual/route.js", // cadastro manual
  "app/api/simulation-registrations/quick-attendance/route.js", // atendimento rápido
  "app/api/captacoes/route.js"
];

for (const file of AUTOMATIC) {
  test(`${file} confere número da equipe antes de agir`, () => {
    assert.match(imports(file), /internal-phones/);
    assert.match(source(file), /findInternalTeamPhone\(/);
  });
}

for (const file of INTENTIONAL) {
  test(`${file} (cadastro intencional) não bloqueia número da equipe`, () => {
    assert.doesNotMatch(imports(file), /internal-phones/);
  });
}

test("cadastro automático do WhatsApp individual só roda para número de fora da equipe", () => {
  assert.match(source("lib/whatsapp-individual-inbound.js"), /if \(!conversation\.client_id && userId && !internalContact\)/);
});
