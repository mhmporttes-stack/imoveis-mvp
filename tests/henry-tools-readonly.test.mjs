import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHenryAwaitingReport,
  buildHenryClientsReport,
  buildHenryConversationReport,
  buildHenryFinanceReport,
  buildHenryPresenceReport,
  describeDocuments,
  describeSimulation,
  henryClientQueries,
  pickClientMatches,
  speakableStage
} from "../lib/henry-reports-core.mjs";
import { HENRY_FALLBACK_REPLY, HENRY_SCREEN_REPLY, HENRY_TOOL_ACCESS, safeHenryReply } from "../lib/henry-voice-core.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";
import { journeyEventTitleAndDescription } from "../lib/journey-event-labels.mjs";
import { henryProgressFor, pickHenryAnswerScene } from "../lib/henry-voice-narration.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";

// Henry: leitura ampla do CRM (dono, 2026-10-23 — "pedi o status de 3 clientes e ele disse que não consegue; ele deve
// ter acesso a todas e qualquer informação do sistema"). Continua SOMENTE LEITURA (HENRY-1).

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const STAGES = { in_service: "Em atendimento", documentation: "Aguardando documentação", income_commitment: "Comprometimento de renda", approved: "Cliente aprovado" };
const BROKERS = { b1: "Ana Lima", b2: "Carolina Souza", b3: "Eduardo Reis" };
const ctx = { statusLabel: (value) => STAGES[value] || "—", brokerName: (id) => BROKERS[id] || "", formatDate: () => "20/10 (há 2 dias)" };
const row = (id, name, status, broker) => ({ id, full_name: name, status, responsible_user_id: broker, last_whatsapp_contact_at: "2026-10-20T12:00:00Z" });
const nameQuery = (term) => ({ kind: "name", term, label: term, broker: "" });

// --- Nenhuma ferramenta escreve --------------------------------------------------------------------------------------
test("toda ferramenta do Henry está na lista de acesso e nenhuma escreve no CRM", () => {
  const lib = read("../lib/henry-voice.js");
  const block = lib.slice(lib.indexOf("const TOOLS = ["), lib.indexOf("const idSlot"));
  const names = [...block.matchAll(/^ {4}name: "([a-z_]+)"/gm)].map((match) => match[1]);
  assert.ok(names.length >= 14, `ferramentas encontradas: ${names.join(", ")}`);
  for (const name of names) assert.ok(HENRY_TOOL_ACCESS[name], `ferramenta sem classificação: ${name}`);
  assert.deepEqual([...names].sort(), Object.keys(HENRY_TOOL_ACCESS).sort());
  for (const [name, access] of Object.entries(HENRY_TOOL_ACCESS)) assert.ok(["leitura", "navegacao", "musica"].includes(access), `${name}: ${access}`);
  for (const name of ["buscar_clientes", "conversas_aguardando", "financeiro_resumo", "presenca_hoje"]) assert.equal(HENRY_TOOL_ACCESS[name], "leitura");
});

