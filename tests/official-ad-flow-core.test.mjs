// Fluxo do anúncio no número Oficial (dono, 2026-11-10): saudação/gênero, janela 7–21, rodízio, temporizadores.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG, REPLY_IDS, STEPS, STATUSES, BUTTON_TITLES,
  buildFormLink, buildGreeting, buildGreetingMessage, buildLocationMessage, buildFollowUpButtons, buildMapsUrl, buildNudgeText, buildTransferNoticeText, buildOfferWaitText, buildNoOneAnsweredText, orderParticipants,
  decideInbound, decideStart, decideTimer, displayFirstName, generateFormToken, inferFirstNameGender,
  isWithinTransferWindow, normalizeConfig, pickNextParticipant
} from "../lib/official-ad-flow-core.mjs";
import { cleanSmsToken } from "../lib/sms-batch-token-core.mjs";

// Horários em UTC-3 (São Paulo não tem horário de verão desde 2019).
const at = (hhmm) => new Date(`2026-11-10T${hhmm}:00-03:00`);

test("config: sem linha = desligado, valores padrão e limites", () => {
  assert.equal(normalizeConfig(null).enabled, false);
  assert.equal(normalizeConfig(undefined).remindAfterMin, 2);
  assert.equal(normalizeConfig({}).transferAfterMin, 3);
  assert.deepEqual(normalizeConfig({}).suggestedPropertyNames, ["Ecovillage", "Terras de SP"]);
  assert.equal(normalizeConfig({ enabled: "true" }).enabled, false); // só true de verdade liga
  assert.equal(normalizeConfig({ remindAfterMin: 0 }).remindAfterMin, 1);
  assert.equal(normalizeConfig({ remindAfterMin: 999 }).remindAfterMin, 30);
  assert.equal(normalizeConfig({ windowStartHour: 22, windowEndHour: 5 }).windowStartHour, 7);
  assert.equal(normalizeConfig({}).windowEndHour, 20);
  assert.equal(normalizeConfig({}).offerTimeoutSec, 60);
  assert.deepEqual(normalizeConfig({}).generalRoulette, { enabled: false, askInsideWindow: false }); // 2º interruptor desligado
  assert.equal(normalizeConfig({ generalRoulette: { enabled: true } }).generalRoulette.enabled, true);
  assert.equal(normalizeConfig({ offerTimeoutSec: 1 }).offerTimeoutSec, 15); // janela inválida volta ao padrão
  assert.equal(normalizeConfig({ mapsUrl: "http://x" }).mapsUrl, ""); // só https
  const config = normalizeConfig({ participants: [{ userId: "a" }, { userId: "a" }, { userId: "b", enabled: false }, { userId: "" }] });
  assert.deepEqual(config.participants, [{ userId: "a", enabled: true }, { userId: "b", enabled: false }]);
});

test("gênero: só nome CLARAMENTE feminino/masculino; dúvida = null", () => {
  assert.equal(inferFirstNameGender("Ana Paula Souza"), "female");
  assert.equal(inferFirstNameGender("DIENIFER"), "female");
  assert.equal(inferFirstNameGender("Caroline Mayumi"), "female");
  assert.equal(inferFirstNameGender("Gabriel Silva"), "male");
  assert.equal(inferFirstNameGender("José"), "male");
  assert.equal(inferFirstNameGender("Andréia"), "female");
  assert.equal(inferFirstNameGender("Alex"), null); // ambíguo/fora da lista
  assert.equal(inferFirstNameGender("Jean"), null);
  assert.equal(inferFirstNameGender("😍😍"), null);
  assert.equal(inferFirstNameGender("G2f Corretora"), null);
  assert.equal(inferFirstNameGender("ana_bela_88"), null); // apelido
  assert.equal(inferFirstNameGender(""), null);
  assert.equal(inferFirstNameGender(null), null);
});

test("saudação: horário de São Paulo + tratamento só com gênero claro", () => {
  assert.equal(buildGreeting("Ana", at("08:00")), "Bom dia, minha amiga Ana!");
  assert.equal(buildGreeting("Gabriel", at("11:59")), "Bom dia, meu amigo Gabriel!");
  assert.equal(buildGreeting("gabriel", at("12:00")), "Boa tarde, meu amigo Gabriel!");
  assert.equal(buildGreeting("Ana", at("17:59")), "Boa tarde, minha amiga Ana!");
  assert.equal(buildGreeting("Ana", at("18:00")), "Boa noite, minha amiga Ana!");
  assert.equal(buildGreeting("Alex", at("09:00")), "Bom dia, Alex!"); // na dúvida: só o nome
  assert.equal(buildGreeting("😍", at("20:00")), "Boa noite!"); // sem nome: nenhum tratamento
  assert.equal(buildGreeting("", at("20:00")), "Boa noite!");
  assert.equal(displayFirstName("ANA PAULA"), "Ana");
});

