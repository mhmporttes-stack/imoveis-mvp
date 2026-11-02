import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SMS_BATCH_DEFAULT_TEMPLATE,
  SMS_BATCH_DEFAULT_TEMPLATE_2,
  SMS_BATCH_DEFAULT_TEMPLATE_BROKER,
  SMS_SKIP_REASON,
  buildSmsHrefs,
  isSmsBrokerCampaign,
  renderSmsText,
  scopeSmsEvents,
  smsBatchScope,
  smsSkipReason,
  validateSmsTemplate
} from "../lib/sms-batch-core.mjs";
import { listActiveReservations, listBrokerReservedContactIds, releaseSmsReservation, reserveSmsContacts } from "../lib/sms-batch-reservations.mjs";

// Lote de SMS dos corretores (dono, 2026-11-02): lote próprio de até 50/dia com contatos RESERVADOS por 24 h, link da campanha
// do corretor (atribuição direta, sem roleta), mensagem do corretor (associado do corretor Matheus Machado) e SAIR igual.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const LINK = "https://www.matheusmachadoimoveis.com.br/c/xyz1234";

// --- Banco falso: só o que sms-batch-reservations.mjs usa (PK em contact_id, INSERT atômico, 23505 em conflito) ---
function fakeClient() {
  const store = new Map();
  class Query {
    constructor() { this.op = "select"; this.filters = []; }
    select() { return this; }
    delete() { this.op = "delete"; return this; }
    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    gt(column, value) { this.filters.push((row) => row[column] > value); return this; }
    lte(column, value) { this.filters.push((row) => row[column] <= value); return this; }
    order() { return this; }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
    run() {
      const match = (row) => this.filters.every((filter) => filter(row));
      if (this.op === "insert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const ids = rows.map((row) => row.contact_id);
        if (ids.some((id) => store.has(id)) || new Set(ids).size !== ids.length) return { data: null, error: { code: "23505", message: "duplicate key" } };
        for (const row of rows) store.set(row.contact_id, { ...row });
        return { data: null, error: null };
      }
      if (this.op === "delete") {
        for (const [id, row] of [...store]) if (match(row)) store.delete(id);
        return { data: null, error: null };
      }
      return { data: [...store.values()].filter(match).sort((a, b) => (a.reserved_at < b.reserved_at ? -1 : 1)), error: null };
    }
  }
  return { store, from: () => new Query() };
}

const ids = (count, prefix = "c") => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

test("reserva atômica: dois corretores pedindo os mesmos contatos ao mesmo tempo nunca ficam com o mesmo", async () => {
  const client = fakeClient();
  const candidates = ids(10);
  const [a, b] = await Promise.all([
    reserveSmsContacts({ client, brokerId: "A", contactIds: candidates, limit: 5 }),
    reserveSmsContacts({ client, brokerId: "B", contactIds: candidates, limit: 5 })
  ]);
  assert.equal(a.length, 5);
  assert.equal(b.length, 5);
  assert.deepEqual(a.filter((id) => b.includes(id)), [], "nenhum contato nos dois lotes");
  assert.equal(new Set([...a, ...b]).size, 10);
  // Quem já está reservado para A nunca aparece em B, mesmo depois.
  assert.deepEqual(await reserveSmsContacts({ client, brokerId: "B", contactIds: a, limit: 5 }), []);
});

test("reserva: respeita o limite do corretor e é idempotente para ele mesmo", async () => {
  const client = fakeClient();
  const first = await reserveSmsContacts({ client, brokerId: "A", contactIds: ids(8), limit: 3 });
  assert.deepEqual(first, ["c1", "c2", "c3"]);
  const again = await reserveSmsContacts({ client, brokerId: "A", contactIds: first, limit: 3 });
  assert.deepEqual(again, first);
  assert.deepEqual(await listBrokerReservedContactIds(client, "A"), ["c1", "c2", "c3"]);
  assert.equal(await reserveSmsContacts({ client, brokerId: "A", contactIds: ids(8), limit: 0 }).then((rows) => rows.length), 0);
});

test("reserva vence em 24 h e libera o contato: sem reserva fantasma", async () => {
  const client = fakeClient();
  const t0 = new Date("2026-11-02T12:00:00Z");
  await reserveSmsContacts({ client, brokerId: "A", contactIds: ["c1", "c2"], limit: 2, now: t0 });
  const justBefore = new Date(t0.getTime() + 23 * 3600000 + 59 * 60000);
  assert.equal((await listActiveReservations(client, ["c1"], justBefore)).length, 1);
  assert.deepEqual(await reserveSmsContacts({ client, brokerId: "B", contactIds: ["c1"], limit: 1, now: justBefore }), []);
  const after = new Date(t0.getTime() + 24 * 3600000 + 1000);
  assert.equal((await listActiveReservations(client, ["c1", "c2"], after)).length, 0, "vencida não vale na leitura");
  assert.deepEqual(await listBrokerReservedContactIds(client, "A", after), []);
  assert.deepEqual(await reserveSmsContacts({ client, brokerId: "B", contactIds: ["c1", "c2"], limit: 2, now: after }), ["c1", "c2"]);
});

