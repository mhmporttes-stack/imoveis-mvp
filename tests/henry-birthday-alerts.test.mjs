import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BIRTHDAY_ALERT_STEP,
  birthdayConfirmDetail,
  birthdayConfirmReply,
  birthdayEventKey,
  birthdayNoticeDedupeKey,
  birthdayNoticeResultText,
  buildBirthdayEvents,
  buildBirthdayNoticeDeliveries,
  composeHenryBirthdayAlert,
  henryBirthdayAlertsFromSetting,
  ownBirthdayDraft
} from "../lib/henry-birthday-alerts-core.mjs";
import { alertDisplayItems } from "../lib/henry-voice-client-alerts-core.mjs";
import { MORNING_STEPS, classifyYesNo, parseMorningState } from "../lib/henry-morning-core.mjs";
import { HENRY_REPEAT_QUESTIONS } from "../lib/henry-voice-conversation.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";

// Henry avisa aniversariante do dia (HENRY-1, REGRA OFICIAL — dono, 2026-10-24): "a cliente Bruna, atribuída ao Gabriel, faz
// aniversário hoje. Quer que eu envie uma mensagem para o Gabriel avisando? Se for meu: quer que eu prepare uma mensagem para
// você enviar?"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const DAY = "2026-10-24";
const OWNER = "owner";
const users = new Map([
  ["g", { id: "g", name: "Gabriel Lima", gender: "male", status: "active" }],
  ["c", { id: "c", name: "Carolina Souza", gender: "female", status: "active" }],
  ["x", { id: "x", name: "Xavier", gender: "male", status: "inactive" }]
]);
const row = (id, name, receiver, extra = {}) => ({ id, full_name: name, oldest_birth_date: "1990-10-24", status: "in_service", private_contact_at: null, responsible_user_id: receiver, phone: "14999990000", ...extra });
const events = (rows) => buildBirthdayEvents({ rows, users, ownerId: OWNER, dateKey: DAY });

test("quem entra: aniversário de hoje (regra da Agenda), com responsável ativo ou o dono; nunca Não contactar/arquivado/Particular", () => {
  const list = events([
    row("1", "Bruna Souza", "g"),
    row("2", "João Silva", OWNER),
    row("3", "Ana Arquivada", "c", { status: "archived" }),
    row("4", "Pedro Bloqueado", "c", { status: "do_not_contact" }),
    row("5", "Rita Particular", "c", { private_contact_at: "2026-10-01T00:00:00Z" }),
    row("6", "Sem Responsavel", null),
    row("7", "Cliente do Inativo", "x"),
    row("8", "Sem Data", "g", { oldest_birth_date: "1900-10-24" }),
    row("9", "Outro Dia", "g", { oldest_birth_date: "1990-10-25" }),
    row("10", "Bruna Souza", "g") // mesma pessoa repetida no mesmo corretor
  ]);
  assert.deepEqual(list.map((event) => event.clientId), ["1", "2"]);
  assert.equal(list[1].own, true);
  assert.equal(birthdayEventKey(list[0]), "birthday:1:2026-10-24");
  // 29/02 em ano não bissexto cai em 28/02 (mesma isBirthdayOn da Agenda/Alexa)
  assert.equal(buildBirthdayEvents({ rows: [row("l", "Leap", "g", { oldest_birth_date: "2000-02-29" })], users, ownerId: OWNER, dateKey: "2027-02-28" }).length, 1);
});

test("fala: o modelo do dono, gênero do cliente pelo primeiro nome e do corretor pelo cadastro", () => {
  const [bruna, joao] = events([row("1", "Bruna Souza", "g"), row("2", "João Silva", OWNER)]);
  const one = composeHenryBirthdayAlert([bruna], { users });
  assert.equal(one.text, "A cliente Bruna, atribuída ao Gabriel, faz aniversário hoje. Quer que eu envie uma mensagem para o Gabriel avisando?");
  assert.equal(one.ask, true);
  const [pedro] = events([row("p", "Pedro Alves", "c")]);
  assert.equal(composeHenryBirthdayAlert([pedro], { users }).text, "O cliente Pedro, atribuído à Carolina, faz aniversário hoje. Quer que eu envie uma mensagem para a Carolina avisando?");
  assert.equal(composeHenryBirthdayAlert([joao], { users }).text, "O cliente João, que é seu, faz aniversário hoje. Quer que eu prepare uma mensagem para você enviar?");
  const [kim] = events([row("k", "Kim Wu", "g")]); // nome fora da lista = frase neutra
  assert.equal(composeHenryBirthdayAlert([kim], { users }).text, "Kim, cliente do Gabriel, faz aniversário hoje. Quer que eu envie uma mensagem para o Gabriel avisando?");
  const mixed = composeHenryBirthdayAlert([bruna, joao, pedro], { users });
  assert.equal(mixed.text, "Hoje tem 3 aniversariantes: Bruna, do Gabriel, João, que é seu e Pedro, da Carolina. Quer que eu avise os corretores e prepare a sua mensagem para você enviar?");
  for (const text of [one.text, mixed.text]) assert.ok(isSafeToSpeak(text));
  assert.deepEqual(composeHenryBirthdayAlert([], { users }), { text: "", ask: false });
});

