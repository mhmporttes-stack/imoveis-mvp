// "Agendar atendimento" da apresentação (PRES-22, regra do dono de 2026-10-08). Só funções puras: horários, escassez em
// blocos, resolução da gestora, corpo das rotas, mensagens e .ics. Sem rede e sem banco.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  APPOINTMENT_ACTIVITY_TITLE,
  APPOINTMENT_UNAVAILABLE_LABEL,
  agendaSeed,
  baseSlotsForDate,
  buildAppointmentActivity,
  buildAppointmentIcs,
  buildAppointmentMessage,
  buildAppointmentRequestMessage,
  buildClientAgenda,
  buildGoogleCalendarUrl,
  isSlotTooSoon,
  normalizeMeetLink,
  parseAppointmentBody,
  parseAppointmentRequestBody,
  publicAppointment,
  resolveAgendaOwnerId,
  scarcityBusyTimes,
  slotStartsAt,
  slotState
} from "../lib/client-appointments-core.mjs";
import { COMPANY_ADDRESS } from "../lib/company-info.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-10-08T12:00:00Z"); // quinta-feira, 09:00 em São Paulo
const SEED = agendaSeed("segredo-de-teste", "gestora-1");

// ---------- horários ----------
test("horários: seg-sex 08:30…18:30 (21), sábado 08:30…12:30 (9), domingo nenhum", () => {
  const weekday = baseSlotsForDate("2026-10-08");
  assert.equal(weekday.length, 21);
  assert.equal(weekday[0], "08:30");
  assert.equal(weekday.at(-1), "18:30");
  const saturday = baseSlotsForDate("2026-10-10");
  assert.equal(saturday.length, 9);
  assert.equal(saturday.at(-1), "12:30");
  assert.deepEqual(baseSlotsForDate("2026-10-11"), []);
  assert.deepEqual(baseSlotsForDate("2026-02-30"), []);
});

test("horários: instante em Brasília (-03:00)", () => {
  assert.equal(slotStartsAt("2026-10-08", "08:30"), "2026-10-08T11:30:00.000Z");
});

test("hoje: horário que começa em menos de 1 h não fica disponível", () => {
  // 09:00 em SP: 09:30 está a 30 min (não), 10:00 está a 1 h (sim)
  assert.equal(isSlotTooSoon("2026-10-08", "09:30", NOW), true);
  assert.equal(isSlotTooSoon("2026-10-08", "10:00", NOW), false);
  const today = buildClientAgenda({ now: NOW, seed: SEED }).find((day) => day.date === "2026-10-08");
  for (const slot of today.slots) if (slot.time < "10:00") assert.equal(slot.available, false, slot.time);
});

test("agenda: 10 dias da janela, domingo sem horários", () => {
  const agenda = buildClientAgenda({ now: NOW, seed: SEED });
  assert.equal(agenda.length, 10);
  assert.equal(agenda[0].date, "2026-10-08");
  assert.deepEqual(agenda.find((day) => day.date === "2026-10-11").slots, []);
});

// ---------- escassez ----------
function runs(flags) {
  const out = [];
  for (const flag of flags) {
    if (out.length && out.at(-1).busy === flag) out.at(-1).size += 1;
    else out.push({ busy: flag, size: 1 });
  }
  return out;
}

function datesAhead(count) {
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 9, 5) + i * 86_400_000).toISOString().slice(0, 10));
}

test("escassez: manhã e tarde com ~metade indisponível, em blocos de 2 a 4, nunca alternado", () => {
  for (const date of datesAhead(120)) {
    for (const manager of ["g1", "g2", "g3"]) {
      const busy = scarcityBusyTimes(date, agendaSeed("s", manager));
      const slots = baseSlotsForDate(date);
      for (const part of [slots.filter((t) => t < "12:00"), slots.filter((t) => t >= "12:00")]) {
        if (!part.length) continue;
        const flags = part.map((time) => busy.has(time));
        const count = flags.filter(Boolean).length;
        if (part.length < 4) {
          assert.equal(count, Math.floor(part.length / 2), `${date} trecho curto`);
          continue;
        }
        assert.ok(count >= Math.floor(part.length / 2) && count <= Math.ceil(part.length / 2), `${date} ${manager}: ${count}/${part.length}`);
        const parts = runs(flags);
        parts.forEach((run, i) => {
          if (run.busy) assert.ok(run.size >= 2 && run.size <= 4, `${date} bloco de ${run.size}`);
          // livre isolado entre dois blocos ocupados = alternado
          if (!run.busy && i > 0 && i < parts.length - 1) assert.ok(run.size >= 2, `${date} livre isolado entre blocos`);
        });
      }
    }
  }
});

