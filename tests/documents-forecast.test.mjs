// Round 4 da apresentação interativa: "previsão de envio dos documentos" (data + período + WhatsApp do corretor) e botão
// "Enviar lista de documentos" da ficha. Regra: docs/BUSINESS_RULES.md PRES-17. Sem rede, sem banco real: o acesso ao banco é
// injetado (banco falso em memória) e a migration roda num Postgres em memória (PGlite) quando PGLITE_DIR aponta para o pacote
// (sem isso esse teste fica "skipped"; a parte estática roda sempre).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLIENT_STATUS } from "../lib/client-status.js";
import {
  DOCUMENTS_LIST_SENT_EVENT,
  FORECAST_ACTIVITY_TITLE,
  FORECAST_JOURNEY_EVENT,
  FORECAST_STATUS_SOURCES,
  buildBrokerWhatsappUrl,
  buildDocumentsListMessage,
  buildForecastActivity,
  buildForecastMessage,
  canTouchClientOnForecast,
  describeForecastDate,
  documentsListLink,
  documentsListImageUrl,
  forecastScheduledAt,
  forecastWindow,
  isDateInForecastWindow,
  isForecastBlocked,
  nextStatusOnForecast,
  parseForecastBody,
  todayInSaoPaulo,
  withWhatsappText
} from "../lib/documents-forecast-core.mjs";
import { advanceClientStatusOnForecast, confirmDocumentsForecast, prepareDocumentsList, upsertForecastActivity } from "../lib/documents-forecast-store.mjs";
import { PUBLIC_DTO_FIELDS, buildPublicPresentation, generatePresentationToken, withReceiveListFlag } from "../lib/simulation-presentation-core.mjs";
import { buildAssetHrefs } from "../components/presentation/player-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
// os arquivos podem estar com CRLF (checkout no Windows): os testes de código-fonte normalizam
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
// não confunde "https://" nem o "//" de uma regex (antes dele vem ":" ou "\") com comentário
const stripComments = (code) => code.replace(/(^|[^:\\])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

// ---------- janela de 10 dias ----------
test("janela: hoje (America/Sao_Paulo) + 9 dias; 10 datas, hoje é a primeira", () => {
  const days = forecastWindow(new Date("2026-10-05T15:00:00Z"));
  assert.equal(days.length, 10);
  assert.equal(days[0], "2026-10-05");
  assert.equal(days[9], "2026-10-14");
});

test("janela: vira de dia pelo fuso de São Paulo, não pelo UTC nem pelo aparelho", () => {
  assert.equal(todayInSaoPaulo(new Date("2026-10-06T02:59:59Z")), "2026-10-05"); // 23:59 em SP
  assert.equal(todayInSaoPaulo(new Date("2026-10-06T03:00:00Z")), "2026-10-06"); // 00:00 em SP
  assert.equal(forecastWindow(new Date("2026-10-06T02:30:00Z"))[0], "2026-10-05");
  assert.equal(forecastWindow(new Date("2026-10-06T03:00:00Z"))[0], "2026-10-06");
});

test("janela: fim de mês, fim de ano e fevereiro (bissexto e comum)", () => {
  assert.deepEqual(forecastWindow(new Date("2026-10-28T15:00:00Z")).slice(-4), ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  const year = forecastWindow(new Date("2026-12-27T15:00:00Z"));
  assert.equal(year[4], "2026-12-31");
  assert.equal(year[5], "2027-01-01");
  assert.equal(year[9], "2027-01-05");
  const leap = forecastWindow(new Date("2028-02-25T15:00:00Z"));
  assert.ok(leap.includes("2028-02-29"));
  assert.equal(leap[9], "2028-03-05");
  assert.equal(forecastWindow(new Date("2027-02-24T15:00:00Z"))[9], "2027-03-05");
});

test("janela: o servidor recusa passado, o 11º dia, datas inexistentes e formatos fora do padrão", () => {
  const now = new Date("2026-10-05T15:00:00Z");
  assert.equal(isDateInForecastWindow("2026-10-05", now), true); // hoje conta como o 1º dia
  assert.equal(isDateInForecastWindow("2026-10-14", now), true);
  assert.equal(isDateInForecastWindow("2026-10-04", now), false); // ontem
  assert.equal(isDateInForecastWindow("2026-10-15", now), false); // 11º dia
  assert.equal(isDateInForecastWindow("2027-10-10", now), false);
  assert.equal(isDateInForecastWindow("2026-02-30", now), false);
  assert.equal(isDateInForecastWindow("2026-10-5", now), false);
  assert.equal(isDateInForecastWindow("2026-10-05T00:00:00Z", now), false);
  assert.equal(isDateInForecastWindow("05/10/2026", now), false);
  for (const value of [null, undefined, 20261005, {}, [], ["2026-10-05"]]) assert.equal(isDateInForecastWindow(value, now), false);
});

test("corpo do POST: allowlist estrita (data na janela + período válido); qualquer chave extra, período ou tipo errado é recusado", () => {
  const now = new Date("2026-10-05T15:00:00Z");
  assert.deepEqual(parseForecastBody({ data: "2026-10-08", periodo: "tarde" }, now), { data: "2026-10-08", periodo: "tarde" });
  for (const periodo of ["manha", "tarde", "noite"]) assert.ok(parseForecastBody({ data: "2026-10-05", periodo }, now));
  assert.equal(parseForecastBody({ data: "2026-10-08", periodo: "madrugada" }, now), null);
  assert.equal(parseForecastBody({ data: "2026-10-08", periodo: "Manhã" }, now), null);
  assert.equal(parseForecastBody({ data: "2026-10-08" }, now), null);
  assert.equal(parseForecastBody({ periodo: "tarde" }, now), null);
  assert.equal(parseForecastBody({ data: "2026-10-30", periodo: "tarde" }, now), null);
  assert.equal(parseForecastBody({ data: "2026-10-08", periodo: "tarde", telefone: "14999" }, now), null);
  assert.equal(parseForecastBody({ data: "2026-10-08", periodo: "tarde", responsavel: "x" }, now), null);
  for (const body of [null, undefined, "x", 1, []]) assert.equal(parseForecastBody(body, now), null);
});

test("exibição do calendário em português (dia da semana, dia e mês)", () => {
  assert.deepEqual(describeForecastDate("2026-10-05"), { iso: "2026-10-05", day: 5, weekday: "segunda-feira", weekdayShort: "seg", month: "outubro", monthShort: "out", year: 2026 });
  assert.equal(describeForecastDate("2026-02-30"), null);
});

// ---------- agenda: horários ----------
test("agenda: manhã 09:00, tarde 14:00, noite 19:00 no horário de Brasília (-03:00)", () => {
  assert.equal(forecastScheduledAt("2026-10-07", "manha"), "2026-10-07T12:00:00.000Z");
  assert.equal(forecastScheduledAt("2026-10-07", "tarde"), "2026-10-07T17:00:00.000Z");
  assert.equal(forecastScheduledAt("2026-10-07", "noite"), "2026-10-07T22:00:00.000Z");
  assert.equal(forecastScheduledAt("2026-10-07", "madrugada"), null);
  assert.equal(forecastScheduledAt("2026-13-07", "tarde"), null);
  // a hora local de Brasília é a pedida
  const local = (iso) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  assert.equal(local(forecastScheduledAt("2026-10-07", "manha")), "09:00");
  assert.equal(local(forecastScheduledAt("2026-10-07", "tarde")), "14:00");
  assert.equal(local(forecastScheduledAt("2026-10-07", "noite")), "19:00");
});

test("agenda: campos da atividade (título, tipo 'documentos', observação, criada pelo sistema)", () => {
  const fields = buildForecastActivity({ clientId: "c1", responsibleUserId: "u1", data: "2026-10-07", periodo: "manha" });
  assert.deepEqual(fields, {
    client_id: "c1", responsible_user_id: "u1", title: "Cliente previu enviar documentos", activity_type: "documentos",
    scheduled_at: "2026-10-07T12:00:00.000Z", note: "Previsão de envio: manhã", priority: null, status: "pending", created_by: null
  });
  assert.equal(buildForecastActivity({ clientId: "c1", responsibleUserId: "", data: "2026-10-07", periodo: "manha" }), null);
});

// ---------- mensagem pronta ----------
test("mensagem do cliente ao corretor: texto exato, só o primeiro nome, sem dado sensível", () => {
  const text = buildForecastMessage({ fullName: "Maria da Silva Souza", data: "2026-10-07", periodo: "manha" });
  assert.equal(text, "Olá! Aqui é Maria. Vi minha simulação e acredito que consigo enviar toda a documentação até 07/10, no período da manhã. Pode me mandar a lista de documentos?");
  assert.ok(!/Silva|Souza/.test(text));
  assert.match(buildForecastMessage({ fullName: "Ana", data: "2026-11-02", periodo: "noite" }), /até 02\/11, no período da noite\./);
  assert.match(buildForecastMessage({ fullName: "Ana", data: "2026-11-02", periodo: "tarde" }), /no período da tarde\./);
  // sem nome: não inventa; nome com quebra de linha/controle é saneado
  assert.ok(!/Aqui é/.test(buildForecastMessage({ fullName: "", data: "2026-10-07", periodo: "manha" })));
  assert.ok(!/[\n\r\t]/.test(buildForecastMessage({ fullName: "Jo\não\u0007 X", data: "2026-10-07", periodo: "manha" })));
});

test("link do WhatsApp do corretor: wa.me com o texto codificado; telefone inválido não gera link", () => {
  const url = buildBrokerWhatsappUrl("5514991112222", "Olá! Pode ser às 9h?");
  assert.equal(url, `https://wa.me/5514991112222?text=${encodeURIComponent("Olá! Pode ser às 9h?")}`);
  assert.equal(new URL(url).searchParams.get("text"), "Olá! Pode ser às 9h?");
  for (const phone of ["", "14991112222", "551499", "abc", null, undefined, "5514991112222999"]) assert.equal(buildBrokerWhatsappUrl(phone, "x"), "");
});

// ---------- status ----------
test("status: só completed, simulation_sent e in_service vão para 'Aguardando documentação'; todos os demais ficam como estão", () => {
  assert.deepEqual([...FORECAST_STATUS_SOURCES].sort(), [CLIENT_STATUS.COMPLETED, CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.SIMULATION_SENT].sort());
  for (const status of FORECAST_STATUS_SOURCES) assert.equal(nextStatusOnForecast(status), CLIENT_STATUS.DOCUMENTATION);
  for (const status of Object.values(CLIENT_STATUS)) {
    if (FORECAST_STATUS_SOURCES.includes(status)) continue;
    assert.equal(nextStatusOnForecast(status), null, `${status} não pode mudar`);
  }
  // nunca regride: quem já está em "Aguardando documentação" ou adiante não muda; "Tentando contato" tem trava própria
  for (const status of [CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING, CLIENT_STATUS.APPROVAL_PENDING, CLIENT_STATUS.APPROVED, CLIENT_STATUS.AWAITING_RETURN, CLIENT_STATUS.PENDING, CLIENT_STATUS.REJECTED]) {
    assert.equal(nextStatusOnForecast(status), null);
  }
  assert.equal(isForecastBlocked(CLIENT_STATUS.DO_NOT_CONTACT), true);
  assert.equal(isForecastBlocked(CLIENT_STATUS.ARCHIVED), false);
  assert.equal(canTouchClientOnForecast(CLIENT_STATUS.ARCHIVED), false);
  assert.equal(canTouchClientOnForecast(CLIENT_STATUS.DO_NOT_CONTACT), false);
  assert.equal(canTouchClientOnForecast(CLIENT_STATUS.IN_SERVICE), true);
});

// ---------- banco falso em memória ----------
function createFakeDb(seed = {}, hooks = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  let sequence = 0;
  const calls = [];
  const uniqueSystemActivity = (row, rows) =>
    row.activity_type === "documentos" && row.status === "pending" && row.created_by == null &&
    rows.some((other) => other.client_id === row.client_id && other.activity_type === "documentos" && other.status === "pending" && other.created_by == null);

  function from(table) {
    tables[table] ||= [];
    const state = { op: "select", filters: [], patch: null, row: null, limit: null, order: null };
    const matches = () => tables[table].filter((row) => state.filters.every(([kind, column, value]) => (kind === "eq" ? row[column] === value : row[column] == null)));
    function run() {
      if (hooks.fail?.(table, state.op)) return { data: null, error: hooks.fail(table, state.op) };
      if (state.op === "insert") {
        hooks.beforeInsert?.(table, tables);
        const row = { id: `${table}-${++sequence}`, created_at: new Date(2026, 9, 5, 12, 0, sequence).toISOString(), notified_at: null, ...state.row };
        if (table === "calendar_activities" && uniqueSystemActivity(row, tables[table])) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        tables[table].push(row);
        calls.push({ op: "insert", table, row: { ...row } });
        return { data: [{ ...row }], error: null };
      }
      if (state.op === "update") {
        hooks.beforeUpdate?.(table, tables, state.filters);
        const rows = matches();
        for (const row of rows) Object.assign(row, state.patch);
        calls.push({ op: "update", table, patch: { ...state.patch }, count: rows.length, filters: state.filters });
        return { data: rows.map((row) => ({ ...row })), error: null };
      }
      if (hooks.fail?.(table, "select")) return { data: null, error: hooks.fail(table, "select") };
      let rows = matches().map((row) => ({ ...row }));
      if (state.order) rows.sort((a, b) => (String(a[state.order.column]) < String(b[state.order.column]) ? 1 : -1) * (state.order.ascending ? -1 : 1));
      if (state.limit != null) rows = rows.slice(0, state.limit);
      return { data: rows, error: null };
    }
    const api = {
      select() { return api; },
      insert(row) { state.op = "insert"; state.row = row; return api; },
      update(patch) { state.op = "update"; state.patch = patch; return api; },
      eq(column, value) { state.filters.push(["eq", column, value]); return api; },
      is(column) { state.filters.push(["is", column]); return api; },
      order(column, { ascending = true } = {}) { state.order = { column, ascending }; return api; },
      limit(n) { state.limit = n; return api; },
      maybeSingle() { const result = run(); return Promise.resolve(result.error ? result : { data: result.data[0] || null, error: null }); },
      single() { const result = run(); return Promise.resolve(result.error ? result : result.data[0] ? { data: result.data[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }); },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); }
    };
    return api;
  }
  return { supabase: { from }, tables, calls };
}

const TOKEN = generatePresentationToken();
const NOW = new Date("2026-10-05T15:00:00Z");
const BROKER_PHONE = "(14) 99111-2222";

function seedWorld(overrides = {}) {
  return {
    simulation_presentations: [{ id: "p1", token: TOKEN, simulation_id: "s1", registration_id: "r1", status: "active", docs_forecast_count: 0, ...overrides.presentation }],
    simulations: [{ id: "s1", client_name: "Maria da Silva Souza", registration_id: "r1", ...overrides.simulation }],
    simulation_registrations: overrides.noClient ? [] : [{ id: "r1", full_name: "Maria da Silva Souza", status: "in_service", responsible_user_id: "u1", ...overrides.registration }],
    admin_users: [{ id: "u1", status: "active", phone: BROKER_PHONE, ...overrides.broker }],
    calendar_activities: overrides.activities || []
  };
}

function makeDeps(db) {
  const history = [];
  const journey = [];
  return {
    history,
    journey,
    deps: {
      supabase: db.supabase,
      recordStatusChange: async (entry) => { history.push({ ...entry, supabase: undefined }); },
      logJourney: async (event) => { journey.push(event); }
    }
  };
}

const INPUT = { data: "2026-10-07", periodo: "manha" };
const confirm = (db, extra = {}) => {
  const ctx = makeDeps(db);
  return confirmDocumentsForecast({ ...ctx.deps, token: TOKEN, input: INPUT, now: NOW, ...extra }).then((result) => ({ result, ...ctx }));
};

test("confirmação: grava o compromisso, muda o status, cria a atividade e devolve o wa.me do responsável", async () => {
  const db = createFakeDb(seedWorld());
  const { result, history, journey } = await confirm(db);
  assert.equal(result.kind, "ok");
  const expectedText = "Olá! Aqui é Maria. Vi minha simulação e acredito que consigo enviar toda a documentação até 07/10, no período da manhã. Pode me mandar a lista de documentos?";
  assert.equal(result.url, `https://wa.me/5514991112222?text=${encodeURIComponent(expectedText)}`);

  const presentation = db.tables.simulation_presentations[0];
  assert.equal(presentation.docs_forecast_date, "2026-10-07");
  assert.equal(presentation.docs_forecast_period, "manha");
  assert.equal(presentation.docs_forecast_at, NOW.toISOString());
  assert.equal(presentation.docs_forecast_count, 1);

  assert.equal(db.tables.simulation_registrations[0].status, CLIENT_STATUS.DOCUMENTATION);
  assert.equal(db.tables.simulation_registrations[0].last_status_change_at, NOW.toISOString());
  assert.equal(history.length, 1);
  assert.equal(history[0].changedBy, "sistema");
  assert.equal(history[0].source, "apresentacao_cliente");
  assert.equal(history[0].previousStatus, "in_service");
  assert.equal(history[0].newStatus, "documentation_pending");

  const [activity] = db.tables.calendar_activities;
  assert.equal(db.tables.calendar_activities.length, 1);
  assert.equal(activity.created_by, null);
  assert.equal(activity.responsible_user_id, "u1");
  assert.equal(activity.client_id, "r1");
  assert.equal(activity.activity_type, "documentos");
  assert.equal(activity.title, FORECAST_ACTIVITY_TITLE);
  assert.equal(activity.scheduled_at, "2026-10-07T12:00:00.000Z");
  assert.equal(activity.status, "pending");

  assert.equal(journey.length, 1);
  assert.equal(journey[0].eventType, FORECAST_JOURNEY_EVENT);
  assert.equal(journey[0].actor, null);
  assert.equal(journey[0].clientId, "r1");
  assert.match(journey[0].details.text, /Cliente previu enviar documentos até 07\/10 \(manhã\)/);
});

test("segunda confirmação (data/período novos) ATUALIZA a mesma atividade: nunca duplica, zera o aviso e não mexe de novo no status", async () => {
  const db = createFakeDb(seedWorld());
  await confirm(db);
  db.tables.calendar_activities[0].notified_at = "2026-10-07T12:01:00.000Z"; // o corretor já tinha sido avisado
  const second = await confirm(db, { input: { data: "2026-10-09", periodo: "noite" } });
  assert.equal(second.result.kind, "ok");
  assert.equal(db.tables.calendar_activities.length, 1);
  assert.equal(db.tables.calendar_activities[0].scheduled_at, "2026-10-09T22:00:00.000Z");
  assert.equal(db.tables.calendar_activities[0].note, "Previsão de envio: noite");
  assert.equal(db.tables.calendar_activities[0].notified_at, null);
  assert.equal(second.history.length, 0); // já estava em "Aguardando documentação"
  assert.equal(db.tables.simulation_presentations[0].docs_forecast_count, 2);
  assert.equal(db.tables.simulation_presentations[0].docs_forecast_period, "noite");
});

test("atividade que o corretor reagendou (mesmo título/tipo, criada por ele) também é atualizada, sem duplicar; uma já concluída gera nova", async () => {
  const rescheduled = { id: "a-user", client_id: "r1", responsible_user_id: "u1", title: FORECAST_ACTIVITY_TITLE, activity_type: "documentos", status: "pending", created_by: "user-9", scheduled_at: "2026-10-20T12:00:00.000Z", created_at: "2026-10-05T10:00:00.000Z" };
  const db = createFakeDb(seedWorld({ activities: [rescheduled] }));
  await confirm(db);
  assert.equal(db.tables.calendar_activities.length, 1);
  assert.equal(db.tables.calendar_activities[0].id, "a-user");
  assert.equal(db.tables.calendar_activities[0].scheduled_at, "2026-10-07T12:00:00.000Z");

  const done = createFakeDb(seedWorld({ activities: [{ ...rescheduled, status: "completed" }] }));
  await confirm(done);
  assert.equal(done.tables.calendar_activities.length, 2);
  assert.equal(done.tables.calendar_activities.filter((row) => row.status === "pending").length, 1);
});

test("duas confirmações quase juntas: a que perde a corrida (23505 do índice único) atualiza a atividade vencedora", async () => {
  const winner = { id: "a-win", client_id: "r1", responsible_user_id: "u1", title: FORECAST_ACTIVITY_TITLE, activity_type: "documentos", status: "pending", created_by: null, scheduled_at: "2026-10-06T12:00:00.000Z", created_at: "2026-10-05T10:00:00.000Z" };
  let injected = false;
  const db = createFakeDb(seedWorld(), { beforeInsert: (table, tables) => { if (table === "calendar_activities" && !injected) { injected = true; tables.calendar_activities.push({ ...winner }); } } });
  const { result } = await confirm(db);
  assert.equal(result.kind, "ok");
  assert.equal(db.tables.calendar_activities.length, 1);
  assert.equal(db.tables.calendar_activities[0].scheduled_at, "2026-10-07T12:00:00.000Z");
});

test("status por origem: atividade na agenda sempre que o cliente é tocável; status só na lista fechada", async () => {
  for (const status of Object.values(CLIENT_STATUS)) {
    const db = createFakeDb(seedWorld({ registration: { status } }));
    const { result, history } = await confirm(db);
    if (status === CLIENT_STATUS.DO_NOT_CONTACT) {
      assert.equal(result.kind, "blocked");
      assert.equal(db.tables.calendar_activities.length, 0);
      assert.equal(db.tables.simulation_presentations[0].docs_forecast_count, 0);
      assert.equal(db.tables.simulation_presentations[0].docs_forecast_date, undefined);
      assert.equal(history.length, 0);
      continue;
    }
    assert.equal(result.kind, "ok", status);
    const expectChange = FORECAST_STATUS_SOURCES.includes(status);
    assert.equal(db.tables.simulation_registrations[0].status, expectChange ? CLIENT_STATUS.DOCUMENTATION : status, status);
    assert.equal(history.length, expectChange ? 1 : 0, status);
    // arquivado: nada de atividade nem de status; os outros ganham a atividade
    assert.equal(db.tables.calendar_activities.length, status === CLIENT_STATUS.ARCHIVED ? 0 : 1, status);
    assert.equal(db.tables.simulation_presentations[0].docs_forecast_count, 1, status);
  }
});

test("'Não contactar': nada é gravado e nenhum link é devolvido; arquivado: só o compromisso, e o link é devolvido", async () => {
  const dnc = createFakeDb(seedWorld({ registration: { status: "do_not_contact" } }));
  const blocked = await confirm(dnc);
  assert.deepEqual(blocked.result, { kind: "blocked" });
  assert.equal(dnc.calls.filter((call) => call.op !== "select").length, 0);
  assert.equal(blocked.journey.length, 0);

  const archived = createFakeDb(seedWorld({ registration: { status: "archived" } }));
  const result = (await confirm(archived)).result;
  assert.equal(result.kind, "ok");
  assert.ok(result.url.startsWith("https://wa.me/5514991112222?text="));
  assert.equal(archived.tables.simulation_registrations[0].status, "archived");
});

test("corrida de status: UPDATE condicionado ao status lido — quem chegou primeiro vale e nada regride", async () => {
  const db = createFakeDb(seedWorld(), { beforeUpdate: (table, tables) => { if (table === "simulation_registrations") tables.simulation_registrations[0].status = "approval_pending"; } });
  const { result, history } = await confirm(db);
  assert.equal(result.kind, "ok");
  assert.equal(db.tables.simulation_registrations[0].status, "approval_pending"); // continua onde estava
  assert.equal(history.length, 0);
  const update = db.calls.find((call) => call.op === "update" && call.table === "simulation_registrations");
  assert.deepEqual(update.filters.map(([kind, column, value]) => `${kind}:${column}:${value}`).sort(), ["eq:id:r1", "eq:status:in_service"]);
});

test("advanceClientStatusOnForecast isolado: lista fechada, histórico 'sistema'/'apresentacao_cliente' e retorno nulo quando nada muda", async () => {
  for (const status of [CLIENT_STATUS.COMPLETED, CLIENT_STATUS.SIMULATION_SENT, CLIENT_STATUS.IN_SERVICE]) {
    const db = createFakeDb({ simulation_registrations: [{ id: "r1", status }] });
    const history = [];
    const moved = await advanceClientStatusOnForecast({ supabase: db.supabase, recordStatusChange: async (entry) => history.push(entry), client: { id: "r1", status }, now: NOW });
    assert.deepEqual(moved, { clientId: "r1", from: status, to: "documentation_pending" });
    assert.equal(history[0].changedBy, "sistema");
    assert.equal(history[0].source, "apresentacao_cliente");
  }
  const db = createFakeDb({ simulation_registrations: [{ id: "r1", status: "approved" }] });
  assert.equal(await advanceClientStatusOnForecast({ supabase: db.supabase, recordStatusChange: async () => assert.fail("não deve gravar"), client: { id: "r1", status: "approved" }, now: NOW }), null);
  assert.equal(db.calls.length, 0);
});

test("sem cadastro vinculado (registration_id nulo): grava só o compromisso; sem status, sem agenda e sem link", async () => {
  const db = createFakeDb(seedWorld({ presentation: { registration_id: null }, simulation: { registration_id: null }, noClient: true }));
  const { result, history, journey } = await confirm(db);
  assert.deepEqual({ kind: result.kind, url: result.url }, { kind: "ok", url: "" });
  assert.equal(db.tables.simulation_presentations[0].docs_forecast_count, 1);
  assert.equal(db.tables.calendar_activities.length, 0);
  assert.equal(history.length, 0);
  assert.equal(journey.length, 0);
});

test("sem responsável ativo com WhatsApp válido: sem link, sem status e sem agenda (o botão também não aparece no cliente)", async () => {
  const cases = [
    { name: "sem responsável", registration: { responsible_user_id: null } },
    { name: "responsável inativo", broker: { status: "inactive" } },
    { name: "telefone vazio", broker: { phone: "" } },
    { name: "telefone inválido", broker: { phone: "123" } },
    { name: "responsável inexistente", registration: { responsible_user_id: "u-que-nao-existe" } }
  ];
  for (const item of cases) {
    const db = createFakeDb(seedWorld(item));
    const { result, history } = await confirm(db);
    assert.equal(result.kind, "ok", item.name);
    assert.equal(result.url, "", item.name);
    assert.equal(db.tables.calendar_activities.length, 0, item.name);
    assert.equal(db.tables.simulation_registrations[0].status, item.registration?.status || "in_service", item.name);
    assert.equal(history.length, 0, item.name);
    assert.equal(db.tables.simulation_presentations[0].docs_forecast_count, 1, item.name);
  }
});

test("token inválido, inexistente ou revogado: not_found sem gravar nada; migration ausente: unavailable", async () => {
  const ctx = (db) => makeDeps(db).deps;
  const db = createFakeDb(seedWorld());
  assert.deepEqual(await confirmDocumentsForecast({ ...ctx(db), token: "curto", input: INPUT, now: NOW }), { kind: "not_found" });
  assert.deepEqual(await confirmDocumentsForecast({ ...ctx(db), token: generatePresentationToken(), input: INPUT, now: NOW }), { kind: "not_found" });
  const revoked = createFakeDb(seedWorld({ presentation: { status: "revoked" } }));
  assert.deepEqual(await confirmDocumentsForecast({ ...ctx(revoked), token: TOKEN, input: INPUT, now: NOW }), { kind: "not_found" });
  assert.equal(revoked.calls.filter((call) => call.op !== "select").length, 0);
  const noColumns = createFakeDb(seedWorld(), { fail: (table, op) => (table === "simulation_presentations" && op === "select" ? { code: "42703", message: 'column "docs_forecast_count" does not exist' } : null) });
  assert.deepEqual(await confirmDocumentsForecast({ ...ctx(noColumns), token: TOKEN, input: INPUT, now: NOW }), { kind: "unavailable" });
});

test("erro real de banco não é mascarado: a confirmação falha (a rota responde 503) em vez de fingir sucesso", async () => {
  const db = createFakeDb(seedWorld(), { fail: (table, op) => (table === "calendar_activities" && op === "insert" ? { code: "XX000", message: "boom" } : null) });
  await assert.rejects(() => confirm(db), (error) => error.message === "boom");
});

test("upsertForecastActivity: cria uma vez e depois só atualiza", async () => {
  const db = createFakeDb({ calendar_activities: [] });
  const first = await upsertForecastActivity({ supabase: db.supabase, clientId: "r1", responsibleUserId: "u1", data: "2026-10-07", periodo: "tarde", now: NOW });
  const second = await upsertForecastActivity({ supabase: db.supabase, clientId: "r1", responsibleUserId: "u1", data: "2026-10-08", periodo: "manha", now: NOW });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.id, second.id);
  assert.equal(db.tables.calendar_activities.length, 1);
  assert.equal(db.tables.calendar_activities[0].scheduled_at, "2026-10-08T12:00:00.000Z");
  // outro cliente tem a sua própria atividade
  await upsertForecastActivity({ supabase: db.supabase, clientId: "r2", responsibleUserId: "u2", data: "2026-10-08", periodo: "manha", now: NOW });
  assert.equal(db.tables.calendar_activities.length, 2);
});

