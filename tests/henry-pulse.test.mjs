import test from "node:test";
import assert from "node:assert/strict";
import {
  HENRY_PULSE_CARD_W,
  HENRY_PULSE_DEFAULTS,
  HENRY_PULSE_TYPE_KEYS,
  buildPulseEvents,
  groupPulseBursts,
  henryPulseConfig,
  henryPulseFromSetting,
  parseHenryPulsePatch,
  parsePulseSince,
  pickPulseSpot,
  pulseBeamCurve,
  pulseCardText,
  pulsePhase,
  pulsePullPosition,
  pulseBlobShape,
  pulseBlobStartAngle,
  pulseSnippet
} from "../lib/henry-pulse-core.mjs";
import { isAllowedHenryNavigation } from "../lib/henry-navigation-core.mjs";

const BROKER = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";
const users = new Map([[BROKER, { id: BROKER, name: "Bruna Santos", email: "bruna@x.com", photo_url: "https://cdn.example/b.jpg" }]]);
const clients = new Map([[CLIENT, { id: CLIENT, full_name: "Maria da Silva", private_contact_at: null }]]);
const at = (s) => new Date(Date.UTC(2026, 9, 23, 12, 0, s)).toISOString();
const msg = (over = {}) => ({ id: "m1", conversation_id: CONV, direction: "outbound", sender_type: "user", sender_user_id: BROKER, message_type: "text", body: "Oi Maria, segue a simulação", status: "sent", message_at: at(1), ...over });
const conv = (over = {}) => ({ id: CONV, contact_phone: "5514999990000", contact_name: "Maria", client_id: CLIENT, private_at: null, deleted_at: null, internal: false, ...over });

function whatsappEvents(messageOver = {}, conversationOver = {}, extra = {}) {
  return buildPulseEvents({ whatsapp: [msg(messageOver)], users, clients, conversations: new Map([[CONV, conv(conversationOver)]]), ...extra });
}

test("WhatsApp: só mensagem humana de saída, com primeiro nome, trecho e link do Chat", () => {
  const [event] = whatsappEvents();
  assert.equal(event.type, "whatsapp");
  assert.equal(event.broker.name, "Bruna");
  assert.equal(event.broker.photo, "https://cdn.example/b.jpg");
  assert.equal(event.client, "Maria");
  assert.equal(event.snippet, "Oi Maria, segue a simulação");
  assert.deepEqual(event.link, { path: `/admin/chat?client=${CLIENT}` });
  assert.ok(isAllowedHenryNavigation(event.link.path), "link do card passa pela navegação guiada do Henry");
  for (const over of [{ direction: "inbound" }, { direction: "internal" }, { sender_type: "automation" }, { sender_user_id: null }, { status: "failed" }]) {
    assert.equal(whatsappEvents(over).length, 0, JSON.stringify(over));
  }
});

test("WhatsApp: Particular, grupo, apagada, telefone da equipe e contato pessoal ficam FORA", () => {
  assert.equal(whatsappEvents({}, { private_at: at(0) }).length, 0);
  assert.equal(whatsappEvents({}, { contact_phone: "group:123@g.us" }).length, 0);
  assert.equal(whatsappEvents({}, { deleted_at: at(0) }).length, 0);
  assert.equal(whatsappEvents({}, { internal: true }).length, 0);
  const personal = new Map([[CLIENT, { id: CLIENT, full_name: "Maria", private_contact_at: at(0) }]]);
  assert.equal(buildPulseEvents({ whatsapp: [msg()], users, clients: personal, conversations: new Map([[CONV, conv()]]) }).length, 0);
  assert.equal(buildPulseEvents({ whatsapp: [msg()], users, clients, conversations: new Map() }).length, 0, "conversa desconhecida não entra");
});

test("Sem dado sensível: nem telefone, CPF, e-mail ou documento no payload", () => {
  const sensitive = ["Meu CPF é 123.456.789-09", "Liga no (14) 99999-0000", "manda o RG", "renda de R$ 3.000", "email maria@x.com ok", "conta 12345678"];
  for (const body of sensitive) {
    const [event] = whatsappEvents({ body });
    const text = JSON.stringify(event);
    assert.equal(event.snippet === "" || !/\d{4}/.test(event.snippet), true, body);
    assert.doesNotMatch(text, /123\.456|99999|5514999990000|maria@x/, body);
  }
  const [event] = whatsappEvents();
  assert.doesNotMatch(JSON.stringify(event), /5514999990000|bruna@x\.com|Silva/);
  assert.equal(pulseSnippet("x".repeat(80)).length, 60);
  assert.equal(whatsappEvents({}, {}, { snippets: false })[0].snippet, "", "trecho desligado na configuração");
  assert.equal(whatsappEvents({ message_type: "audio", body: "" })[0].snippet, "enviou um áudio");
});