test("escassez: determinística (recarregar não muda) e diferente por data e por gestora", () => {
  assert.deepEqual([...scarcityBusyTimes("2026-10-08", SEED)], [...scarcityBusyTimes("2026-10-08", SEED)]);
  const patterns = new Set(datesAhead(20).filter((d) => baseSlotsForDate(d).length === 21).map((d) => [...scarcityBusyTimes(d, SEED)].join(",")));
  assert.ok(patterns.size > 5, "datas diferentes devem ter agendas diferentes");
  const otherManager = agendaSeed("segredo-de-teste", "gestora-2");
  const differs = datesAhead(10).some((d) => [...scarcityBusyTimes(d, SEED)].join() !== [...scarcityBusyTimes(d, otherManager)].join());
  assert.ok(differs, "gestoras diferentes devem ter agendas diferentes");
});

test("disponibilidade: atendimento real ocupa; horário fictício e inexistente são recusados", () => {
  const date = "2026-10-09";
  const fake = [...scarcityBusyTimes(date, SEED)][0];
  assert.equal(slotState({ date, time: fake, now: NOW, seed: SEED }), "unavailable");
  const free = baseSlotsForDate(date).find((time) => !scarcityBusyTimes(date, SEED).has(time));
  assert.equal(slotState({ date, time: free, now: NOW, seed: SEED }), "available");
  assert.equal(slotState({ date, time: free, now: NOW, seed: SEED, busyStarts: new Set([slotStartsAt(date, free)]) }), "unavailable");
  assert.equal(slotState({ date, time: "19:00", now: NOW, seed: SEED }), "invalid");
  assert.equal(slotState({ date: "2026-10-11", time: "08:30", now: NOW, seed: SEED }), "invalid");
  assert.equal(slotState({ date: "2026-10-30", time: "08:30", now: NOW, seed: SEED }), "invalid");
});

test("agenda do cliente só diz livre/indisponível (sem motivo) e o rótulo é 'Indisponível'", () => {
  const agenda = buildClientAgenda({ now: NOW, seed: SEED });
  for (const day of agenda) for (const slot of day.slots) assert.deepEqual(Object.keys(slot).sort(), ["available", "time"]);
  assert.equal(APPOINTMENT_UNAVAILABLE_LABEL, "Indisponível");
  const sheet = read("components/presentation/AppointmentSheet.jsx");
  assert.ok(!/Reservado/i.test(sheet));
});

// ---------- gestora ----------
const isOwnerEmail = (email) => email === "dono@x.com";
const USERS = [
  { id: "owner", role: "admin", status: "active", email: "dono@x.com" },
  { id: "m1", role: "manager", status: "active", email: "m1@x.com", manager_id: "owner" },
  { id: "b1", role: "broker", status: "active", email: "b1@x.com", manager_id: "m1" },
  { id: "b2", role: "broker", status: "active", email: "b2@x.com", manager_id: null },
  { id: "a1", role: "associate", status: "active", email: "a1@x.com", linked_broker_id: "b1" },
  { id: "a2", role: "associate", status: "active", email: "a2@x.com", linked_broker_id: "b2" },
  { id: "m2", role: "manager", status: "inactive", email: "m2@x.com", manager_id: "owner" },
  { id: "b3", role: "broker", status: "active", email: "b3@x.com", manager_id: "m2" }
];

test("gestora: corretor → manager; associado → gestora do corretor vinculado; gestor/admin → ele mesmo", () => {
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "b1", users: USERS, isOwnerEmail }), "m1");
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "a1", users: USERS, isOwnerEmail }), "m1");
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "m1", users: USERS, isOwnerEmail }), "m1");
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "owner", users: USERS, isOwnerEmail }), "owner");
});

