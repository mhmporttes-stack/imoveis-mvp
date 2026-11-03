import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Lote de SMS: roda o código REAL de lib/sms-batch.js (loadSmsBatch, markSmsSent, 2ª mensagem, desfazer) contra um banco
// falso, para admin geral, gestor, corretor e associado. Pega o que os testes de regra pura não pegam: função chamada e
// não definida (ReferenceError que derrubou a tela em 2026-11-02), campanha por corretor e excesso de consultas.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeUrl = pathToFileURL(path.join(root, "tests/helpers/sms-batch-fake-db.mjs")).href;
register(pathToFileURL(path.join(root, "tests/helpers/sms-batch-loader.mjs")).href, { data: { root, fakeUrl } });

const fake = await import(fakeUrl);
const sms = await import(pathToFileURL(path.join(root, "lib/sms-batch.js")).href);

const ADMIN = { user: { email: "dono@example.com" }, profile: { id: "412695f0-a5fc-4e58-9273-83eca704c2ef", role: "admin", status: "active", name: "Matheus Machado" } };
const MANAGER = { user: { email: "gestora@example.com" }, profile: { id: "11111111-1111-4111-8111-111111111111", role: "manager", status: "active", name: "Gestora" } };
const BROKER = { user: { email: "carlos@example.com" }, profile: { id: "22222222-2222-4222-8222-222222222222", role: "broker", status: "active", name: "Carlos Souza" } };
const BROKER_2 = { user: { email: "paula@example.com" }, profile: { id: "44444444-4444-4444-8444-444444444444", role: "broker", status: "active", name: "Paula Lima" } };
const ASSOCIATE = { user: { email: "ana@example.com" }, profile: { id: "33333333-3333-4333-8333-333333333333", role: "associate", status: "active", name: "Ana" } };
const TEAM_CAMPAIGN = "81a55857-b9ed-441a-b213-bc78e07ec872";

function seed(contacts = 400) {
  const now = Date.now();
  const tables = {
    prospecting_contacts: Array.from({ length: contacts }, (_, index) => ({
      id: `contato-${index + 1}`,
      name: index % 2 ? "Maria Silva" : "",
      phone_normalized: `+55149${String(97000000 + index + 1)}`,
      status: "available",
      assigned_user_id: null,
      owner_user_id: null,
      last_broker_id: null,
      last_attempt_at: null,
      registration_id: null,
      created_at: new Date(now - (100000 - index) * 1000).toISOString()
    })),
    campaigns: [{ id: TEAM_CAMPAIGN, name: "SMS - Lote da base", kind: "custom", broker_id: null, destination_type: "roulette", status: "active", short_code: "9921e29", deleted_at: null, created_at: new Date().toISOString() }],
    admin_users: [ADMIN, MANAGER, BROKER, BROKER_2, ASSOCIATE].map((entry) => ({ id: entry.profile.id, name: entry.profile.name, email: entry.user.email, role: entry.profile.role, status: "active" }))
  };
  fake.resetDb(tables);
}

test("PRIMEIRO TESTE (cache da equipe frio): a tela não dispara centenas de consultas — leitura dos telefones da equipe uma vez só", async () => {
  seed(800);
  await sms.loadSmsBatch(ADMIN);
  // Antes da correção: ~840 consultas, 800 delas só para saber se o telefone é da equipe (cache frio, uma leitura por contato).
  assert.ok(fake.stats.total < 80, `consultas demais: ${fake.stats.total} ${JSON.stringify(fake.stats.byTable)}`);
  assert.ok((fake.stats.byTable.admin_users || 0) <= 2, "telefones da equipe: uma leitura só por carga");
});

test("admin geral: a tela do Lote carrega (equipe), 50 cartões, link da campanha da equipe, sem criar campanha", async () => {
  for (const auth of [ADMIN]) {
    seed();
    const data = await sms.loadSmsBatch(auth);
    assert.equal(data.scope, "team");
    assert.equal(data.items.length, 50);
    assert.deepEqual(data.progress, { sentToday: 0, limit: 50, remaining: 50 });
    assert.match(data.link, /\/c\/9921e29$/);
    assert.equal(fake.DB.campaigns.length, 1);
    assert.equal(fake.DB.sms_batch_reservations?.length || 0, 0, "o lote da equipe nunca reserva contatos");
    assert.ok(Array.isArray(data.brokers) && data.metrics.total.sent === 0);
  }
});

test("gestor: lote próprio (nunca o do dono), sem configurações e só a equipe dele nos resultados", async () => {
  seed();
  const data = await sms.loadSmsBatch(MANAGER);
  assert.equal(data.scope, "manager");
  assert.ok(!/\/c\/9921e29$/.test(data.link), "não usa a campanha do dono");
  assert.equal(data.settings.template, "");
  assert.equal(data.settings.templateBroker, "");
  assert.equal(data.noWhatsapp, null);
  assert.match(data.items[0].text, /sou associado do corretor Matheus Machado/, "gestor se apresenta com o texto de associado, nunca como o dono");
  assert.ok(!/Meu nome é Matheus Machado/.test(data.items[0].text));
  await assert.rejects(sms.saveSmsBatchSettings({ limit: 10 }, MANAGER));
});

