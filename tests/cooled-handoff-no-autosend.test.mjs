import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// REGRA OFICIAL (dono, 2026-10-16, FUN-15b): a mensagem gerada por IA na transferência do cliente que esfriou
// NUNCA é enviada automaticamente. O corretor recebe o rascunho, edita/aprova e só então envia ele mesmo.
// Trava estática: nenhum caminho de envio de WhatsApp pode entrar no fluxo de transferência nem no card do rascunho.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const SEND_PATTERNS = [/sendIndividualMessage/, /sendChatMessage/, /sendChatTemplate/, /deliverChatMessage/, /sendReservedAutomationMessage/, /sendWhatsapp/i, /whatsapp-chat\/conversations\/[^"'`]*\/messages/];

test("lib/cooled-clients.js não importa nem chama nenhum envio de WhatsApp", () => {
  const source = read("lib/cooled-clients.js");
  for (const pattern of SEND_PATTERNS) assert.doesNotMatch(source, pattern);
});

test("returnClientToRoulette (transferência) não envia mensagem ao cliente", () => {
  const source = read("lib/lead-distribution.js");
  const start = source.indexOf("export async function returnClientToRoulette");
  assert.ok(start >= 0);
  const next = source.indexOf("\nexport ", start + 10);
  const body = source.slice(start, next < 0 ? undefined : next);
  for (const pattern of SEND_PATTERNS) assert.doesNotMatch(body, pattern);
});

test("card do rascunho: só lê (GET), texto editável e cópia só depois da revisão confirmada", () => {
  const source = read("components/cooled/CooledHandoffCard.jsx");
  assert.doesNotMatch(source, /method:\s*["'](POST|PUT|PATCH)["']/);
  for (const pattern of SEND_PATTERNS) assert.doesNotMatch(source, pattern);
  assert.match(source, /<textarea/);
  assert.match(source, /const canCopy = reviewed && draft\.trim\(\)\.length > 0/);
  assert.match(source, /disabled=\{!canCopy\}/);
});

test("prompt da IA pede rascunho de pós-atendimento no formato do dono (FUN-15c)", () => {
  const source = read("lib/ai-chat-assist.js");
  const start = source.indexOf("const HANDOFF_INSTRUCTIONS");
  const prompt = source.slice(start, source.indexOf("`;", start));
  assert.match(prompt, /PÓS-ATENDIMENTO/);
  assert.match(prompt, /associado do corretor Matheus Machado/);
  assert.match(prompt, /não acrescente "Imóveis" nem nome de empresa/);
  assert.match(prompt, /sem inventar nome/);
  assert.match(prompt, /sem emoji/);
  assert.match(prompt, /sem promessas/);
  assert.match(prompt, /Comece EXATAMENTE com "\{saudacao\}, "|comece EXATAMENTE com "\{saudacao\}, "/);
});

// FUN-15d (dono, 2026-10-16): telefone do cliente em todos os cards do fluxo, só para quem já pode ver o cliente.
test("cards do fluxo mostram o telefone copiável (motivo, decisora, histórico e quem recebe)", () => {
  for (const path of ["components/alerts/AlertCenterGate.jsx", "components/cooled/CooledClientsInbox.jsx", "components/cooled/CooledHandoffCard.jsx", "app/admin/desempenho/esfriados/page.jsx"]) {
    assert.match(read(path), /<CooledClientPhone /, path);
  }
  const lib = read("lib/cooled-clients.js");
  assert.match(lib, /clientPhone: client\?\.phone/);
  assert.match(lib, /clientPhone: clients\.get\(row\.client_id\)\?\.phone/);
  assert.match(lib, /clientPhone: registration\?\.phone_normalized/);
  // A janela do motivo só recebe o número de cliente que quem vê pode acessar.
  const attach = lib.slice(lib.indexOf("export async function attachCooledAlertPhones"), lib.indexOf("// Passo 2: a decisora"));
  assert.match(attach, /assertCanAccessResponsibleUser\(auth, row\.responsible_user_id\)/);
  assert.match(read("lib/crm-alerts.js"), /attachCooledAlertPhones\(auth, own\)/);
});

// REGRA OFICIAL (dono, 2026-10-16): "Os clientes transferidos para novos corretores devem receber uma tag informando o
// recebimento desse novo cliente transferido." Tag única do sistema de etiquetas, sem recolorir e sem duplicar.
test("transferência do fluxo aplica a etiqueta 'Cliente transferido' (uma vez, sem recolorir)", async () => {
  const { COOLED_TRANSFER_TAG } = await import("../lib/cooled-clients-core.mjs");
  assert.equal(COOLED_TRANSFER_TAG.name, "Cliente transferido");
  // Cor da paleta padrão das etiquetas (lib/client-tags.js, DEFAULT_TAG_COLORS).
  assert.ok(read("lib/client-tags.js").includes(`"${COOLED_TRANSFER_TAG.color}"`));
  const server = read("lib/cooled-clients.js");
  const transferBranch = server.slice(server.indexOf('} else if (action === "transfer") {'), server.indexOf("} else {", server.indexOf('} else if (action === "transfer") {')));
  assert.match(transferBranch, /returnClientToRoulette[\s\S]*tagTransferredClient\(row\.client_id\)/);
  assert.match(server, /addSystemTagToClient\(clientId, COOLED_TRANSFER_TAG\.name, COOLED_TRANSFER_TAG\.color\)/);
  const tags = read("lib/client-tags.js");
  const fn = tags.slice(tags.indexOf("export async function addSystemTagToClient"), tags.indexOf("export function rowToTag"));
  assert.match(fn, /createTagKeepingExisting/);
  assert.match(fn, /ignoreDuplicates: true/);
});