test("gestora: corretor sem gestor (ou gestor inativo) → responsável acima; ninguém → o dono", () => {
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "b2", users: USERS, isOwnerEmail }), "owner");
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "a2", users: USERS, isOwnerEmail }), "owner");
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "b3", users: USERS, isOwnerEmail }), "owner");
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "x", users: USERS, isOwnerEmail }), "owner");
  const loop = [{ id: "p", role: "broker", status: "active", manager_id: "q" }, { id: "q", role: "broker", status: "active", manager_id: "p" }];
  assert.equal(resolveAgendaOwnerId({ responsibleUserId: "p", users: loop, isOwnerEmail }), "");
});

// ---------- corpo das rotas ----------
test("corpo da reserva: allowlist estrita, data na janela, hora existente", () => {
  assert.deepEqual(parseAppointmentBody({ tipo: "online", data: "2026-10-09", hora: "14:00" }, NOW), { tipo: "online", data: "2026-10-09", hora: "14:00" });
  assert.equal(parseAppointmentBody({ tipo: "online", data: "2026-10-09", hora: "14:15" }, NOW), null);
  assert.equal(parseAppointmentBody({ tipo: "online", data: "2026-10-11", hora: "09:00" }, NOW), null);
  assert.equal(parseAppointmentBody({ tipo: "visita", data: "2026-10-09", hora: "14:00" }, NOW), null);
  assert.equal(parseAppointmentBody({ tipo: "online", data: "2026-10-09", hora: "14:00", x: 1 }, NOW), null);
  assert.equal(parseAppointmentBody({ tipo: "online", data: "2026-10-30", hora: "14:00" }, NOW), null);
});

test("corpo do 'outro horário': qualquer dia da janela (inclusive domingo), texto curto e limpo", () => {
  assert.deepEqual(parseAppointmentRequestBody({ tipo: "presencial", data: "2026-10-11", texto: "  depois\n das 19h " }, NOW), { tipo: "presencial", data: "2026-10-11", texto: "depois das 19h" });
  assert.equal(parseAppointmentRequestBody({ tipo: "presencial", data: "2026-10-11", texto: " " }, NOW), null);
  assert.equal(parseAppointmentRequestBody({ tipo: "presencial", data: "2026-10-11", texto: "x".repeat(301) }, NOW), null);
  assert.equal(parseAppointmentRequestBody({ tipo: "presencial", data: "2026-10-11", texto: "ok", hora: "1" }, NOW), null);
  assert.equal(parseAppointmentRequestBody({ tipo: "presencial", data: "2026-10-11", texto: "y".repeat(200) }, NOW).texto.length, 80);
});

