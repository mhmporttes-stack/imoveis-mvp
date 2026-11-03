// Formulário curto do link do SMS (dono, 2026-11-03, PRO-18h): perguntas puladas, privacidade (só 1º nome + telefone
// mascarado no navegador), servidor completa nome/telefone, e a mensagem final do WhatsApp com saudação e nome.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completeSmsContactPayload, needsSmsContact, smsContactFullName, smsContactView } from "../lib/sms-batch-contact-core.mjs";
import { readSmsContact } from "../lib/sms-batch-links.mjs";
import { CONFIRM_CONTACT_PHONE_STEP_ID, USE_OTHER_PHONE, applySmsContactSteps, phoneConfirmError } from "../lib/sms-short-form-steps.mjs";
import { FORM_COMPLETION_MESSAGE, FORM_COMPLETION_PHRASES, buildFormCompletionMessage, filterFlowsForPostFormContact, isFormCompletionFlowTrigger, isFormCompletionMessage } from "../lib/whatsapp-form-completion.mjs";
import { buildReceiveSimulationWhatsappUrl, resolveFormWhatsappRedirect } from "../lib/receive-simulation-contact.mjs";
import { contactCodeFor, extractContactCode, hasContactCodeMarker, withContactCode } from "../lib/whatsapp-contact-code-core.mjs";
import { normalizeForKeyword } from "../lib/whatsapp-keyword-match.mjs";
import { getTimeGreeting } from "../lib/daily-report-range.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TOKEN = "abcdefg234";
const CONTACT = { name: "Maria Aparecida de Souza", phone: "+5514998123456" };
// Perguntas de base (a lista real é montada por buildRegistrationSteps, lib/simulation-registration-format.js, que passa por aqui).
const BASE = [{ id: "simulationType", kind: "choice" }, { id: "fullName", kind: "text" }, { id: "phone", kind: "phone" }, { id: "oldestBirthDate", kind: "date" }];
const buildRegistrationSteps = (_values, { smsContact = null, otherPhone = false } = {}) => applySmsContactSteps(BASE, smsContact, otherPhone);
const validateStepValue = (step, values) => phoneConfirmError(values[step.id]);
const REG_ID = "1a2b3c4d-0000-4000-8000-000000000000";
// São Paulo = UTC-3: 09h = Bom dia; 13h = Boa tarde; 21h = Boa noite.
const MORNING = new Date("2026-11-03T12:00:00Z");
const AFTERNOON = new Date("2026-11-03T16:00:00Z");
const NIGHT = new Date("2026-11-04T00:00:00Z");

// ---------- visão do navegador (privacidade) ----------

test("navegador recebe só o 1º nome e o telefone mascarado — nunca sobrenome nem número inteiro", () => {
  const view = smsContactView(CONTACT);
  assert.deepEqual(view, { firstName: "Maria", phoneMasked: "(14) 9****-3456" });
  const json = JSON.stringify(view);
  assert.ok(!json.includes("Souza") && !json.includes("Aparecida"));
  assert.ok(!json.includes("998123456") && !json.includes("5514"));
});

test("sem nome confiável (placeholder, 1 letra, número) ou sem contato: nada é devolvido", () => {
  for (const name of ["", "Cliente", "Cliente WhatsApp", "J.", "12345", "Sem nome", null]) assert.equal(smsContactView({ name, phone: CONTACT.phone }), null, String(name));
  assert.equal(smsContactView(null), null);
  assert.equal(smsContactView(undefined), null);
});

test("telefone da base inválido: sem máscara (a tela cai no campo de telefone normal)", () => {
  assert.deepEqual(smsContactView({ name: "Maria", phone: "123" }), { firstName: "Maria", phoneMasked: "" });
});

// ---------- perguntas do formulário ----------

test("sem token/contato: as perguntas são exatamente as de sempre", () => {
  const base = buildRegistrationSteps({}).map((step) => step.id);
  assert.deepEqual(buildRegistrationSteps({}, { smsContact: null }).map((step) => step.id), base);
  assert.deepEqual(buildRegistrationSteps({}, { smsContact: { firstName: "" } }).map((step) => step.id), base);
  assert.ok(base.includes("fullName") && base.includes("phone"));
});