test("vários: resumo com até 4 nomes e 'mais N'", () => {
  const many = events(["Ana", "Bruna", "Carla", "Daniela", "Eduarda", "Fabiana"].map((name, index) => row(`m${index}`, `${name} Silva`, "g")));
  const { text } = composeHenryBirthdayAlert(many, { users });
  assert.match(text, /^Hoje tem 6 aniversariantes: Ana, do Gabriel, .* e mais 2\. Quer que eu envie uma mensagem para o Gabriel avisando\?$/);
});

test("aviso ao corretor: INTERNO (Central Informativo + push henry_birthday), 1 por cliente por dia, nunca para cliente do dono", () => {
  const list = events([row("1", "Bruna Souza", "g"), row("2", "João Silva", OWNER)]);
  const rows = buildBirthdayNoticeDeliveries(list, { sentBy: OWNER, pushKind: "henry_birthday" });
  assert.equal(rows.length, 1);
  const [delivery] = rows;
  assert.equal(delivery.recipient_id, "g");
  assert.equal(delivery.kind, "informative");
  assert.equal(delivery.dedupe_key, birthdayNoticeDedupeKey("1", DAY));
  assert.equal(delivery.dedupe_key, "henry_birthday:1:2026-10-24");
  assert.equal(delivery.context.push_kind, "henry_birthday");
  assert.equal(delivery.context.sent_by, OWNER);
  assert.equal(delivery.context.client_id, "1");
  assert.match(delivery.body, /Bruna Souza/);
  assert.doesNotMatch(JSON.stringify(delivery), /\d{10,}/); // sem telefone
});

test("depois do 'sim': confirmação na tela (envio só pelo botão) e rascunho do cliente do dono com copiar/WhatsApp", () => {
  const list = events([row("1", "Bruna Souza", "g"), row("2", "João Silva", OWNER)]);
  const detail = birthdayConfirmDetail(list, { users, signature: "Matheus" });
  assert.deepEqual(detail.confirm.clientIds, ["1"]);
  assert.equal(detail.confirm.label, "Enviar aviso para o Gabriel");
  assert.match(detail.confirm.note, /Nada vai ao cliente/);
  const own = detail.sections.find((section) => section.title === "Sua mensagem").rows[0];
  assert.match(own.note, /^Feliz aniversário, João!/);
  assert.deepEqual(own.actions.map((action) => action.kind), ["copy", "link"]);
  assert.match(own.actions[1].href, /^https:\/\/wa\.me\/5514999990000\?text=Feliz/);
  assert.equal(birthdayConfirmReply(list, { users }), "Deixei o aviso para o Gabriel na tela. É só confirmar que eu envio. A sua mensagem está na tela, pra copiar ou abrir no WhatsApp.");
  // já avisado hoje: sem botão, e a fala diz que já saiu
  const notified = new Set(["1"]);
  assert.equal(birthdayConfirmDetail(list, { users, notified }).confirm, undefined);
  assert.match(birthdayConfirmReply(list, { users, notified }), /^O aviso para o Gabriel já saiu hoje\./);
  // telefone inválido: só copiar
  assert.equal(ownBirthdayDraft({ clientName: "João Silva", phone: "123" }).whatsappUrl, "");
  assert.equal(birthdayNoticeResultText({ sent: ["o Gabriel"], already: ["a Carolina"] }), "Pronto, avisei o Gabriel. O aviso para a Carolina já tinha saído hoje.");
});

test("liga/desliga nasce ligado; pergunta usa o passo do bom dia; 'sim'/'avisa' = sim", () => {
  assert.equal(henryBirthdayAlertsFromSetting({}), true);
  assert.equal(henryBirthdayAlertsFromSetting({ birthdayAlerts: false }), false);
  assert.ok(MORNING_STEPS.includes(BIRTHDAY_ALERT_STEP));
  assert.deepEqual(parseMorningState({ step: BIRTHDAY_ALERT_STEP }), { step: "birthday_alert" });
  for (const answer of ["sim", "pode avisar", "avisa ele", "manda"]) assert.equal(classifyYesNo(answer), "yes", answer);
  assert.equal(classifyYesNo("não, deixa"), "no");
  assert.equal(typeof HENRY_REPEAT_QUESTIONS.birthday_alert, "string");
  const items = alertDisplayItems({ birthdayText: "A cliente Bruna, atribuída ao Gabriel, faz aniversário hoje." });
  assert.equal(items[0].kicker, "Aniversário");
});

test("fiação: aniversário fora dos clientIds do aviso de cliente novo; pergunta abre a escuta; envio só com confirmação", () => {
  const view = read("../components/henry/HenryVoiceAssistant.jsx");
  assert.match(view, /clientIds: pending\.filter\(\(item\) => item\.clientId && item\.kind !== "birthday"\)/);
  assert.match(view, /birthdayIds: pending\.filter\(\(item\) => item\.kind === "birthday"/);
  assert.match(view, /data\.ask\?\.step === "birthday_alert"/);
  assert.match(view, /mode: "birthday_notice", clientIds: confirm\.clientIds/);
  const panel = read("../components/henry/HenrySearchScene.jsx");
  assert.match(panel, /function HenryConfirmBlock/);
  const route = read("../app/api/admin/henry/route.js");
  assert.match(route, /if \(body\?\.mode === "birthday_notice"\) \{[\s\S]*resolveHenryLock[\s\S]*sendHenryBirthdayNotices/);
  const alerts = read("../lib/henry-voice-client-alerts.js");
  assert.match(alerts, /composeHenryBirthdayAlert\(birthdayData\.events/);
});