test("horário de atendimento 07:00–20:00 (decide só a mensagem 'a partir das 8h' à noite)", () => {
  assert.equal(isWithinTransferWindow(at("06:59")), false);
  assert.equal(isWithinTransferWindow(at("07:00")), true);
  assert.equal(isWithinTransferWindow(at("19:59")), true);
  assert.equal(isWithinTransferWindow(at("20:00")), false);
  assert.equal(isWithinTransferWindow(at("20:59")), false);
  assert.equal(isWithinTransferWindow(at("23:30")), false);
});

test("avisos ao cliente: transferência, espera da oferta e ninguém respondeu à noite (8h)", () => {
  assert.match(buildTransferNoticeText({ profileName: "Ana" }), /^Ana, vou chamar um dos nossos associados/);
  assert.match(buildTransferNoticeText({ profileName: "Ana", noParticipants: true }), /assim que possível/);
  assert.match(buildOfferWaitText({ profileName: "Ana" }), /^Ana, só um instante/);
  assert.match(buildNoOneAnsweredText({ profileName: "Ana" }), /a partir das 8h/);
  assert.match(buildNoOneAnsweredText({ profileName: "" }), /^Nossos associados já estão fora do horário/);
});

test("rodízio: ordem, pula desligado/inelegível sem perder o lugar", () => {
  const participants = [{ userId: "g" }, { userId: "d" }, { userId: "c" }];
  const all = ["g", "d", "c"];
  assert.equal(pickNextParticipant({ participants, eligibleIds: all, lastPickedUserId: "" }), "g");
  assert.equal(pickNextParticipant({ participants, eligibleIds: all, lastPickedUserId: "g" }), "d");
  assert.equal(pickNextParticipant({ participants, eligibleIds: all, lastPickedUserId: "c" }), "g");
  assert.equal(pickNextParticipant({ participants, eligibleIds: ["g", "c"], lastPickedUserId: "g" }), "c"); // d inelegível
  assert.equal(pickNextParticipant({ participants: [{ userId: "g" }, { userId: "d", enabled: false }, { userId: "c" }], eligibleIds: all, lastPickedUserId: "g" }), "c");
  assert.equal(pickNextParticipant({ participants, eligibleIds: [], lastPickedUserId: "g" }), null);
  assert.equal(pickNextParticipant({ participants: [], eligibleIds: all }), null);
  assert.equal(pickNextParticipant({ participants, eligibleIds: ["g"], lastPickedUserId: "g" }), "g"); // único elegível pode repetir
  assert.equal(pickNextParticipant({ participants, eligibleIds: all, lastPickedUserId: "alguem-removido" }), "g");
  assert.deepEqual(orderParticipants({ participants, eligibleIds: all, lastPickedUserId: "g" }), ["d", "c", "g"]); // ordem da oferta
  assert.deepEqual(orderParticipants({ participants, eligibleIds: ["c", "g"], lastPickedUserId: "d" }), ["c", "g"]);
});

test("resposta do cliente: botões avançam; associado e texto livre transferem na hora; reação ignora", () => {
  assert.deepEqual(decideInbound({ replyId: REPLY_IDS.location }), { action: "step", step: STEPS.location });
  assert.deepEqual(decideInbound({ replyId: REPLY_IDS.values }), { action: "step", step: STEPS.values });
  assert.deepEqual(decideInbound({ replyId: REPLY_IDS.associate }), { action: "transfer", reason: "botao_associado" });
  assert.deepEqual(decideInbound({ messageType: "text" }), { action: "transfer", reason: "texto_livre" });
  assert.deepEqual(decideInbound({ messageType: "audio" }), { action: "transfer", reason: "texto_livre" });
  assert.deepEqual(decideInbound({ replyId: "fl:outro:fluxo:x", messageType: "interactive" }), { action: "transfer", reason: "texto_livre" });
  assert.deepEqual(decideInbound({ messageType: "reaction" }), { action: "ignore" });
});

test("temporizadores: cutuca 1x após 2 min; transfere 3 min depois da cutucada", () => {
  const config = normalizeConfig({ enabled: true });
  const base = { status: STATUSES.active, step_entered_at: at("10:00").toISOString(), nudged_at: null };
  assert.equal(decideTimer({ session: base, now: at("10:01"), config }).action, "none");
  assert.equal(decideTimer({ session: base, now: at("10:02"), config }).action, "nudge");
  const nudged = { ...base, nudged_at: at("10:02").toISOString() };
  assert.equal(decideTimer({ session: nudged, now: at("10:04"), config }).action, "none"); // nunca cutuca duas vezes
  assert.deepEqual(decideTimer({ session: nudged, now: at("10:05"), config }), { action: "transfer", reason: "sem_resposta" });
  // tempos configuráveis
  const custom = normalizeConfig({ remindAfterMin: 5, transferAfterMin: 1 });
  assert.equal(decideTimer({ session: base, now: at("10:04"), config: custom }).action, "none");
  assert.equal(decideTimer({ session: base, now: at("10:05"), config: custom }).action, "nudge");
  assert.equal(decideTimer({ session: nudged, now: at("10:03"), config: custom }).action, "transfer");
});

