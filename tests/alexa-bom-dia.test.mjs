import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  arrivalCoversToday,
  BRIEFING_MAX_LENGTH,
  briefingInputFromInicio,
  closingQuestion,
  composeFirstAccessBriefing,
  spokenWait
} from "../lib/alexa-bom-dia-core.mjs";
import {
  classifyFirstAccessInsert,
  firstAccessRedirect,
  INICIO_PATH,
  isFirstAccessEligible,
  shouldCheckFirstAccess
} from "../lib/primeiro-acesso-core.mjs";
import { containsSensitiveContent, getDefaultAlexaSettings, normalizeAlexaSettings, validateAlexaSettingsInput } from "../lib/alexa-config-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MORNING = 8 * 60 + 30;

const full = {
  minutesOfDay: MORNING,
  leads: { total: 5, ad: 3, marketplace: 1, other: 1 },
  awaitingReply: 4,
  urgent: { name: "Ana Paula Souza", waitingMinutes: 135 },
  toReview: 2,
  overdue: 3,
  docs: 6,
  invocation: "central"
};

test("bom dia completo: mesmos números do Início, primeiro nome, pergunta da skill no final", () => {
  const text = composeFirstAccessBriefing(full);
  assert.equal(
    text,
    "Bom dia, Machado. Hoje entraram 5 leads: 3 de anúncio, 1 do Marketplace e 1 de outra origem. 4 clientes aguardam resposta; comece por Ana, que espera há 2 horas. Há 2 simulações a conferir, 3 atividades atrasadas e 6 clientes aguardando documentos. Quer os detalhes? É só dizer: Alexa, abrir central."
  );
  assert.ok(text.length <= BRIEFING_MAX_LENGTH);
  assert.equal(containsSensitiveContent(text), false);
});

test("zero e indisponível (null) ficam fora; nada pendente vira 'Nada urgente agora.'", () => {
  const text = composeFirstAccessBriefing({ minutesOfDay: MORNING, leads: { total: 0, ad: 0, marketplace: 0, other: 0 }, awaitingReply: null, toReview: 0, overdue: null, docs: 0, invocation: "" });
  assert.equal(text, "Bom dia, Machado. Ainda não entrou nenhum lead hoje. Nada urgente agora. Por onde vamos começar?");
});

test("uma origem só e um lead só", () => {
  assert.match(composeFirstAccessBriefing({ ...full, leads: { total: 3, ad: 3, marketplace: 0, other: 0 } }), /Hoje entraram 3 leads, todos de anúncio\./);
  assert.match(composeFirstAccessBriefing({ ...full, leads: { total: 1, ad: 0, marketplace: 1, other: 0 } }), /Hoje entrou 1 lead, do Marketplace\./);
  assert.match(composeFirstAccessBriefing({ ...full, awaitingReply: 1 }), /1 cliente aguarda resposta; comece por Ana/);
});

test("saudação pelo horário de São Paulo", () => {
  assert.match(composeFirstAccessBriefing({ ...full, minutesOfDay: 14 * 60 }), /^Boa tarde, Machado\./);
  assert.match(composeFirstAccessBriefing({ ...full, minutesOfDay: 21 * 60 }), /^Boa noite, Machado\./);
});

test("nome sem letras (telefone como nome do contato) ou sensível sai da fala", () => {
  const phoneName = composeFirstAccessBriefing({ ...full, urgent: { name: "5511999998888", waitingMinutes: 5 } });
  assert.match(phoneName, /4 clientes aguardam resposta\. Há/);
  assert.doesNotMatch(phoneName, /\d{6,}/);
  const sensitive = composeFirstAccessBriefing({ ...full, urgent: { name: "Renda Silva", waitingMinutes: 5 } });
  assert.doesNotMatch(sensitive, /Renda/);
  assert.equal(containsSensitiveContent(sensitive), false);
});

test("rotina de chegada já falou hoje: só o bom dia, sem repetir o resumo", () => {
  assert.equal(
    composeFirstAccessBriefing({ ...full, arrivalCovered: true }),
    "Bom dia, Machado. O resumo de hoje já saiu na chegada ao escritório; os números atualizados estão na tela Início."
  );
});

test("texto longo é cortado do fim, mantendo saudação e pergunta", () => {
  const text = composeFirstAccessBriefing({ ...full, urgent: { name: "A".repeat(20), waitingMinutes: 10 }, invocation: "x".repeat(300) });
  assert.doesNotMatch(text, /simulações a conferir/);
  assert.ok(text.startsWith("Bom dia, Machado."));
  assert.ok(text.endsWith(`abrir ${"x".repeat(300)}.`));
});

test("espera falada sem abreviação", () => {
  assert.equal(spokenWait(1), "1 minuto");
  assert.equal(spokenWait(45), "45 minutos");
  assert.equal(spokenWait(60), "1 hora");
  assert.equal(spokenWait(3000), "2 dias");
  assert.equal(spokenWait(null), "");
  assert.equal(closingQuestion(""), "Por onde vamos começar?");
});