test("Outras fontes: Marketplace, publicação, roleta, simulação, CCA, chegada e pontos", () => {
  const events = buildPulseEvents({
    users,
    clients,
    marketplace: [{ id: "k1", conversation_id: "mc1", direction: "outbound", status: "sent", sender_user_id: null, body: "Olá!", message_at: at(2) }, { id: "k2", conversation_id: "mc1", direction: "internal", status: "sent", body: "nota", message_at: at(2) }],
    marketplaceConversations: new Map([["mc1", { id: "mc1", contact_name: "João Pedro" }]]),
    listings: [{ id: "l1", status: "published", published_at: at(3), neighborhood: "Jardim Itaipu" }, { id: "l2", status: "pending", published_at: null }],
    distributions: [{ id: "d1", registration_id: CLIENT, client_name: "Maria da Silva", event_type: "assigned", to_user_id: BROKER, created_at: at(4) }],
    journey: [
      { id: "j1", client_id: CLIENT, event_type: "simulation_auto_sent", actor: "sistema", occurred_at: at(5) },
      { id: "j2", client_id: CLIENT, event_type: "document_sent_to_cca", actor: "bruna@x.com", actor_name: "Bruna Santos", details: { ccaName: "Menin" }, occurred_at: at(6) },
      { id: "j3", client_id: CLIENT, event_type: "status_changed", occurred_at: at(6) }
    ],
    arrivals: [{ userId: BROKER, day: "2026-10-23", at: at(7) }, { userId: "owner", day: "2026-10-23", at: at(7) }],
    bonuses: [{ brokerId: BROKER, kind: "first_arrival", day: "2026-10-23", points: 100, action: "Primeiro a chegar na imobiliária", decidedAt: at(8) }],
    ownerId: "owner"
  });
  assert.deepEqual(events.map((event) => event.type), ["messenger", "instagram", "lead", "simulacao", "cca", "chegada", "pontos"]);
  assert.equal(events[0].link.path, "/admin/chat/marketplace");
  assert.equal(events[4].broker.name, "Bruna");
  assert.equal(events[4].detail, "Menin");
  assert.equal(pulseCardText(events[6]).who, "+100 pts · Bruna");
});

test("Tipos desligados na configuração não entram", () => {
  assert.equal(whatsappEvents({}, {}, { types: ["lead"] }).length, 0);
});

test("Rajada: mesmo corretor e canal em até 90 s vira um card ('Bruna enviou 5 mensagens')", () => {
  const burst = Array.from({ length: 5 }, (_, index) => ({ id: `w${index}`, type: "whatsapp", at: at(index * 10), broker: { name: "Bruna" }, client: index % 2 ? "Ana" : "Maria", group: "whatsapp:b" }));
  const grouped = groupPulseBursts([...burst, { id: "l", type: "lead", at: at(20), broker: { name: "Gabriel" }, client: "Pedro" }]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].count, 5);
  assert.equal(pulseCardText(grouped[0]).who, "Bruna enviou 5 mensagens");
  assert.equal(pulseCardText(grouped[0]).what, "Para Maria, Ana");
  const far = groupPulseBursts([burst[0], { ...burst[1], at: at(0).replace("12:00", "12:05") }]);
  assert.equal(far.length, 2, "longe no tempo = cards separados");
});

test("Posição livre: no computador só nas faixas laterais, fora da coluna do anel, sem sobrepor", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const geo = { W: 1440, H: 900, cx: 720, cy: 450, R: 180 };
  const live = [];
  for (let i = 0; i < 40; i += 1) {
    const spot = pickPulseSpot({ ...geo, live, random });
    const outside = spot.x + HENRY_PULSE_CARD_W <= geo.cx - geo.R || spot.x >= geo.cx + geo.R;
    assert.ok(outside, `card dentro da coluna do anel: ${spot.x}`);
    assert.ok(spot.x >= 12 && spot.x <= geo.W - HENRY_PULSE_CARD_W - 12);
    if (live.length < 3) {
      assert.ok(live.every((card) => Math.abs(card.x - spot.x) > HENRY_PULSE_CARD_W * 0.7 || Math.abs(card.y - spot.y) > 120), "espaçado dos vivos");
      live.push(spot);
    }
  }
  for (let i = 0; i < 30; i += 1) {
    const phone = pickPulseSpot({ W: 390, H: 844, cx: 195, cy: 304, R: 107, cardW: 270, random });
    assert.equal(phone.side, "around");
    const nearX = Math.max(phone.x, Math.min(195, phone.x + 270));
    const nearY = Math.max(phone.y, Math.min(304, phone.y + 58));
    assert.ok(Math.hypot(nearX - 195, nearY - 304) >= 107 * 0.75, "celular: card nunca cobre o meio do anel");
  }
});

