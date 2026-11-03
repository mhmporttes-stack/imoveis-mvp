import assert from "node:assert/strict";
import test from "node:test";
import { SMS_TOKEN_PATTERN, buildSmsTokenLink, cleanSmsToken, currentSmsToken, readStoredSmsToken, serializeSmsTokenCookie, smsTokenMetadata } from "../lib/sms-batch-token-core.mjs";
import { linkSmsRegistration, listSmsClickers, listSmsLinksByRegistration, recordSmsLink, recordSmsLinkClick, smsTokenForContact } from "../lib/sms-batch-links.mjs";
import { buildLeadOrigin } from "../lib/lead-origin.js";

// Banco falso mínimo (uma tabela): encadeia filtros e aplica no await.
function fakeDb({ rows = [], missing = false, failWith = null } = {}) {
  const table = rows.map((row) => ({ ...row }));
  const calls = [];
  const client = {
    table,
    calls,
    from() {
      const state = { op: "select", filters: [], patch: null, insert: null, want: false, single: false };
      const builder = {
        select() { state.want = true; return builder; },
        insert(row) { state.op = "insert"; state.insert = row; return builder; },
        update(patch) { state.op = "update"; state.patch = patch; return builder; },
        eq(column, value) { state.filters.push((r) => r[column] === value); return builder; },
        is(column, value) { state.filters.push((r) => (r[column] ?? null) === value); return builder; },
        gt(column, value) { state.filters.push((r) => r[column] > value); return builder; },
        in(column, values) { state.filters.push((r) => values.includes(r[column])); return builder; },
        order() { return builder; },
        range() { return builder; },
        maybeSingle() { state.single = true; return builder; },
        then(resolve, reject) {
          calls.push(state.op);
          if (missing) return Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } }).then(resolve, reject);
          if (failWith) return Promise.resolve({ data: null, error: failWith }).then(resolve, reject);
          const match = table.filter((r) => state.filters.every((f) => f(r)));
          let data = null;
          if (state.op === "insert") { table.push({ click_count: 0, first_clicked_at: null, last_clicked_at: null, registration_id: null, registered_at: null, ...state.insert }); }
          else if (state.op === "update") { match.forEach((r) => Object.assign(r, state.patch)); data = state.want ? match.map((r) => ({ token: r.token })) : null; }
          else data = state.single ? (match[0] || null) : match;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  return client;
}

const CONTACT = "6b1c2f0e-1111-4222-8333-444455556666";
const SECRET = "segredo-de-teste";

test("token: determinístico, 10 caracteres base32, sem dado pessoal e diferente por contato", () => {
  const a = smsTokenForContact(CONTACT, SECRET);
  assert.match(a, SMS_TOKEN_PATTERN);
  assert.equal(a, smsTokenForContact(CONTACT, SECRET));
  assert.notEqual(a, smsTokenForContact("outro-contato", SECRET));
  assert.notEqual(a, smsTokenForContact(CONTACT, "outro-segredo"));
  assert.equal(a.includes(CONTACT.slice(0, 4)) && a.includes("5555"), false);
  assert.equal(smsTokenForContact("", SECRET), "");
  assert.equal(smsTokenForContact(CONTACT, ""), "");
});

test("token: validação aceita só o formato certo (e normaliza maiúsculas)", () => {
  assert.equal(cleanSmsToken("abcdefg234"), "abcdefg234");
  assert.equal(cleanSmsToken(" ABCDEFG234 "), "abcdefg234");
  for (const bad of ["", "abc", "abcdefg2341", "abcdefg23!", "abcdefg018", "../../etc/p", null, undefined, "abcdefg234\n<script>"]) assert.equal(cleanSmsToken(bad), "");
});

test("link: curto ganha ?t=, longo ganha &sms_t=, sem token fica como está", () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  assert.equal(buildSmsTokenLink("https://www.matheusmachadoimoveis.com.br/c/9921e29", token), `https://www.matheusmachadoimoveis.com.br/c/9921e29?t=${token}`);
  assert.equal(buildSmsTokenLink("https://x.com.br/simulacao?c=abc", token), `https://x.com.br/simulacao?c=abc&sms_t=${token}`);
  assert.equal(buildSmsTokenLink("https://x.com.br/c/9921e29", ""), "https://x.com.br/c/9921e29");
  assert.equal(buildSmsTokenLink("https://x.com.br/c/9921e29", "inválido"), "https://x.com.br/c/9921e29");
  assert.equal(buildSmsTokenLink("", token), "");
});

test("cookie do token: leitura, escrita e URL de agora com prioridade", () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  const cookie = serializeSmsTokenCookie(token, { secure: true });
  assert.match(cookie, /^mm_sms_t=[a-z2-7]{10}; Max-Age=2592000; Path=\/; SameSite=Lax; Secure$/);
  assert.equal(readStoredSmsToken(`a=1; mm_sms_t=${token}; b=2`), token);
  assert.equal(readStoredSmsToken("mm_sms_t=lixo"), "");
  assert.equal(currentSmsToken(new URLSearchParams({ sms_t: token })), token);
  assert.equal(currentSmsToken(new URLSearchParams({ sms_t: "ruim" })), "");
});