test("link do Meet: só https://meet.google.com/...", () => {
  assert.equal(normalizeMeetLink("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assert.equal(normalizeMeetLink("meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assert.equal(normalizeMeetLink(""), "");
  assert.equal(normalizeMeetLink("https://evil.com/meet.google.com/abc"), null);
  assert.equal(normalizeMeetLink("http://meet.google.com/abc-defg-hij"), null);
});

// ---------- mensagens, atividade ----------
test("mensagens: só o primeiro nome; presencial com endereço; online sem link pede o link", () => {
  const presencial = buildAppointmentMessage({ fullName: "Ana Maria Souza", kind: "presencial", date: "2026-10-09", time: "14:00" });
  assert.match(presencial, /Aqui é Ana\./);
  assert.ok(presencial.includes(COMPANY_ADDRESS));
  assert.ok(presencial.includes("sexta-feira, 09/10, às 14:00"));
  assert.ok(!presencial.includes("Souza"));
  assert.match(buildAppointmentMessage({ fullName: "Ana", kind: "online", date: "2026-10-09", time: "14:00" }), /pelo Google Meet\. Pode me enviar o link da reunião\?/);
  assert.match(buildAppointmentMessage({ fullName: "Ana", kind: "online", date: "2026-10-09", time: "14:00", meetLink: "https://meet.google.com/abc-defg-hij" }), /pelo Google Meet\. Pode confirmar\?/);
  assert.match(buildAppointmentRequestMessage({ fullName: "Ana", kind: "online", date: "2026-10-11", text: "após 19h" }), /domingo, 11\/10, após 19h\?/);
});

test("atividade no card: título oficial, sem created_by, no horário reservado", () => {
  const activity = buildAppointmentActivity({ clientId: "c", responsibleUserId: "b1", kind: "online", startsAt: "2026-10-09T17:00:00.000Z" });
  assert.equal(activity.title, "Reunião online (Meet) agendada pelo cliente");
  assert.equal(APPOINTMENT_ACTIVITY_TITLE.presencial, "Atendimento presencial agendado pelo cliente");
  assert.equal(activity.created_by, null);
  assert.equal(activity.scheduled_at, "2026-10-09T17:00:00.000Z");
  assert.equal(buildAppointmentActivity({ clientId: "c", responsibleUserId: "", kind: "online", startsAt: "x" }), null);
});

// ---------- agenda do cliente ----------
test(".ics: UID estável, horário de Brasília, local, descrição e lembretes de 1 dia e 2 h", () => {
  const input = { id: "11111111-2222-3333-4444-555555555555", startsAt: "2026-10-09T17:00:00.000Z", endsAt: "2026-10-09T17:30:00.000Z", createdAt: "2026-10-08T12:00:00Z", kind: "presencial", brokerName: "Bia", brokerPhone: "5514999990000" };
  const ics = buildAppointmentIcs(input);
  assert.equal(ics, buildAppointmentIcs(input));
  assert.ok(ics.includes("\r\n"));
  assert.ok(ics.includes("UID:11111111-2222-3333-4444-555555555555@matheusmachadoimoveis.com.br"));
  assert.ok(ics.includes("DTSTART;TZID=America/Sao_Paulo:20261009T140000"));
  assert.ok(ics.includes("DTEND;TZID=America/Sao_Paulo:20261009T143000"));
  assert.ok(ics.includes("LOCATION:Av. Ipiranga\\, 147 – Marília/SP"));
  assert.ok(ics.includes("TRIGGER:-P1D") && ics.includes("TRIGGER:-PT2H"));
  assert.ok(ics.replace(/\r\n /g, "").includes("WhatsApp: https://wa.me/5514999990000"));
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const online = buildAppointmentIcs({ ...input, kind: "online", meetLink: "https://meet.google.com/abc-defg-hij" });
  assert.ok(online.includes("LOCATION:https://meet.google.com/abc-defg-hij"));
});

test("Google Agenda: link TEMPLATE com horário de Brasília e fuso", () => {
  const url = new URL(buildGoogleCalendarUrl({ startsAt: "2026-10-09T17:00:00.000Z", endsAt: "2026-10-09T17:30:00.000Z", kind: "presencial" }));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("dates"), "20261009T140000/20261009T143000");
  assert.equal(url.searchParams.get("ctz"), "America/Sao_Paulo");
  assert.equal(url.searchParams.get("location"), COMPANY_ADDRESS);
});

test("resumo público do agendamento: data e hora de Brasília, sem dados internos", () => {
  assert.deepEqual(publicAppointment({ id: "a", kind: "online", starts_at: "2026-10-09T17:00:00+00:00", client_id: "c", manager_user_id: "m" }), { id: "a", tipo: "online", data: "2026-10-09", hora: "14:00", dia: "sexta-feira, 09/10" });
});

// ---------- estático ----------
test("rotas públicas: token validado, limite de taxa, sem guard de admin; migration aditiva com índice único parcial", () => {
  const route = read("app/api/s/[token]/agendamento/route.js");
  assert.ok(route.includes("isPresentationToken(token)") && route.includes("createRateLimiter"));
  const sql = read("supabase/migrations/20261008120000_client_appointments.sql");
  assert.match(sql, /create table if not exists public\.client_appointments/);
  assert.match(sql, /\(manager_user_id, starts_at\)\s+where status = 'scheduled'/);
  assert.match(sql, /enable row level security/);
  assert.ok(!/drop table|delete from|truncate/i.test(sql));
});