// ---------- DTO público: só um booleano ----------
test("DTO público: ganha SÓ o booleano podeReceberLista; nenhum telefone, wa.me ou dado do corretor sai no HTML/JSON", () => {
  const simulation = {
    clientName: "Maria da Silva", simulationDate: "2026-10-01",
    simulationModels: { novo: { financingValue: 200000, subsidyValue: 20000, firstInstallment: 1000, lastInstallment: 900 }, usado: { financingValue: 200000, subsidyValue: 20000, firstInstallment: 1000, lastInstallment: 900 } },
    registration: { responsibleUserId: "u1", phone: "14999887766" }, properties: []
  };
  const base = buildPublicPresentation({ simulation, defaultReason: "x" });
  assert.ok(base);
  const dto = withReceiveListFlag(base, true);
  assert.equal(dto.podeReceberLista, true);
  assert.equal(withReceiveListFlag(base, false).podeReceberLista, false);
  assert.equal(withReceiveListFlag(base, "yes").podeReceberLista, false); // só `true` liga
  assert.deepEqual(Object.keys(dto).sort(), [...PUBLIC_DTO_FIELDS].sort());
  const json = JSON.stringify(dto);
  for (const forbidden of ["14999887766", "wa.me", "whatsapp", "5514", "responsibleUserId", "u1", "phone"]) assert.ok(!json.toLowerCase().includes(forbidden.toLowerCase()), forbidden);
  assert.equal(withReceiveListFlag(null, true), null);
});