test("enviar ou soltar a reserva devolve só a do próprio corretor", async () => {
  const client = fakeClient();
  await reserveSmsContacts({ client, brokerId: "A", contactIds: ["c1"], limit: 1 });
  await releaseSmsReservation(client, "c1", "B");
  assert.equal(client.store.size, 1, "outro corretor não solta a reserva alheia");
  await releaseSmsReservation(client, "c1", "A");
  assert.equal(client.store.size, 0);
});

test("a reserva é a CHAVE PRIMÁRIA do contato (migration aditiva, sem policy pública)", () => {
  const sql = read("supabase/migrations/20261102160000_sms_batch_reservations.sql");
  assert.match(sql, /contact_id uuid primary key references public\.prospecting_contacts\(id\)/);
  assert.match(sql, /expires_at timestamptz not null/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.sms_batch_reservations from anon, authenticated/);
  assert.match(sql, /create table if not exists/);
  assert.doesNotMatch(sql, /drop table|delete from|truncate/i);
  assert.match(sql, /create unique index if not exists campaigns_sms_batch_broker_unique/);
});

test("elegibilidade única: reservado por OUTRO corretor sai; a reserva do próprio corretor não bloqueia; resto da regra igual", () => {
  const contact = { phone: "+5514999998888", status: "available", assignedUserId: null, ownerUserId: null, lastBrokerId: null, lastAttemptAt: null, registrationId: null };
  assert.equal(smsSkipReason({ ...contact, brokerReserved: true }), SMS_SKIP_REASON.BROKER_RESERVED);
  assert.equal(smsSkipReason({ ...contact, brokerReserved: false }), null);
  // Mesma função para todos: quem já teve tentativa/é cliente continua fora do lote do corretor.
  assert.equal(smsSkipReason({ ...contact, lastAttemptAt: "2026-10-01T00:00:00Z" }), SMS_SKIP_REASON.ALREADY_TRIED);
  assert.equal(smsSkipReason({ ...contact, isClientPhone: true }), SMS_SKIP_REASON.IS_CLIENT);
  const lib = read("lib/sms-batch.js");
  assert.match(lib, /brokerReserved: reservations\.has\(row\.id\) && reservations\.get\(row\.id\) !== viewerBrokerId/);
  assert.equal((lib.match(/smsSkipReason\(/g) || []).length >= 2, true);
  assert.doesNotMatch(lib, /function .*[Ee]ligib/, "nenhuma segunda régua de elegibilidade");
});

test("1ª mensagem do corretor: texto do dono, [corretor] = 1º nome de quem envia, associado do Matheus Machado", () => {
  assert.equal(SMS_BATCH_DEFAULT_TEMPLATE_BROKER, "[Saudação] [nome], tudo bem ?\n\nMeu nome é [corretor] e sou associado do corretor Matheus Machado, Corretor de Imóveis.\nQuer saber o quanto a Caixa aprova para você comprar seu imóvel?\n\nFaça a simulação grátis em menos de 2 min clicando no link abaixo, é rápido, grátis e sem compromisso:\n\n[link]");
  const text = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE_BROKER, { name: "maria souza", link: LINK, greeting: "Bom dia", broker: "Caroline Mayumi" });
  assert.equal(text, `Bom dia Maria, tudo bem ?\n\nMeu nome é Caroline e sou associado do corretor Matheus Machado, Corretor de Imóveis.\nQuer saber o quanto a Caixa aprova para você comprar seu imóvel?\n\nFaça a simulação grátis em menos de 2 min clicando no link abaixo, é rápido, grátis e sem compromisso:\n\n${LINK}`);
  assert.doesNotMatch(text, /\[(corretor|nome|link|Saudação)\]/);
});

test("1ª mensagem do corretor sem nome: \"Sou associado do corretor Matheus Machado\"; sem [corretor] solto", () => {
  const text = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE_BROKER, { name: "Ana", link: LINK, greeting: "Boa tarde", broker: "" });
  assert.match(text, /\nSou associado do corretor Matheus Machado, Corretor de Imóveis\./);
  assert.doesNotMatch(text, /\[corretor\]|Meu nome é/);
  const numeric = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE_BROKER, { name: "Ana", link: LINK, greeting: "Boa tarde", broker: "12345" });
  assert.match(numeric, /\nSou associado do corretor/);
});