test("buildRegistrationSteps/validateStepValue usam esse módulo (fonte única das perguntas do formulário curto)", () => {
  const format = read("lib/simulation-registration-format.js");
  assert.match(format, /return applySmsContactSteps\(buildAllRegistrationSteps\(values\), smsContact, otherPhone\)/);
  assert.match(format, /step\.kind === "phoneConfirm"\) return phoneConfirmError\(value\)/);
  const form = read("components/simulation-form/SimulationForm.jsx");
  assert.match(form, /buildRegistrationSteps\(form, stepOptions\)/);
  assert.match(form, /buildRegistrationSteps\(nextForm, stepOptions\)/);
});

test("com contato: pula o nome e troca o telefone por 'Seu WhatsApp é (14) 9****-3456?' (Confirmar / Usar outro número)", () => {
  const contact = smsContactView(CONTACT);
  const steps = buildRegistrationSteps({}, { smsContact: contact });
  const ids = steps.map((step) => step.id);
  assert.ok(!ids.includes("fullName") && !ids.includes("phone"));
  const confirm = steps.find((step) => step.id === CONFIRM_CONTACT_PHONE_STEP_ID);
  assert.equal(confirm.title, "Seu WhatsApp é (14) 9****-3456?");
  assert.deepEqual(confirm.options.map((option) => option.label), ["Confirmar", "Usar outro número"]);
  assert.equal(ids[0], "simulationType");
  assert.equal(ids[1], CONFIRM_CONTACT_PHONE_STEP_ID, "o telefone fica no lugar em que estava");
  assert.equal(ids.length, BASE.length - 1, "uma pergunta a menos (o nome)");
  assert.equal(validateStepValue(confirm, { [CONFIRM_CONTACT_PHONE_STEP_ID]: true }), "");
  assert.notEqual(validateStepValue(confirm, { [CONFIRM_CONTACT_PHONE_STEP_ID]: USE_OTHER_PHONE }), "");
  assert.notEqual(validateStepValue(confirm, {}), "");
});

test("'Usar outro número' (ou telefone da base sem máscara): campo de telefone normal, sem a pergunta do nome", () => {
  const contact = smsContactView(CONTACT);
  const other = buildRegistrationSteps({}, { smsContact: contact, otherPhone: true });
  assert.ok(other.some((step) => step.id === "phone" && step.kind === "phone"));
  assert.ok(!other.some((step) => step.id === "fullName" || step.id === CONFIRM_CONTACT_PHONE_STEP_ID));
  const noMask = buildRegistrationSteps({}, { smsContact: { firstName: "Maria", phoneMasked: "" } });
  assert.ok(noMask.some((step) => step.id === "phone" && step.kind === "phone"));
});

// ---------- servidor completa nome e telefone ----------

test("confirmar: o SERVIDOR usa o telefone do contato; nome vem da base", () => {
  const out = completeSmsContactPayload({ fullName: "", phone: "", confirmContactPhone: true, attribution: { sms_t: TOKEN } }, CONTACT);
  assert.equal(out.fullName, "Maria Aparecida de Souza");
  assert.equal(out.phone, "+5514998123456");
  assert.ok(!("confirmContactPhone" in out));
});

test("trocar de número: o digitado vale (nunca é sobrescrito) e passa pela validação de sempre", () => {
  const out = completeSmsContactPayload({ fullName: "", phone: "(11) 91234-5678", confirmContactPhone: true, attribution: { sms_t: TOKEN } }, CONTACT);
  assert.equal(out.phone, "(11) 91234-5678");
  assert.equal(out.fullName, "Maria Aparecida de Souza");
});

test("sem 'Confirmar' o telefone NÃO é completado (o cliente nunca aprova o que não viu)", () => {
  const out = completeSmsContactPayload({ fullName: "", phone: "", attribution: { sms_t: TOKEN } }, CONTACT);
  assert.equal(out.phone, "");
  const wrongFlag = completeSmsContactPayload({ fullName: "", phone: "", confirmContactPhone: "true" }, CONTACT);
  assert.equal(wrongFlag.phone, "");
});

test("nome digitado vale; nome da base inutilizável não é inventado", () => {
  assert.equal(completeSmsContactPayload({ fullName: "Joana Lima", phone: "" }, CONTACT).fullName, "Joana Lima");
  assert.equal(completeSmsContactPayload({ fullName: "", phone: "" }, { name: "Cliente", phone: CONTACT.phone }).fullName, "");
  assert.equal(smsContactFullName("A"), "");
  assert.equal(smsContactFullName("  Maria  "), "Maria");
});

test("telefone da base inválido nunca é confirmado", () => {
  const out = completeSmsContactPayload({ fullName: "", phone: "", confirmContactPhone: true }, { name: "Maria", phone: "123" });
  assert.equal(out.phone, "");
});