test("cadastro: sms_token entra em source_metadata só com token válido e campanha, sem mudar kind/label", () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  const campaign = { id: "c1", name: "SMS - Lote da base" };
  const withToken = buildLeadOrigin({ campaign, attribution: { sms_t: token } });
  const without = buildLeadOrigin({ campaign, attribution: {} });
  assert.equal(withToken.metadata.sms_token, token);
  assert.equal(without.metadata.sms_token, undefined);
  assert.equal(withToken.kind, without.kind);
  assert.equal(withToken.label, without.label);
  assert.equal(buildLeadOrigin({ campaign, attribution: { sms_t: "lixo" } }).metadata.sms_token, undefined);
  assert.equal(buildLeadOrigin({ attribution: { sms_t: token } }).metadata.sms_token, undefined);
  assert.deepEqual(smsTokenMetadata({ sms_t: token }), { sms_token: token });
});

test("envio gravado cria a linha do token (idempotente) e não mexe em cliques", async () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  const db = fakeDb();
  const input = { token, contactId: CONTACT, phone: "+5514999990000", campaignId: "camp1", sentBy: "u1" };
  assert.equal((await recordSmsLink(db, input)).status, "created");
  assert.equal((await recordSmsLink(db, input)).status, "kept");
  assert.equal(db.table.length, 1);
  await recordSmsLinkClick(db, token);
  assert.equal((await recordSmsLink(db, { ...input, campaignId: "camp2" })).status, "updated");
  assert.equal(db.table[0].campaign_id, "camp2");
  assert.equal(db.table[0].click_count, 1);
});

test("token de OUTRO contato (colisão) nunca é sobrescrito", async () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  const db = fakeDb({ rows: [{ token, contact_id: "outro", phone_normalized: "x", campaign_id: "c", sent_by: null }] });
  assert.equal((await recordSmsLink(db, { token, contactId: CONTACT, phone: "+55", campaignId: "c" })).status, "collision");
  assert.equal(db.table[0].contact_id, "outro");
});

test("clique: soma, guarda primeiro/último e ignora token inválido ou desconhecido", async () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  const db = fakeDb({ rows: [{ token, contact_id: CONTACT, phone_normalized: "+55", campaign_id: "c", click_count: 0, first_clicked_at: null, last_clicked_at: null }] });
  const t1 = new Date("2026-11-03T12:00:00Z");
  const t2 = new Date("2026-11-03T13:00:00Z");
  assert.deepEqual(await recordSmsLinkClick(db, token, t1), { counted: true, clickCount: 1 });
  assert.deepEqual(await recordSmsLinkClick(db, token.toUpperCase(), t2), { counted: true, clickCount: 2 });
  assert.equal(db.table[0].first_clicked_at, t1.toISOString());
  assert.equal(db.table[0].last_clicked_at, t2.toISOString());
  assert.deepEqual(await recordSmsLinkClick(db, "invalido"), { counted: false });
  assert.deepEqual(await recordSmsLinkClick(db, "aaaaaaaaaa"), { counted: false });
  assert.equal(db.table[0].click_count, 2);
});

test("cadastro liga o cliente ao token só na primeira vez e só pela mesma campanha", async () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  const db = fakeDb({ rows: [{ token, contact_id: CONTACT, phone_normalized: "+55", campaign_id: "camp1", registration_id: null }] });
  assert.deepEqual(await linkSmsRegistration(db, token, "cli1", new Date(), "outra"), { linked: false });
  assert.deepEqual(await linkSmsRegistration(db, token, "cli1", new Date(), "camp1"), { linked: true });
  assert.deepEqual(await linkSmsRegistration(db, token, "cli2", new Date(), "camp1"), { linked: false });
  assert.equal(db.table[0].registration_id, "cli1");
  assert.ok(db.table[0].registered_at);
  const byClient = await listSmsLinksByRegistration(db, ["cli1"]);
  assert.equal(byClient.get("cli1").contact_id, CONTACT);
});

test("quem clicou: só linhas com clique nas campanhas pedidas", async () => {
  const db = fakeDb({ rows: [
    { token: "aaaaaaaaaa", campaign_id: "c1", click_count: 2 },
    { token: "bbbbbbbbbb", campaign_id: "c1", click_count: 0 },
    { token: "cccccccccc", campaign_id: "c2", click_count: 1 }
  ] });
  assert.deepEqual((await listSmsClickers(db, ["c1"])).map((row) => row.token), ["aaaaaaaaaa"]);
  assert.deepEqual(await listSmsClickers(db, []), []);
});

test("sem a tabela (migration pendente): tudo vira 'nada a fazer', sem erro", async () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  const db = fakeDb({ missing: true });
  assert.equal((await recordSmsLink(db, { token, contactId: CONTACT, phone: "+55", campaignId: "c" })).status, "skipped");
  assert.deepEqual(await recordSmsLinkClick(db, token), { counted: false });
  assert.deepEqual(await linkSmsRegistration(db, token, "cli1"), { linked: false });
  assert.deepEqual(await listSmsClickers(db, ["c1"]), []);
  assert.equal((await listSmsLinksByRegistration(db, ["cli1"])).size, 0);
});

test("outro erro do banco NÃO é engolido", async () => {
  const token = smsTokenForContact(CONTACT, SECRET);
  const db = fakeDb({ failWith: { code: "XX000", message: "falha real" } });
  await assert.rejects(() => recordSmsLinkClick(db, token), { code: "XX000" });
  await assert.rejects(() => listSmsClickers(db, ["c1"]), { code: "XX000" });
});