test("leituras do Henry não gravam: sem insert/update/upsert/delete/rpc e financeiro sem o auto-reparo", () => {
  const reports = read("../lib/henry-reports.js");
  assert.doesNotMatch(reports, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.match(reports, /listFinancialSales\(auth, \{ repair: false \}\)/);
  const financial = read("../lib/financial.js");
  assert.match(financial, /const repaired = !repair \? \[\] :/);
  // sem SQL livre: não há ferramenta de consulta genérica
  assert.doesNotMatch(read("../lib/henry-voice.js"), /name: "(sql|consulta_livre|executar)/);
});

test("escopo do dono: busca pelo escopo de quem pergunta, sem Particular; financeiro só o dono", () => {
  const reports = read("../lib/henry-reports.js");
  const finder = reports.slice(reports.indexOf("async function findClientRows"), reports.indexOf("function nextActivityOf"));
  assert.match(finder, /is\("private_contact_at", null\)/);
  assert.match(finder, /applyResponsibleUserScope\(builder, auth\)/);
  assert.match(reports, /if \(!isExpectedReceiptOwner\(auth\)\) return null;/);
  assert.match(reports, /getPrivateJourney\(row\.id, auth/); // linha do tempo passa pela checagem de acesso da ficha
  assert.match(reports, /listCalendarActivitiesForClients\(ids, auth\)/);
});

// --- Vários clientes, ambíguo, inexistente ----------------------------------------------------------------------------
test("vários clientes num pedido: uma consulta por nome/telefone, sem repetir, no máximo 6", () => {
  const queries = henryClientQueries({ clientes: [{ nome: "Ana" }, { nome: "ana" }, { nome: "Bruno", corretor: "Carol" }, { telefone: "(14) 99999-0000" }, { nome: "x" }] });
  assert.deepEqual(queries.map((query) => query.kind), ["name", "name", "phone"]);
  assert.equal(queries[1].broker, "Carol");
  assert.equal(queries[2].term, "14999990000");
  assert.equal(henryClientQueries({ nome: "Maria" }).length, 1); // formato antigo
  assert.equal(henryClientQueries({ clientes: Array.from({ length: 10 }, (_, i) => ({ nome: `Cliente ${String.fromCharCode(65 + i)}` })) }).length, 6);
});

test("três clientes: uma frase por cliente com etapa, corretor e último contato", () => {
  const report = buildHenryClientsReport({
    ...ctx,
    results: [
      { query: nameQuery("Ana"), rows: [row("c1", "Ana Paula", "in_service", "b1")] },
      { query: nameQuery("Bruno"), rows: [row("c2", "Bruno Dias", "documentation", "b2")] },
      { query: nameQuery("Carla"), rows: [row("c3", "Carla Mendes", "approved", "b3")] }
    ]
  });
  assert.equal(report.facts.length, 3);
  assert.equal(report.ambiguous, false);
  assert.match(report.spoken, /Ana está em Em atendimento, com Ana/);
  assert.match(report.spoken, /Bruno está em Aguardando documentação, com Carolina/);
  assert.match(report.spoken, /Carla está em Cliente aprovado, com Eduardo/);
  assert.ok(isSafeToSpeak(report.spoken));
  assert.equal(report.detail.sections.length, 3);
  const labels = report.detail.sections[0].rows.map((item) => item.label);
  for (const label of ["Etapa", "Responsável", "Último contato", "Próxima atividade", "Simulação", "Documentos", "Análise CCA", "Origem"]) assert.ok(labels.includes(label), label);
});

test("nome ambíguo: até 3 opções com corretor e etapa e termina perguntando qual", () => {
  const rows = [row("a", "Maria Silva", "in_service", "b1"), row("b", "Maria Souza", "documentation", "b2"), row("c", "Maria Reis", "approved", "b3"), row("d", "Maria Lima", "in_service", "b1")];
  const report = buildHenryClientsReport({ ...ctx, results: [{ query: nameQuery("Maria"), rows: pickClientMatches(nameQuery("Maria"), rows, ctx.brokerName) }, { query: nameQuery("Ana"), rows: [row("c1", "Ana Paula", "in_service", "b1")] }] });
  assert.equal(report.ambiguous, true);
  assert.match(report.spoken, /Qual deles\?$/); // a pergunta fica por último → pergunta pendente na tela
  assert.match(report.spoken, /Maria S\., com Ana, em Em atendimento/);
  assert.match(report.spoken, /e mais 1/);
  assert.equal(report.facts[0].varios_clientes.length, 3);
  // escolher pelo corretor ("o da Carol") e pelo nome completo
  assert.deepEqual(pickClientMatches({ ...nameQuery("Maria"), broker: "Carol" }, rows, ctx.brokerName).map((item) => item.id), ["b"]);
  assert.deepEqual(pickClientMatches(nameQuery("Maria Reis"), [...rows, row("e", "Maria Reis Neta", "in_service", "b1")], ctx.brokerName).map((item) => item.id), ["c"]);
});

test("cliente inexistente: diz que não achou (nome e telefone), sem inventar", () => {
  const report = buildHenryClientsReport({ ...ctx, results: [{ query: nameQuery("Zuleica"), rows: [] }, { query: { kind: "phone", term: "14999990000", label: "esse telefone" }, rows: [] }] });
  assert.match(report.spoken, /Não achei nenhum cliente com o nome Zuleica\./);
  assert.match(report.spoken, /Não achei nenhum cliente com esse telefone\./);
  assert.equal(report.spoken.includes("14999990000"), false);
  assert.deepEqual(report.facts.map((item) => item.encontrados), [0, 0]);
});

test("etapa com palavra barrada na voz não derruba a resposta inteira", () => {
  assert.equal(isSafeToSpeak("Comprometimento de renda"), false);
  assert.equal(speakableStage("Comprometimento de renda"), "numa etapa que deixei na tela");
  const report = buildHenryClientsReport({ ...ctx, results: [{ query: nameQuery("Ana"), rows: [row("c1", "Ana Paula", "income_commitment", "b1")] }] });
  assert.ok(isSafeToSpeak(report.spoken));
  assert.equal(report.detail.sections[0].rows[0].value, "Comprometimento de renda"); // na tela, a etiqueta de sempre
  assert.equal(safeHenryReply("Ana está em Comprometimento de renda.", { screenFallback: true }), HENRY_SCREEN_REPLY);
  assert.equal(safeHenryReply("Ana está em Comprometimento de renda."), HENRY_FALLBACK_REPLY);
});

test("simulação, documentos e linha do tempo pelas fontes da ficha", () => {
  assert.equal(describeSimulation({ rows: [] }), "Sem simulação");
  assert.equal(describeSimulation({ rows: [{ financing_value: 150000, created_by: "ana@x.com" }], sent: true }), "Feita, enviada");
  assert.equal(describeSimulation({ rows: [{ financing_value: 150000, created_by: "Simulação automática do site" }], sent: false }), "Automática do site, ainda não enviada");
  assert.equal(describeDocuments(null), "Nenhum documento enviado");
  assert.equal(describeDocuments({ status: "analyzed", total_files: 5, conform: 4, pending: 1 }), "5 arquivos, 4 conformes e 1 com pendência");
  assert.equal(journeyEventTitleAndDescription({ type: "status", previousStatus: "in_service", newStatus: "documentation" }).title, "STATUS ALTERADO");
});

// --- Outras leituras ---------------------------------------------------------------------------------------------------
test("chat, financeiro e presença: frases seguras para a voz", () => {
  const awaiting = buildHenryAwaitingReport({ total: 5, late: 2, groups: [{ brokerId: "b1", count: 3, oldest: { name: "Maria Silva", waitingMinutes: 90 } }, { brokerId: "b2", count: 2 }], brokerName: ctx.brokerName });
  assert.match(awaiting.spoken, /5 conversas aguardam resposta, 2 atrasadas; Ana com 3, Carolina com 2/);
  assert.equal(buildHenryAwaitingReport({ groups: [{ brokerId: "b1", count: 3 }], brokerName: ctx.brokerName, onlyBrokerId: "b1" }).facts.aguardando_resposta, 3);
  const conversation = buildHenryConversationReport({ clientName: "Maria Silva", conversations: [{ unread_count: 2, last_inbound_at: "2026-10-22T10:00:00Z", last_message_at: "x", ai_summary: { text: "Quer: casa", generated_at: "2026-10-22T11:00:00Z", last_message_at: "x" } }], formatDate: () => "22/10" });
  assert.equal(conversation.facts.resumo_em_cache.desatualizado, false);
  assert.equal(buildHenryConversationReport({ clientName: "Maria", conversations: [{ unread_count: 0 }] }).facts.resumo_em_cache, null); // nunca gera resumo novo
  const finance = buildHenryFinanceReport({ receivedThisMonth: 12500.4, expectedThisMonth: 30000, overdueBeforeMonth: 0, next30: 1000 });
  assert.match(finance.spoken, /12\.500 reais/);
  assert.ok(isSafeToSpeak(finance.spoken)); // nunca "R$" na voz
  const presence = buildHenryPresenceReport({ ownerId: "o", ownerAtOffice: true, members: [{ id: "o", name: "Matheus", office: { active: true } }, { id: "b1", name: "Ana Lima", office: { active: true, firstSeenAt: "2026-10-23T11:00:00Z" } }, { id: "b2", name: "Bruno", office: { active: false } }], formatTime: () => "08:00" });
  assert.equal(presence.spoken, "Na imobiliária hoje: Ana. Você também está aí.");
});

test("narração e cena das ferramentas novas; prompt sem 'não tenho acesso'", () => {
  assert.equal(henryProgressFor("buscar_clientes", { clientes: [{ nome: "a" }, { nome: "b" }] }).label, "Procurando os clientes…");
  assert.equal(pickHenryAnswerScene({ tools: [{ name: "buscar_clientes", input: {} }] }), "cliente");
  const prompt = buildHenryStaticPrompt();
  assert.match(prompt, /Nunca diga que não tem acesso a dados do CRM/);
  assert.match(prompt, /buscar_clientes com TODOS os nomes numa chamada só/);
  assert.doesNotMatch(prompt, /use só contagens e primeiros nomes/);
});