test("sem token / token que não resolve: payload IDÊNTICO ao de hoje", () => {
  const payload = { fullName: "", phone: "", confirmContactPhone: true, attribution: { sms_t: TOKEN } };
  assert.equal(completeSmsContactPayload(payload, null), payload);
  const normal = { fullName: "Ana Paula", phone: "(14) 99999-0000", attribution: {} };
  assert.equal(needsSmsContact(normal), false);
  assert.equal(needsSmsContact({ ...normal, attribution: { sms_t: "token-ruim" } }), false);
  assert.equal(needsSmsContact({ fullName: "", phone: "", attribution: { sms_t: "TOKEN-RUIM!" } }), false);
  assert.equal(needsSmsContact({ ...normal, attribution: { sms_t: TOKEN } }), false, "nada a completar: não consulta o banco");
  assert.equal(needsSmsContact({ fullName: "", phone: "", attribution: { sms_t: TOKEN } }), true);
  assert.equal(needsSmsContact(null), false);
});

test("cadastro: createSimulationRegistration completa ANTES da validação; a rota pública só devolve a visão mascarada", () => {
  const source = read("lib/simulation-registrations.js");
  const create = source.slice(source.indexOf("export async function createSimulationRegistration"), source.indexOf("const totalIncome"));
  assert.ok(create.indexOf("completeSmsContactPayload") > -1 && create.indexOf("completeSmsContactPayload") < create.indexOf("validateSimulationRegistration(payload)"));
  assert.match(create, /needsSmsContact\(rawPayload\)/);
  const route = read("app/api/campaigns/track-view/route.js");
  assert.match(route, /smsContactView\(await resolveSmsContact\(payload\.smsToken\)\)/);
  assert.ok(!/phone_normalized|full_name/.test(route.replace(/\/\/.*$/gm, "")));
});

// ---------- leitura do contato (banco falso) ----------