test("entrada da fala vem do retorno de getPainelInicio (fonte única do Início)", () => {
  const inicio = {
    assistant: { text: "", urgent: { name: "Ana", clientId: "c1", waitingMinutes: 12 } },
    kpis: { leadsToday: { total: 2, ad: 2, marketplace: 0, other: 0 }, toReview: 1, docs: { total: 4, stale: 1, staleDays: 7 } },
    awaitingReply: 3,
    overdue: 0
  };
  assert.deepEqual(briefingInputFromInicio(inicio, { minutesOfDay: 500 }), {
    minutesOfDay: 500,
    arrivalCovered: false,
    leads: { total: 2, ad: 2, marketplace: 0, other: 0 },
    awaitingReply: 3,
    urgent: { name: "Ana", clientId: "c1", waitingMinutes: 12 },
    toReview: 1,
    overdue: 0,
    docs: 4
  });
  assert.equal(briefingInputFromInicio({ kpis: { docs: null } }).docs, null);
});

test("chegada ao escritório cobre o dia só se falou ok hoje ou está pendente hoje", () => {
  const today = "2026-10-22";
  assert.equal(arrivalCoversToday({ last_run_status: "ok", last_run_at: "2026-10-22T11:00:00Z" }, today), true);
  assert.equal(arrivalCoversToday({ last_run_status: "ok", last_run_at: "2026-10-22T02:00:00Z" }, today), false); // 21/10 em SP
  assert.equal(arrivalCoversToday({ last_run_status: "fora_do_horario", last_run_at: "2026-10-22T11:00:00Z" }, today), false);
  assert.equal(arrivalCoversToday({ pending_run_at: "2026-10-22T11:05:00Z", last_arrival_date: today }, today), true);
  assert.equal(arrivalCoversToday(null, today), false);
});

test("elegibilidade: só o dono, na conta real", () => {
  assert.equal(isFirstAccessEligible({ ok: true, isOwner: true, accountSwitchMode: false }), true);
  assert.equal(isFirstAccessEligible({ ok: true, isOwner: true, accountSwitchMode: true }), false);
  assert.equal(isFirstAccessEligible({ ok: true, isOwner: false }), false);
  assert.equal(isFirstAccessEligible({ ok: false, isOwner: true }), false);
});

test("quando o navegador pergunta e para onde vai", () => {
  const base = { pathname: "/admin/simulacoes", search: "", hash: "", storedDay: "2026-10-21", today: "2026-10-22" };
  assert.equal(shouldCheckFirstAccess(base), true);
  assert.equal(shouldCheckFirstAccess({ ...base, pathname: "/admin" }), true);
  assert.equal(shouldCheckFirstAccess({ ...base, storedDay: "2026-10-22" }), false);
  assert.equal(shouldCheckFirstAccess({ ...base, search: "?cliente=1" }), false);
  assert.equal(shouldCheckFirstAccess({ ...base, hash: "#x" }), false);
  assert.equal(shouldCheckFirstAccess({ ...base, pathname: "/admin/login" }), false);
  assert.equal(shouldCheckFirstAccess({ ...base, pathname: "/admin/seguranca" }), false);
  assert.equal(shouldCheckFirstAccess({ ...base, pathname: "/administrador" }), false);
  assert.equal(shouldCheckFirstAccess({ ...base, pathname: "/financeiro" }), false);
  assert.equal(firstAccessRedirect("/admin/simulacoes"), INICIO_PATH);
  assert.equal(firstAccessRedirect(INICIO_PATH), null);
});

test("1 vez por dia: só o INSERT que vence é o primeiro acesso", () => {
  assert.equal(classifyFirstAccessInsert(null), "claimed");
  assert.equal(classifyFirstAccessInsert({ code: "23505" }), "already");
  assert.equal(classifyFirstAccessInsert({ code: "42P01" }), "unavailable");
});

test("rotina 'first_access': nasce ligada só com a Alexa ativa e passa na validação do painel", () => {
  assert.equal(getDefaultAlexaSettings().routines.first_access.enabled, true);
  assert.equal(normalizeAlexaSettings({ enabled: false, routines: {} }).routines.first_access.enabled, false);
  assert.equal(normalizeAlexaSettings({ enabled: true, routines: {} }).routines.first_access.enabled, true);
  assert.equal(normalizeAlexaSettings({ enabled: true, routines: { first_access: { enabled: false } } }).routines.first_access.enabled, false);
  const saved = validateAlexaSettingsInput(getDefaultAlexaSettings());
  assert.equal(saved.routines.first_access.enabled, true);
  assert.equal(saved.routines.arrival.enabled, false);
});

test("fiação: servidor dispara a fala depois da resposta; rotas com guard; gate só para o dono fora de Alterar conta", () => {
  const route = read("app/api/admin/primeiro-acesso/route.js");
  assert.match(route, /requireAdminApi\(request\)/);
  assert.match(route, /after\(\(\) => announceFirstAccessBriefing/);
  const layout = read("app/admin/layout.jsx");
  assert.match(layout, /!auth\.accountSwitchMode && isOwnerAdminEmail\(auth\.user\?\.email\) \? <FirstAccessGate \/>/);
  assert.match(read("app/api/admin/alexa/bom-dia/route.js"), /requireGeneralAdminApi\(request\)/);
  const service = read("lib/alexa-bom-dia.js");
  assert.match(service, /evaluateRoutineSpeak\(\{ settings, routineKey: ROUTINE \}\)/);
  assert.match(service, /claimSpeakingSlot\(settings\)/);
  assert.match(service, /getPainelInicio\(auth\)/);
  assert.doesNotMatch(read("components/FirstAccessGate.jsx"), /api\/admin\/alexa|speakAlexa/);
});