test("Feixe: curva começa no anel e termina no card", () => {
  const curve = pulseBeamCurve({ sx: 10, sy: 20, tx: 300, ty: 120, bend: 0.3 });
  assert.deepEqual(curve(0), [10, 20]);
  assert.deepEqual(curve(1).map(Math.round), [300, 120]);
});

test("Configuração: nasce desligado, valida patch e mantém os nomes do protótipo", () => {
  assert.deepEqual(henryPulseFromSetting({}), { enabled: false, intensity: "normal", types: HENRY_PULSE_TYPE_KEYS, snippets: true });
  assert.equal(parseHenryPulsePatch({ enabled: "sim" }).ok, false);
  assert.equal(parseHenryPulsePatch({ types: ["whatsapp", "telefone"] }).ok, false);
  assert.deepEqual(parseHenryPulsePatch({ enabled: true, intensity: "suave", types: ["lead", "whatsapp"] }).patch, { enabled: true, intensity: "suave", types: ["whatsapp", "lead"] });
  assert.deepEqual(Object.keys(HENRY_PULSE_DEFAULTS).sort(), ["beam", "cardOpacity", "life", "maxCards", "pulse", "rate", "trailOpacity", "types"]);
  assert.equal(HENRY_PULSE_DEFAULTS.beam, "type");
  assert.equal(henryPulseConfig({ intensity: "intenso", types: ["lead"] }).maxCards, 4);
  const now = Date.parse(at(0));
  assert.equal(parsePulseSince("lixo", now), new Date(now - 2 * 60 * 1000).toISOString());
  assert.equal(parsePulseSince(new Date(now - 60 * 60 * 1000).toISOString(), now), new Date(now - 15 * 60 * 1000).toISOString());
});

test("Navegação do card: só Chat/Marketplace com id válido (além das telas de sempre)", () => {
  assert.equal(isAllowedHenryNavigation(`/admin/chat/marketplace?conversa=${CONV}`), true);
  assert.equal(isAllowedHenryNavigation("/admin/chat?client=1;drop"), false);
  assert.equal(isAllowedHenryNavigation(`/admin/chat?client=${CLIENT}&x=1`), false);
});

test("Ciclo v10: linha sai, moldura e card aparecem, fica parado, a linha puxa o card para dentro do Henry", () => {
  const p0 = pulsePhase(0.08);
  assert.equal(p0.appear, 0, "card invisível enquanto a linha sai");
  assert.equal(p0.rect, null);
  assert.ok(p0.beam > 0 && p0.beam < 1);
  const drawing = pulsePhase(0.2);
  assert.ok(drawing.rect > 0 && drawing.rect < 1, "moldura sendo desenhada");
  assert.equal(drawing.appear, 0);
  assert.ok(pulsePhase(0.3).appear > 0.999);
  const still = pulsePhase(0.5);
  assert.deepEqual([still.pull, still.scale, still.beam, still.rect, still.fadeOut], [0, 1, 1, 1, 1], "parado, sem crescer");
  const pulling = pulsePhase(0.85);
  assert.ok(pulling.pull > 0 && pulling.scale < 1 && pulling.beam === 1, "puxado com a linha ligada");
  const end = pulsePhase(0.999);
  assert.ok(end.scale < 0.2 && end.fadeOut < 0.05, "chega no anel pequeno e apagado");
  const target = pulsePullPosition({ x: 1000, y: 400, w: 200, h: 60 }, { cx: 720, cy: 450, R: 200 }, 1);
  assert.ok(Math.abs(target.x + 100 - (720 + 170 * Math.cos(Math.atan2(-20, 380)))) < 1, "centro do card termina no anel (R × 0,85)");
  const reduced = pulsePhase(0.9, { reduced: true });
  assert.equal(reduced.pull, 0, "movimento reduzido: sem puxada");
  assert.ok(reduced.fadeOut < 1);
});