test("página pública e prévia só repassam o booleano ao player; o DTO nunca carrega telefone", () => {
  const page = stripComments(read("app/apresentacao/[token]/page.jsx"));
  assert.match(page, /canReceiveList=\{dto\.podeReceberLista === true\}/);
  assert.ok(!/wa\.me|phone|whatsapp/i.test(page));
  const preview = stripComments(read("app/admin/simulacoes/[id]/apresentacao/page.jsx"));
  assert.match(preview, /preview canReceiveList=\{dto\.podeReceberLista === true\}/);
  const lib = stripComments(read("lib/simulation-presentation.js"));
  const canReceive = /export async function canReceiveDocumentsList[\s\S]*?\n}\n/.exec(lib)?.[0] || "";
  assert.match(canReceive, /return contact\.state === RECEIVE_CONTACT_STATE\.READY;/);
  assert.match(canReceive, /resolveReceiveSimulationContact/); // mesma regra do "Receber minha simulação" (responsável ativo + telefone válido)
  assert.ok(!/return[^;]*(phone|digits)/i.test(canReceive.replace(/whatsappDigits: toWhatsAppDigits\(data\.phone\)/, "")));
});

// ---------- player / folha ----------
test("apresentação: o cliente não baixa mais a lista; o botão 'Receber lista de documentos' só existe com podeReceberLista", () => {
  const player = stripComments(read("components/presentation/PresentationPlayer.jsx"));
  assert.ok(!/Baixar imagem da lista de documentos/.test(player));
  assert.ok(!/hrefs\.documents/.test(player));
  const scene = /function SceneDocumentos[\s\S]*?\n}\n/.exec(player)?.[0] || "";
  assert.match(scene, /\{canReceiveList \? \(/);
  assert.match(scene, /Receber lista de documentos/);
  assert.match(scene, />\s*Lista de documentos\s*</); // a folha que MOSTRA a lista continua
  assert.match(player, /forecastOpen && current\.id === "documentos" && canReceiveList \? <ForecastSheet token=\{token\} preview=\{preview\}/);
  // as rotas do PNG continuam (o link vai na mensagem do corretor)
  assert.ok(fs.existsSync(path.join(ROOT, "app/apresentacao/[token]/documentos/route.js")));
  assert.match(read("proxy.js"), /imagem\|documentos/);
  assert.equal(buildAssetHrefs({ token: TOKEN }).documents, `/s/${TOKEN}/documentos?baixar=1`);
});

test("folha da previsão: pergunta, calendário de 10 dias, período em 3 botões, botão final e estados", () => {
  const sheet = read("components/presentation/ForecastSheet.jsx");
  const code = stripComments(sheet);
  assert.match(code, /Quando você acredita que conseguirá enviar toda a documentação para validarmos a sua aprovação\?/);
  assert.match(code, /forecastWindow\(now\)/); // os mesmos 10 dias que o servidor aceita
  assert.match(code, /FORECAST_PERIODS\.map/);
  assert.match(code, /Receber lista de documentos necessários/);
  assert.match(code, /Abrindo o WhatsApp do seu corretor…/);
  assert.match(code, /window\.location\.assign\(body\.url\)/);
  assert.match(code, /Se não abrir, toque aqui/); // fallback clicável
  assert.match(code, /Prévia: o envio está desativado/);
  // botão final desativado até escolher data e período, e na prévia
  assert.match(code, /const ready = Boolean\(date && period\) && !disabledByPreview && !busy;/);
  // a prévia nunca chama a rota: a guarda vem antes do fetch
  const submit = /const submit = useCallback\(async \(\) => \{[\s\S]*?\}, \[busy/.exec(code)?.[0] || "";
  assert.ok(submit.indexOf("if (disabledByPreview") > -1 && submit.indexOf("if (disabledByPreview") < submit.indexOf("fetch("));
  // só aceita wa.me no redirecionamento; trata 400/404/429
  assert.match(code, /\^https:\\\/\\\/wa\\\.me\\\//);
  for (const status of ["400", "404", "429"]) assert.match(code, new RegExp(`status === ${status}`));
  // acessibilidade: foco no fechar, Escape, botões com aria-pressed, rótulo de cada dia
  assert.match(code, /closeRef\.current\?\.focus\(\)/);
  assert.match(code, /event\.key === "Escape"/);
  assert.match(code, /aria-pressed=\{selected\}/);
  assert.match(code, /aria-label=\{`\$\{day\.weekday\}, \$\{day\.day\} de \$\{day\.month\}/);
  // nada de telefone do corretor no componente (o link vem pronto do servidor)
  assert.ok(!/phone|telefone/i.test(code));
  // tamanho mínimo de toque e movimento reduzido
  const css = read("components/presentation/presentation.module.css");
  assert.match(css, /\.fcDay, \.fcPeriod \{[^}]*min-height: 64px/);
  assert.match(css, /\.fcSubmit \{[^}]*min-height: max\(56px/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.fcDay, \.fcPeriod, \.fcSubmit \{ transition: none; \}/);
});

test("prévia do CRM e vitrine: o painel abre, mas sem token o botão final fica desativado", () => {
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.match(player, /token="" preview|<ForecastSheet token=\{token\} preview=\{preview\}/);
  assert.match(read("components/presentation/ForecastSheet.jsx"), /const disabledByPreview = preview \|\| !token;/);
  assert.match(read("app/dev/vitrine/apresentacao/page.dev.jsx"), /canReceiveList=\{query\?\.lista !== "nao"\}/);
});

// ---------- rota pública ----------
test("rota pública: allowlist, limite de 5/min por link, bot, 404 genérico, cabeçalhos privados e sem login", () => {
  const route = read("app/api/s/[token]/documentos-previsao/route.js");
  const code = stripComments(route);
  assert.match(code, /createRateLimiter\(\{ limit: 5, windowMs: 60_000 \}\)/);
  assert.match(code, /isLikelyBot\(/);
  assert.match(code, /parseForecastBody\(body, new Date\(\)\)/);
  assert.match(code, /if \(!isPresentationToken\(token\)\) return respond\(\{ error: "Não encontrado\." \}, 404\)/);
  assert.match(code, /text\.length > 200/);
  assert.match(code, /"Cache-Control": "no-store"/);
  assert.match(code, /"X-Robots-Tag": "noindex, nofollow"/);
  assert.ok(!/requireAdminApi|admin-auth/.test(code)); // rota pública por token
  // ordem: token → corpo → bot → limite → gravação (nada é gravado antes de validar)
  const order = ["isPresentationToken(token)", "parseForecastBody(body", "isLikelyBot(request", "allow(token)", "confirmDocumentsForecastByToken(token"].map((piece) => code.indexOf(piece));
  assert.ok(order.every((value, index) => value > -1 && (index === 0 || value > order[index - 1])), order.join(","));
  // só devolve { ok, url }; "Não contactar" não recebe link
  assert.match(code, /respond\(\{ ok: true, url: result\.url \|\| "" \}, 200\)/);
  assert.match(code, /result\.kind === "blocked"\) return respond\(\{ error: "Não foi possível concluir agora\." \}, 409\)/);
});

test("proxy: a rota /api/s/<token>/documentos-previsao é API (sem rewrite de apresentação) e a página não usa query", () => {
  const proxy = read("proxy.js");
  assert.match(proxy, /PRESENTATION_TOKEN_PATH = \/\^\\\/s\\\//); // só /s/<token> e /s/<token>/(imagem|documentos)
  assert.ok(!/documentos-previsao/.test(proxy));
});

// ---------- ficha do cliente ----------
test("ficha: botão 'Enviar lista de documentos' com guarda de escopo, bloqueio e prévia antes de enviar", () => {
  const route = read("app/api/admin/clients/[id]/lista-documentos/route.js");
  const code = stripComments(route);
  assert.ok(code.indexOf("requireAdminApi(request)") > -1 && code.indexOf("requireAdminApi(request)") < code.indexOf("prepareClientDocumentsList(id"));
  assert.match(code, /if \(!auth\.ok\) return NextResponse\.json\(\{ error: auth\.error \}, \{ status: auth\.status \}\)/);
  assert.match(code, /AdminPermissionError/);
  assert.match(code, /Lance a simulação primeiro\./);
  assert.match(code, /status: 409/);
  assert.ok(!/sendChatMessage|fetch\(|wa\.me|updateSimulationRegistration|status:\s*CLIENT_STATUS/.test(code)); // a rota nunca envia nem muda status
  const lib = stripComments(read("lib/documents-forecast.js"));
  assert.match(lib, /getSimulationRegistration\(clientId, auth\)/); // escopo de equipe (assertCanAccessResponsibleUser dentro dela)
  assert.match(lib, /ensurePresentation\(\{ simulation, userId/); // get-or-create idempotente
  assert.match(lib, /resolveActorSnapshot\(auth\)/); // atribuído a quem opera (corretor emulado no "Alterar conta")
  assert.ok(!/getActingAdminEmail/.test(lib));

  const sheet = stripComments(read("components/clients/ClientSheet.jsx"));
  assert.match(sheet, /Enviar lista de documentos/);
  assert.match(sheet, /\[CLIENT_STATUS\.ARCHIVED, CLIENT_STATUS\.DO_NOT_CONTACT\]\.includes\(client\.status\)/);
  assert.match(sheet, /list\.prepareDocumentsList\(client\)/);
  assert.match(sheet, /<DocumentsListDialog/);
  assert.match(sheet, /Cancelar/);
});

test("ficha: decisão Chat × WhatsApp externo por decideCardWhatsapp; a janela abre dentro do clique; nunca muda o status", () => {
  const hook = stripComments(read("components/clients/useClientList.js"));
  const prepare = /async function prepareDocumentsList[\s\S]*?\n  }\n/.exec(hook)?.[0] || "";
  const confirmFn = /async function confirmDocumentsList[\s\S]*?\n  }\n/.exec(hook)?.[0] || "";
  assert.ok(prepare && confirmFn);
  assert.match(hook, /function decideClientWhatsapp[\s\S]*?decideCardWhatsapp\(/);
  assert.match(prepare, /decideClientWhatsapp\(client, value\)/);
  assert.match(prepare, /setDocsListTarget/); // só prepara a prévia: nada é enviado aqui
  assert.ok(!/whatsapp-chat|window\.open/.test(prepare));
  // externo: window.open(wa.me|web.whatsapp + ?text=) sem nenhum await antes (bloqueador de pop-up)
  const external = confirmFn.slice(confirmFn.indexOf("if (decision.action === CARD_WA_EXTERNAL)"), confirmFn.indexOf("} else {"));
  assert.ok(external.includes("window.open(withWhatsappText(decision.url, message)"));
  assert.ok(!/await/.test(external.slice(0, external.indexOf("window.open"))));
  assert.match(confirmFn, /\/api\/admin\/whatsapp-chat\/open-client/);
  assert.match(confirmFn, /conversations\/\$\{conversation\.conversationId\}\/media/); // a lista vai como IMAGEM pelo envio de mídia do Chat
  assert.match(confirmFn, /form\.append\("caption", message\)/);
  assert.match(confirmFn, /image\/png/);
  assert.ok(!/conversations\/\$\{conversation\.conversationId\}\/messages/.test(confirmFn)); // nada de link de texto
  assert.match(confirmFn, /action: "registrar"/);
  assert.ok(!/updateClientStatus|prospecting\/clients|status:/.test(confirmFn + prepare));
  // externo (wa.me não anexa imagem): só texto curto; o corretor baixa a imagem pelo botão da confirmação
  assert.ok(!/imageUrl|FormData/.test(external));
  const sheetDialog = read("components/clients/ClientSheet.jsx");
  assert.match(sheetDialog, /Baixar imagem da lista/);
  assert.match(sheetDialog, /não anexa imagem/);
  assert.match(sheetDialog, /href=\{target\.link\} download/);
});

test("ficha: decisão do Chat × externo (decideCardWhatsapp) devolve o link certo e withWhatsappText acrescenta o texto", async () => {
  const { decideCardWhatsapp } = await import("../lib/client-card-whatsapp-core.mjs");
  const message = buildDocumentsListMessage({ fullName: "Maria da Silva" });
  const base = { stateKnown: true, clientStatus: "in_service", isOwnClient: true, phone: "(14) 99888-7766" };
  assert.equal(decideCardWhatsapp({ ...base, sessionStatus: "connected" }).action, "chat");
  const mobile = decideCardWhatsapp({ ...base, sessionStatus: "disconnected", device: "mobile" });
  const desktop = decideCardWhatsapp({ ...base, sessionStatus: "disconnected", device: "desktop" });
  assert.equal(mobile.action, "external");
  assert.equal(withWhatsappText(mobile.url, message), `https://wa.me/5514998887766?text=${encodeURIComponent(message)}`);
  assert.equal(withWhatsappText(desktop.url, message), `https://web.whatsapp.com/send?phone=5514998887766&text=${encodeURIComponent(message)}`);
  assert.equal(decideCardWhatsapp({ ...base, sessionStatus: "disconnected", clientStatus: "do_not_contact" }).action, "chat"); // nunca abre fora
  assert.equal(withWhatsappText("", "x"), "");
});

test("mensagem da ficha: legenda curta (sem link), só o primeiro nome; imagem sem ?baixar=1 para o Chat e com ?baixar=1 para baixar", () => {
  const link = documentsListLink(TOKEN, "https://www.matheusmachadoimoveis.com.br/");
  assert.equal(link, `https://www.matheusmachadoimoveis.com.br/s/${TOKEN}/documentos?baixar=1`);
  assert.equal(documentsListImageUrl(TOKEN, "https://www.matheusmachadoimoveis.com.br/"), `https://www.matheusmachadoimoveis.com.br/s/${TOKEN}/documentos`);
  const message = buildDocumentsListMessage({ fullName: "Maria da Silva Souza" });
  assert.equal(message, "Olá, Maria! Segue a lista de documentos para a sua simulação.");
  assert.ok(!/Silva|Souza|http/.test(message));
  assert.match(buildDocumentsListMessage({ fullName: "" }), /^Olá! Segue a lista/);
});

test("prepareDocumentsList: bloqueia arquivado/não contactar, avisa sem simulação, e o get-or-create devolve sempre o mesmo link", async () => {
  const token = TOKEN;
  let ensureCalls = 0;
  const ensure = async () => { ensureCalls += 1; return { schemaReady: true, presentation: { token } }; };
  const simulation = async () => ({ id: "s1" });
  const client = (status) => ({ id: "r1", fullName: "Maria da Silva", status });

  for (const status of ["archived", "do_not_contact"]) {
    assert.deepEqual(await prepareDocumentsList({ client: client(status), findSimulation: simulation, ensurePresentation: ensure }), { kind: "blocked" });
  }
  assert.equal(ensureCalls, 0); // bloqueado: nem cria link
  assert.deepEqual(await prepareDocumentsList({ client: null, findSimulation: simulation, ensurePresentation: ensure }), { kind: "blocked" });
  assert.deepEqual(await prepareDocumentsList({ client: client("in_service"), findSimulation: async () => null, ensurePresentation: ensure }), { kind: "no_simulation" });
  assert.equal(ensureCalls, 0);
  assert.deepEqual(await prepareDocumentsList({ client: client("in_service"), findSimulation: simulation, ensurePresentation: async () => ({ schemaReady: false, presentation: null }) }), { kind: "unavailable" });

  const first = await prepareDocumentsList({ client: client("in_service"), findSimulation: simulation, ensurePresentation: ensure, origin: "https://www.matheusmachadoimoveis.com.br" });
  const second = await prepareDocumentsList({ client: client("in_service"), findSimulation: simulation, ensurePresentation: ensure, origin: "https://www.matheusmachadoimoveis.com.br" });
  assert.equal(first.kind, "ok");
  assert.equal(first.link, second.link);
  assert.equal(first.link, `https://www.matheusmachadoimoveis.com.br/s/${token}/documentos?baixar=1`);
  assert.equal(first.imageUrl, `https://www.matheusmachadoimoveis.com.br/s/${token}/documentos`);
  assert.equal(first.message, "Olá, Maria! Segue a lista de documentos para a sua simulação.");
  // todo status que não seja arquivado/não contactar pode receber (a lista não muda o funil)
  for (const status of Object.values(CLIENT_STATUS).filter((value) => !["archived", "do_not_contact"].includes(value))) {
    assert.equal((await prepareDocumentsList({ client: client(status), findSimulation: simulation, ensurePresentation: ensure })).kind, "ok", status);
  }
});

test("jornada: os dois eventos novos têm rótulo e categoria na timeline", () => {
  const journey = read("components/ClientJourneyActions.jsx");
  assert.match(journey, new RegExp(`${FORECAST_JOURNEY_EVENT}: "atividades"`));
  assert.match(journey, new RegExp(`${DOCUMENTS_LIST_SENT_EVENT}: "atividades"`));
  assert.match(journey, /case "document_forecast_set":/);
  assert.match(journey, /LISTA DE DOCUMENTOS ENVIADA/);
  assert.match(journey, /Lista de documentos enviada/);
});

// ---------- migration ----------
const MIGRATION_FILE = "20261005180000_presentation_documents_forecast.sql";
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase/migrations", MIGRATION_FILE), "utf8");

test("migration: 14 dígitos, aditiva e idempotente, sem nada destrutivo, sem policy", () => {
  assert.match(MIGRATION_FILE, /^\d{14}_[a-z_]+\.sql$/);
  assert.ok(MIGRATION_FILE > "20261005150000_simulations_interest_rate.sql"); // depois das migrations do round anterior
  assert.doesNotMatch(MIGRATION, /\b(drop\s+(table|column|index)|truncate|delete\s+from|alter\s+column|rename)\b/i);
  assert.doesNotMatch(MIGRATION, /create\s+policy|grant\s|revoke\s/i);
  for (const column of ["docs_forecast_date date", "docs_forecast_period text", "docs_forecast_at timestamptz", "docs_forecast_count smallint not null default 0"]) {
    assert.ok(MIGRATION.includes(`add column if not exists ${column}`), column);
  }
  assert.match(MIGRATION, /check \(docs_forecast_period is null or docs_forecast_period in \('manha', 'tarde', 'noite'\)\)/);
  assert.match(MIGRATION, /create unique index if not exists calendar_activities_documents_forecast_one_pending_idx\s+on public\.calendar_activities \(client_id\)\s+where activity_type = 'documentos' and status = 'pending' and created_by is null/);
  assert.ok(!fs.readdirSync(path.join(ROOT, "supabase/migrations")).some((name) => /^\d{8}_/.test(name) && name.startsWith("20261005_")));
});

const pgliteDir = process.env.PGLITE_DIR;
test("migration (PGlite): cria colunas e índice, roda duas vezes, recusa período inválido, deixa o reagendamento do corretor passar e pula o índice se houver duplicidade", { skip: pgliteDir ? false : "defina PGLITE_DIR (pasta do pacote @electric-sql/pglite) para rodar a migration de verdade" }, async () => {
  const { PGlite } = await import(pathToFileURL(path.join(pgliteDir, "dist", "index.js")).href);
  const bootstrap = `
    create table public.simulation_presentations (id uuid primary key default gen_random_uuid(), token text not null unique, status text not null default 'active', view_count integer not null default 0);
    create table public.calendar_activities (id uuid primary key default gen_random_uuid(), client_id uuid, title text not null, activity_type text not null default 'outro', status text not null default 'pending', created_by uuid, scheduled_at timestamptz not null default now());
  `;
  const fresh = async () => { const db = new PGlite(); await db.exec("create schema if not exists public;"); await db.exec(bootstrap); return db; };

  const db = await fresh();
  await db.exec("insert into public.simulation_presentations (token) values ('ANTES')");
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotente
  const row = (await db.query("select docs_forecast_date, docs_forecast_period, docs_forecast_at, docs_forecast_count, token from public.simulation_presentations")).rows[0];
  assert.equal(row.token, "ANTES"); // dado existente intacto
  assert.equal(row.docs_forecast_count, 0);
  assert.equal(row.docs_forecast_date, null);
  await db.exec("update public.simulation_presentations set docs_forecast_period = 'noite', docs_forecast_date = '2026-10-07', docs_forecast_count = docs_forecast_count + 1");
  await assert.rejects(() => db.exec("update public.simulation_presentations set docs_forecast_period = 'madrugada'"), /check/i);
  const client = "00000000-0000-0000-0000-0000000000c1";
  const insert = (createdBy, status = "pending", type = "documentos") => db.exec(`insert into public.calendar_activities (client_id, title, activity_type, status, created_by) values ('${client}', 'Cliente previu enviar documentos', '${type}', '${status}', ${createdBy ? `'${createdBy}'` : "null"})`);
  await insert(null);
  await assert.rejects(() => insert(null), /unique|duplicate/i); // segunda atividade do sistema pendente: o banco recusa
  await insert("00000000-0000-0000-0000-0000000000a1"); // reagendamento do corretor (created_by preenchido): passa
  await insert(null, "completed"); // concluída não conta
  await insert(null, "pending", "follow_up"); // outros tipos não são atingidos
  assert.equal((await db.query("select count(*)::int as n from public.calendar_activities")).rows[0].n, 4);
  await db.close();

  // já existe duplicidade: a migration NÃO falha e o índice é pulado com aviso
  const dup = await fresh();
  await dup.exec(`insert into public.calendar_activities (client_id, title, activity_type, created_by) values ('${client}', 'x', 'documentos', null), ('${client}', 'y', 'documentos', null)`);
  await dup.exec(MIGRATION);
  assert.equal((await dup.query("select count(*)::int as n from pg_indexes where indexname = 'calendar_activities_documents_forecast_one_pending_idx'")).rows[0].n, 0);
  assert.equal((await dup.query("select count(*)::int as n from information_schema.columns where table_name = 'simulation_presentations' and column_name like 'docs_forecast_%'")).rows[0].n, 4);
  await dup.close();
});

// ---------- PDF intocado ----------
test("PDF da simulação e motor de entrada: nenhum arquivo novo do round 4 os importa", () => {
  for (const file of ["lib/documents-forecast-core.mjs", "lib/documents-forecast-store.mjs", "lib/documents-forecast.js", "components/presentation/ForecastSheet.jsx", "app/api/s/[token]/documentos-previsao/route.js", "app/api/admin/clients/[id]/lista-documentos/route.js"]) {
    const code = stripComments(read(file));
    assert.ok(!/simulacao-entrada|pdf-lib|SimulationGenerator|\/pdf/i.test(code), file);
  }
});