function fakeClient({ link, contact, missing = false }) {
  return {
    from(table) {
      const result = table === "sms_batch_links"
        ? (missing ? { data: null, error: { code: "42P01", message: "x" } } : { data: link ?? null, error: null })
        : { data: contact ?? null, error: null };
      const builder = { select: () => builder, eq: () => builder, maybeSingle: () => builder, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
      return builder;
    }
  };
}

test("readSmsContact: token → contato (nome da base + telefone do SMS); inválido, desconhecido e tabela ausente → null", async () => {
  const client = fakeClient({ link: { contact_id: "c1", phone_normalized: "+5514998123456" }, contact: { name: "Maria Souza" } });
  assert.deepEqual(await readSmsContact(client, TOKEN), { name: "Maria Souza", phone: "+5514998123456" });
  assert.equal(await readSmsContact(client, "ruim"), null);
  assert.equal(await readSmsContact(fakeClient({ link: null }), TOKEN), null);
  assert.equal(await readSmsContact(fakeClient({ link: { contact_id: "c1", phone_normalized: "+55" }, contact: null }), TOKEN), null);
  assert.equal(await readSmsContact(fakeClient({ missing: true }), TOKEN), null);
});

// ---------- mensagem final do WhatsApp ----------

test("sem nome conhecido: texto de hoje, intacto", () => {
  assert.equal(buildFormCompletionMessage({}), FORM_COMPLETION_MESSAGE);
  assert.equal(buildFormCompletionMessage({ firstName: "" }), FORM_COMPLETION_MESSAGE);
  assert.equal(buildFormCompletionMessage({ firstName: "Cliente" }), FORM_COMPLETION_MESSAGE);
  assert.equal(buildFormCompletionMessage({ firstName: "12345" }), FORM_COMPLETION_MESSAGE);
  assert.equal(FORM_COMPLETION_MESSAGE, "Olá, preenchi meu cadastro. Gostaria de receber a minha simulação.");
});

test("com nome: saudação por horário (getTimeGreeting) + nome + 'Só para reforçar'", () => {
  assert.equal(buildFormCompletionMessage({ firstName: "Maria", now: MORNING }), "Bom dia, meu nome é Maria. Só para reforçar: preenchi meu cadastro e gostaria de receber a minha simulação.");
  assert.equal(buildFormCompletionMessage({ firstName: "Maria", now: AFTERNOON }), "Boa tarde, meu nome é Maria. Só para reforçar: preenchi meu cadastro e gostaria de receber a minha simulação.");
  assert.equal(buildFormCompletionMessage({ firstName: "MARIA", now: NIGHT }), "Boa noite, meu nome é Maria. Só para reforçar: preenchi meu cadastro e gostaria de receber a minha simulação.");
  for (const now of [MORNING, AFTERNOON, NIGHT]) assert.ok(buildFormCompletionMessage({ firstName: "Maria", now }).startsWith(getTimeGreeting(now)));
});

test("a saudação vem da fonte única (reexportada por lib/daily-report.js) — sem cópia", () => {
  assert.match(read("lib/daily-report.js"), /export \{ getTimeGreeting \} from "\.\/daily-report-range\.mjs"/);
  assert.ok(!/formatToParts/.test(read("lib/whatsapp-form-completion.mjs")));
  assert.equal((read("lib/daily-report-range.mjs").match(/export function getTimeGreeting/g) || []).length, 1);
});

test("o novo texto continua casando com TODAS as frases e com o fluxo 'Formulário concluído'", () => {
  for (const now of [MORNING, AFTERNOON, NIGHT]) {
    const text = withContactCode(buildFormCompletionMessage({ firstName: "Maria", now }), REG_ID);
    assert.equal(isFormCompletionMessage(text), true, text);
    const normalized = normalizeForKeyword(text);
    for (const phrase of FORM_COMPLETION_PHRASES) {
      if (phrase === "receber minha simulacao") continue; // variante curta, de quem digita à mão
      assert.ok(normalized.includes(phrase), `${phrase} em: ${normalized}`);
    }
    const dedicated = { name: "Formulário concluído", published_trigger: { type: "keyword", keywords: ["preenchi meu cadastro", "receber a minha simulação", "receber minha simulação"], match: "contains" } };
    assert.equal(isFormCompletionFlowTrigger(dedicated.published_trigger), true);
    const menu = { name: "Menu", published_trigger: { type: "any_message" } };
    assert.deepEqual(filterFlowsForPostFormContact([dedicated, menu], { isFormMessage: isFormCompletionMessage(text) }).map((f) => f.name), ["Formulário concluído"]);
  }
});

test("o código do atendimento continua sendo extraído como hoje (e o rótulo é reconhecido)", () => {
  const text = withContactCode(buildFormCompletionMessage({ firstName: "Maria", now: MORNING }), REG_ID);
  assert.ok(text.endsWith(`Código do atendimento: ${contactCodeFor(REG_ID)}`));
  assert.equal(extractContactCode(text), "1a2b3c4d");
  assert.equal(hasContactCodeMarker(text), true);
  assert.equal(extractContactCode(withContactCode(FORM_COMPLETION_MESSAGE, REG_ID)), "1a2b3c4d");
});

test("link do WhatsApp: com nome leva saudação+nome+código; sem nome é o de hoje; o redirecionamento do formulário repassa o nome", () => {
  const withName = buildReceiveSimulationWhatsappUrl("5514999999999", REG_ID, "Maria", MORNING);
  const text = decodeURIComponent(withName.split("?text=")[1]);
  assert.ok(text.startsWith("Bom dia, meu nome é Maria. Só para reforçar: preenchi meu cadastro"));
  assert.equal(extractContactCode(text), "1a2b3c4d");
  assert.equal(isFormCompletionMessage(text), true);
  const plain = decodeURIComponent(buildReceiveSimulationWhatsappUrl("5514999999999", REG_ID).split("?text=")[1]);
  assert.equal(plain, withContactCode(FORM_COMPLETION_MESSAGE, REG_ID));
  assert.equal(buildReceiveSimulationWhatsappUrl("", REG_ID, "Maria"), "");
  const redirect = resolveFormWhatsappRedirect({ state: "ready", phone: "5514999999999", registrationId: REG_ID, firstName: "Maria" });
  assert.ok(decodeURIComponent(redirect.split("?text=")[1]).includes("meu nome é Maria"));
});

test("formulário e botão repassam o nome; telefone inteiro nunca vai ao pixel quando só confirmou", () => {
  const form = read("components/simulation-form/SimulationForm.jsx");
  assert.match(form, /firstName: nameForMessage/);
  assert.match(form, /form\.confirmContactPhone === true && !String\(form\.phone/);
  assert.match(read("components/simulation-form/SimulationSuccess.jsx"), /firstName=\{name\}/);
  assert.match(read("components/simulation-form/LinkJourneyGate.jsx"), /smsContact=\{smsContact\}/);
  assert.ok(!/smsContact\.phone\b|smsContact\.fullName/.test(form));
});