test("a mensagem do dono e a 2ª mensagem (SAIR) não mudam; a 2ª é a mesma para todos", () => {
  assert.match(SMS_BATCH_DEFAULT_TEMPLATE, /Meu nome é Matheus Machado, sou Corretor de Imóveis\./);
  assert.doesNotMatch(SMS_BATCH_DEFAULT_TEMPLATE, /\[corretor\]|associado/);
  assert.equal(validateSmsTemplate(SMS_BATCH_DEFAULT_TEMPLATE_2, { second: true }), null);
  const second = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE_2, { name: "Ana", link: LINK, greeting: "Bom dia", broker: "Caroline" });
  assert.match(second, /responda SAIR/);
  assert.match(second, /dia abençoado/);
  assert.equal(validateSmsTemplate(SMS_BATCH_DEFAULT_TEMPLATE_BROKER), null);
  assert.equal(validateSmsTemplate("sem link aqui"), "O texto precisa ter [link].");
  // O SMS do corretor abre o app Mensagens do corretor (sms:), com o número do cliente e o texto pronto.
  const { primary } = buildSmsHrefs("(14) 99999-8888", text2());
  assert.match(primary, /^sms:\+5514999998888&body=/);
  function text2() { return renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE_BROKER, { name: "Ana", link: LINK, greeting: "Bom dia", broker: "Caroline" }); }
});

test("escopo por perfil: corretor tem lote próprio; gestor e admin geral, o da equipe; associado, nenhum", () => {
  assert.equal(smsBatchScope({ isBroker: true }), "broker");
  assert.equal(smsBatchScope({ isBroker: true, isAssociate: true }), null, "associado: dúvida = não entra");
  assert.equal(smsBatchScope({ isManager: true, isBroker: true }), "team");
  assert.equal(smsBatchScope({ isGeneralAdmin: true }), "team");
  assert.equal(smsBatchScope({}), null);
});