test("gestor: filtro O meu / Todos / um corretor muda cartões, por dia e rótulo", async () => {
  seed();
  const mine = await sms.loadSmsBatch(MANAGER, { brokerId: "team" });
  assert.equal(mine.metricsLabel, "O meu");
  assert.equal(mine.lot, "team");
  const all = await sms.loadSmsBatch(MANAGER, {});
  assert.equal(all.metricsLabel, "Minha equipe");
  const one = await sms.loadSmsBatch(MANAGER, { brokerId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(one.lot, "22222222-2222-4222-8222-222222222222");
});

test("resultsOnly: troca de lote devolve só os resultados, sem montar a lista", async () => {
  seed();
  const data = await sms.loadSmsBatch(MANAGER, { brokerId: "team", resultsOnly: true });
  assert.equal(data.items.length, 0);
  assert.equal(data.metricsLabel, "O meu");
  assert.equal(data.lot, "team");
});

test("href do SMS: formato do iOS (sms:+55...&body=) e alternativo (?body=), com as quebras de linha em %0A", async () => {
  seed();
  const [first] = (await sms.loadSmsBatch(ADMIN)).items;
  assert.match(first.href, /^sms:\+55\d{11}&body=/);
  assert.match(first.fallbackHref, /^sms:\+55\d{11}\?body=/);
  assert.ok(first.href.includes("%0A%0A") && !first.href.includes("\n") && !first.href.includes(" "));
  assert.ok(first.text.includes(`/c/9921e29`));
});

test("corretor: lote próprio — campanha própria criada uma vez, 50 reservados, link dele, e outro corretor não recebe os mesmos", async () => {
  seed();
  const first = await sms.loadSmsBatch(BROKER);
  assert.equal(first.scope, "broker");
  assert.equal(first.items.length, 50);
  assert.equal(fake.DB.sms_batch_reservations.length, 50);
  const mine = fake.DB.campaigns.filter((row) => row.broker_id === BROKER.profile.id);
  assert.equal(mine.length, 1);
  assert.ok(first.items[0].text.includes("Carlos") && first.items[0].text.includes(mine[0].id), "texto com o nome e o link do corretor");

  const again = await sms.loadSmsBatch(BROKER);
  assert.deepEqual(again.items.map((item) => item.id), first.items.map((item) => item.id), "mesma lista ao reabrir");
  assert.equal(fake.DB.campaigns.filter((row) => row.broker_id === BROKER.profile.id).length, 1, "campanha do corretor não duplica");

  const other = await sms.loadSmsBatch(BROKER_2);
  const taken = new Set(first.items.map((item) => item.id));
  assert.equal(other.items.length, 50);
  assert.ok(other.items.every((item) => !taken.has(item.id)), "nunca dois corretores com o mesmo contato");

  // O lote da equipe não oferece o que está reservado para corretor.
  const team = await sms.loadSmsBatch(ADMIN);
  const reserved = new Set(fake.DB.sms_batch_reservations.map((row) => row.contact_id));
  assert.ok(team.items.every((item) => !reserved.has(item.id)));
  assert.equal(team.brokers.length, 2);
});

test("associado não tem Lote de SMS", async () => {
  seed();
  await assert.rejects(() => sms.loadSmsBatch(ASSOCIATE), /não está disponível/);
});

test("enviar (1ª) grava a tentativa e tira o contato da fila; 2ª mensagem; desfazer devolve o contato", async () => {
  seed();
  const { items } = await sms.loadSmsBatch(ADMIN);
  const sent = await sms.markSmsSent(items[0].id, ADMIN);
  assert.ok(sent.sendId);
  const contact = fake.DB.prospecting_contacts.find((row) => row.id === items[0].id);
  assert.equal(contact.status, "recent_attempt");
  // Mesmo toque gravado de novo (fila + volta do Mensagens): idempotente, devolve o envio que já existe.
  const again = await sms.markSmsSent(items[0].id, ADMIN);
  assert.equal(again.alreadySent, true);
  assert.equal(again.sendId, sent.sendId);

  const after = await sms.loadSmsBatch(ADMIN);
  assert.equal(after.awaiting.length, 1);
  assert.ok(after.awaiting[0].href.startsWith("sms:+55"));
  assert.ok(after.items.every((item) => item.id !== items[0].id));

  const second = await sms.markSmsSecondSent(after.awaiting[0].id, ADMIN);
  assert.ok(second.sendId);
  assert.equal((await sms.markSmsSecondSent(after.awaiting[0].id, ADMIN)).alreadySent, true);

  const other = (await sms.loadSmsBatch(ADMIN)).items[0];
  const mark = await sms.markSmsSent(other.id, ADMIN);
  await sms.undoSmsSent(mark.sendId, ADMIN);
  assert.equal(fake.DB.prospecting_contacts.find((row) => row.id === other.id).status, "available");
});

test("a página abre sem montar a lista no servidor (lista lenta não trava a tela nem vira \"Algo deu errado\")", () => {
  const page = readFileSync(path.join(root, "app/admin/lote-sms/page.jsx"), "utf8");
  assert.ok(!/loadSmsBatch/.test(page), "page.jsx não pode esperar loadSmsBatch");
  assert.match(page, /requirePerformancePage/);
  const workspace = readFileSync(path.join(root, "components/SmsBatchWorkspace.jsx"), "utf8");
  assert.match(workspace, /Tentar de novo/);
  assert.match(workspace, /AbortController/);
});