test("temporizadores: não cutuca quem está em conversa ou fora do fluxo", () => {
  const config = normalizeConfig({});
  const base = { status: STATUSES.active, step_entered_at: at("10:00").toISOString(), nudged_at: null };
  assert.equal(decideTimer({ session: base, now: at("10:30"), config, humanSpoke: true }).action, "stop");
  for (const status of [STATUSES.transferred, STATUSES.offering, STATUSES.offerExhausted, STATUSES.held, STATUSES.finished, STATUSES.stopped]) {
    assert.equal(decideTimer({ session: { ...base, status }, now: at("10:30"), config }).action, "none");
  }
  assert.equal(decideTimer({ session: null }).action, "none");
});

test("início: só anúncio + lead novo segurado, ligado, fora equipe/Não contactar/Particular", () => {
  const config = normalizeConfig({ enabled: true });
  const ok = { config, hasAdReferral: true, client: { distribution_type: "whatsapp_ad_waiting" }, conversation: {}, isTeamPhone: false, doNotContactReason: null, hasRecentSession: false };
  assert.deepEqual(decideStart(ok), { start: true, reason: "ok" });
  assert.equal(decideStart({ ...ok, config: normalizeConfig(null) }).reason, "desligado");
  assert.equal(decideStart({ ...ok, hasAdReferral: false }).reason, "sem_anuncio");
  assert.equal(decideStart({ ...ok, isTeamPhone: true }).reason, "numero_da_equipe");
  assert.equal(decideStart({ ...ok, doNotContactReason: "cliente_nao_contactar" }).reason, "nao_contactar");
  assert.equal(decideStart({ ...ok, conversation: { private_at: "x" } }).reason, "particular");
  assert.equal(decideStart({ ...ok, hasRecentSession: true }).reason, "ja_iniciado");
  assert.equal(decideStart({ ...ok, client: { distribution_type: "round_robin" } }).reason, "cliente_nao_e_lead_novo_do_anuncio");
  assert.equal(decideStart({ ...ok, client: null }).reason, "cliente_nao_e_lead_novo_do_anuncio");
});

test("mensagens: 3 botões com títulos de até 20 caracteres; cta_url com imagem; botões repetidos após a localização", () => {
  for (const title of Object.values(BUTTON_TITLES)) assert.ok(title.length <= 20, title);
  const greeting = buildGreetingMessage("Ana", at("09:00"));
  assert.equal(greeting.message.interactive.action.buttons.length, 3);
  assert.deepEqual(greeting.message.interactive.action.buttons.map((b) => b.reply.id), [REPLY_IDS.location, REPLY_IDS.values, REPLY_IDS.associate]);
  assert.match(greeting.text, /^Bom dia, minha amiga Ana!/);
  const location = buildLocationMessage({ imageUrl: "https://x/y.jpg", mapsUrl: "https://maps/x", propertyName: "Ecovillage" });
  assert.equal(location.message.interactive.type, "cta_url");
  assert.equal(location.message.interactive.header.image.link, "https://x/y.jpg");
  assert.equal(location.message.interactive.action.parameters.display_text, "Google Maps");
  assert.equal(buildLocationMessage({ mapsUrl: "https://maps/x" }).message.interactive.header, undefined);
  const after = buildFollowUpButtons(STEPS.location);
  assert.deepEqual(after.message.interactive.action.buttons.map((b) => b.reply.id), [REPLY_IDS.values, REPLY_IDS.associate]);
});

test("cutucada contextual por etapa", () => {
  assert.equal(buildNudgeText("Ana", STEPS.location), "Ana, ficou alguma dúvida sobre a localização?");
  assert.match(buildNudgeText("Ana", STEPS.values), /^Ana, conseguiu abrir o link/);
  assert.match(buildNudgeText("", STEPS.location), /^Ficou alguma dúvida sobre a localização\?/);
});

test("Google Maps e link do formulário", () => {
  assert.equal(buildMapsUrl({ mapsUrl: "https://maps/x", query: "a" }), "https://maps/x");
  assert.equal(buildMapsUrl({ query: "Ecovillage Marília" }), "https://www.google.com/maps/search/?api=1&query=Ecovillage%20Mar%C3%ADlia");
  assert.equal(buildMapsUrl({}), "");
  const token = generateFormToken();
  assert.equal(cleanSmsToken(token), token); // mesmo formato do sms_t
  const link = buildFormLink("https://www.exemplo.com.br/s", token);
  assert.match(link, /jornada=simulacao/);
  assert.ok(link.includes(`sms_t=${token}`));
});

test("configuração padrão não vem ligada", () => {
  assert.equal(DEFAULT_CONFIG.enabled, false);
});