test("Moldura orgânica: envolve o card e o feixe chega no ponto voltado para o anel", () => {
  const card = { left: 600, top: 100, width: 240, height: 56, born: 1234, t: 5000 };
  const blob = pulseBlobShape(card);
  for (let th = 0; th < Math.PI * 2; th += 0.3) {
    const [x, y] = blob.point(th);
    // Os cantos do card (fundo transparente na borda) podem ficar fora da forma; o miolo com o texto nunca é cruzado.
    const inside = x > card.left + card.width * 0.15 && x < card.left + card.width * 0.85 && y > card.top + card.height * 0.2 && y < card.top + card.height * 0.8;
    assert.ok(!inside, "a moldura fica em volta da informação, não por cima");
  }
  const th0 = pulseBlobStartAngle(blob, 300, 450); // anel embaixo à esquerda do card
  const [tx, ty] = blob.point(th0);
  assert.ok(tx < blob.mx && ty > blob.my, "ponto de toque do lado do anel");
  const still = pulseBlobShape({ ...card, reduced: true });
  assert.deepEqual(still.point(1), pulseBlobShape({ ...card, t: 99999, reduced: true }).point(1), "movimento reduzido = forma parada");
});

test("Computador com mouse e tela estreita: só o lado onde o card cabe inteiro", () => {
  const spot = pickPulseSpot({ W: 760, H: 800, cx: 380, cy: 400, R: 60, wide: true, random: () => 0.1 });
  assert.ok(spot.x >= 380 + 60 || spot.x + HENRY_PULSE_CARD_W <= 380 - 60);
});

test("Anel falando (v12): estado voice só em speaking; demais estados com as mesmas chaves", async () => {
  const { HENRY_ORB_STATES } = await import("../components/henry/henry-orb-states.mjs");
  assert.equal(HENRY_ORB_STATES.speaking.voice, 1);
  for (const [name, state] of Object.entries(HENRY_ORB_STATES)) if (name !== "speaking") assert.equal(state.voice, 0, name);
});

test("Pulso no anel (v15): cor viva com a mesma matiz do card", async () => {
  const { vividColor } = await import("../components/henry/henry-orb-states.mjs");
  assert.equal(vividColor("#b59cff"), "hsl(255, 100%, 60%)", "roxo do CCA continua roxo, só mais vivo");
  assert.equal(vividColor("#4fd18b"), "hsl(148, 100%, 60%)");
});

test("Avatar (v13): canal = ícone, simulação = casa, corretor = foto com anel na cor dele ou inicial", async () => {
  const { pulseAvatar } = await import("../lib/henry-pulse-core.mjs");
  assert.deepEqual(pulseAvatar({ type: "whatsapp", broker: { name: "Bruna", photo: "https://x/b.jpg", color: "#fff" } }), { kind: "icon", icon: "whatsapp" });
  assert.deepEqual(pulseAvatar({ type: "simulacao" }), { kind: "icon", icon: "simulacao" });
  assert.deepEqual(pulseAvatar({ type: "lead", broker: { name: "Bruna", photo: "https://x/b.jpg", color: "#ff9fb8" } }), { kind: "photo", url: "https://x/b.jpg", color: "#ff9fb8" });
  assert.deepEqual(pulseAvatar({ type: "chegada", broker: { name: "Bruna", photo: "", color: "#ff9fb8" } }), { kind: "initial", letter: "B", color: "#ff9fb8" });
});

test("Pulso no anel (v17): um arco que se alarga até ±0,4π e some em 1,4 s", async () => {
  const { HENRY_ORB_HIT_MS, orbHitArc } = await import("../components/henry/henry-orb-states.mjs");
  assert.equal(HENRY_ORB_HIT_MS, 1400);
  assert.ok(Math.abs(orbHitArc(0).half - Math.PI * 0.08) < 1e-9);
  assert.ok(Math.abs(orbHitArc(1).half - Math.PI * 0.4) < 1e-9);
  assert.equal(orbHitArc(0.06).alpha, 1, "bate forte logo no começo");
  assert.ok(orbHitArc(0.5).alpha < 0.5 && orbHitArc(0.5).alpha > 0);
  assert.equal(orbHitArc(1).alpha, 0, "some no fim");
  assert.equal(orbHitArc(0.3).bump, 0, "inchaço só no começo");
  assert.ok(orbHitArc(0.1).bump > 0);
});