test("guards: rota e página bloqueiam associado; leitura e ações revalidam o escopo e o dono do envio no servidor", () => {
  const route = read("app/api/admin/lote-sms/route.js");
  assert.doesNotMatch(route, /requireAdminApi|requireBrokerManagementApi/);
  assert.equal((route.match(/requirePerformanceApi\(request\)/g) || []).length, 2);
  const lib = read("lib/sms-batch.js");
  assert.match(lib, /smsBatchScope\(\{ isGeneralAdmin: isGeneralAdminAuth\(auth\), isManager: isManagerProfile\(profile\), isBroker: isBrokerProfile\(profile\), isAssociate: isAssociateProfile\(profile\) \}\)/);
  // O corretor só mexe nos envios DELE; a equipe não mexe nos de corretor (exceto SAIR).
  assert.match(lib, /send\.sent_by !== auth\.profile\.id\) throw new AdminPermissionError/);
  assert.match(lib, /markSmsOptOut[\s\S]*allowTeamOnBroker: true/);
  // O lote do corretor lista só o que está reservado para ele e conta a cota só da campanha dele.
  assert.match(lib, /listBrokerReservedContactIds\(db\(\), brokerId\)/);
  assert.match(lib, /countSentSince\(spDayStartIso\(\), brokerId \? \{ campaignId: campaign\.id \}/);
  // Telefone: só mascarado na tela; o número completo só no href sms: dos contatos do próprio lote.
  assert.match(lib, /phoneMasked: maskSmsPhone\(item\.phone\)/);
  // Reserva de contato novo é sempre pelo servidor (nada vem do cliente), com a chave primária como trava.
  assert.match(lib, /reserveSmsContacts\(\{ client: db\(\), brokerId, contactIds: fresh\.items/);
});

test("SAIR vale igual para o lote do corretor: caminho único de Não contactar em todas as linhas irmãs", () => {
  const lib = read("lib/sms-batch.js");
  const optOut = lib.slice(lib.indexOf("export async function markSmsOptOut"));
  assert.match(optOut, /contactDoNotContactPatch\(now,/);
  assert.match(optOut, /clientDoNotContactPatch\(now\)/);
  assert.match(optOut, /registration_id/);
  assert.match(optOut, /\.in\("phone_normalized", phones\)/);
});

test("eventos do lote: a equipe não vê as linhas de corretor nas abas; o corretor vê só as dele (SAIR antigo sem campanha segue o telefone)", () => {
  const events = [
    { id: "1", phone_normalized: "+5514911111111", event: "sent", campaign_id: "team" },
    { id: "2", phone_normalized: "+5514922222222", event: "sent", campaign_id: "brokerA" },
    { id: "3", phone_normalized: "+5514922222222", event: "opt_out", campaign_id: null },
    { id: "4", phone_normalized: "+5514933333333", event: "sent", campaign_id: "brokerB" }
  ];
  const team = scopeSmsEvents(events, { mode: "team", brokerCampaignIds: ["brokerA", "brokerB"] });
  assert.deepEqual(team.map((row) => row.id), ["1"]);
  const brokerA = scopeSmsEvents(events, { mode: "campaign", campaignId: "brokerA" });
  assert.deepEqual(brokerA.map((row) => row.id), ["2", "3"]);
  assert.deepEqual(scopeSmsEvents(events, { mode: "campaign", campaignId: "brokerC" }), []);
});

test("atribuição direta: campanha SMS com corretor fixo -> responsável = corretor, sem roleta nem REDISTRIBUIÇÃO; origem e tag mantidas", () => {
  const smsBroker = { id: "camp", name: "SMS - Lote da base", destinationType: "broker", brokerId: "b1", status: "active", brokerName: "Caroline Mayumi" };
  assert.equal(isSmsBrokerCampaign(smsBroker), true);
  assert.equal(isSmsBrokerCampaign({ ...smsBroker, destinationType: "roulette", brokerId: "" }), false, "o lote da equipe segue pela roleta");
  assert.equal(isSmsBrokerCampaign({ ...smsBroker, name: "Outra campanha" }), false);
  assert.equal(isSmsBrokerCampaign({ ...smsBroker, status: "inactive" }), false);
  assert.equal(isSmsBrokerCampaign(null), false);

  const source = read("lib/simulation-registrations.js");
  const resolver = source.slice(source.indexOf("async function resolveExternalLinkAssignment"), source.indexOf("// Cliente do anúncio de WhatsApp \"segurado\""));
  // Campanha ativa com corretor fixo: só o responsável é definido — nada de assignRoundRobinLead nem distribution_type.
  assert.match(resolver, /campaign\.destinationType === CAMPAIGN_DESTINATION\.BROKER\) \{\n    responsibleUserId = campaign\.brokerId;\n  \} else if \(isActiveCampaign\) \{\n    const roulette = await assignRoundRobinLead/);
  assert.match(resolver, /const smsBrokerLink = isActiveCampaign && isSmsBrokerCampaign\(campaign\)/);
  // Cliente que já existe com outro responsável: nunca reatribui nem abre atendimento novo (isDirectBrokerLink segue falso).
  assert.match(source, /directBrokerLink: isDirectBrokerLink \|\| assignment\.smsBrokerLink/);
  assert.equal((source.match(/directBrokerLink: isDirectBrokerLink \|\| assignment\.smsBrokerLink/g) || []).length, 2);
  assert.equal((source.match(/recordSmsBrokerOriginSafe\(\{ campaign, clientId: existing\.id, existing: true/g) || []).length, 2);
  assert.match(source, /await addTagToClient\(registration\.id, campaign\.name\)/);
  // REDISTRIBUIÇÃO só pega distribution_type = round_robin (que o link do corretor nunca grava).
  const automations = read("lib/crm-automations.js");
  assert.match(automations, /if \(client\.distribution_type !== "round_robin"\) return;/);
});

test("linha do tempo: \"Veio por SMS do corretor X\" no cadastro novo e registro de que o atendimento existente foi mantido", () => {
  const lib = read("lib/sms-batch.js");
  assert.match(lib, /`Veio por SMS do corretor \$\{name\}\.`/);
  assert.match(lib, /o atendimento atual foi mantido \(sem reatribuir\)/);
  const labels = read("lib/journey-event-labels.mjs");
  assert.match(labels, /case "sms_broker_origin":/);
});

test("a simulação automática NÃO muda: o roteamento (nonOfficialSender/closedWindowRoute) não conhece o Lote de SMS (dono, 2026-11-02: deixe no pessoal)", () => {
  const core = read("lib/simulation-auto-send-core.mjs");
  const sender = read("lib/simulation-auto-send.js");
  assert.doesNotMatch(core, /sms/i);
  assert.doesNotMatch(sender, /sms-batch|sms_broker|smsBroker/i);
  // O cliente do SMS do corretor entra como cliente do link do corretor, que a regra de sempre já manda pelo WhatsApp dele.
  assert.match(core, /direct_broker_link === true/);
});
