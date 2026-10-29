// 1.10.0 (EXT-1, dono, 2026-10-29): tela "Extensões" do CRM — Parar tudo, limites da publicação, sinal de saúde,
// área de mensagens só pelo seletor genérico = parar e avisar, nenhum erro engolido em silêncio.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideTick, initialState, isWithinWindow, publishLimits, startJob, finishJob } from "../lib/agenda.js";
import { decideChatTick } from "../lib/chat-agenda.js";
import { SIGNALED_SKIPS } from "../lib/round-status.js";
import { criarLigacaoCrm, limparTexto } from "../lib/crm-link.js";

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const at = (hhmm) => new Date(`2026-10-20T${hhmm}:00-03:00`);

test("Parar tudo do CRM vence qualquer outra decisão (publicação e chat) e avisa o CRM", () => {
  assert.equal(decideTick(initialState(), at("10:00"), { stoppedByCrm: true }).reason, "parado_crm");
  assert.equal(decideChatTick({ state: initialState(), settings: {}, now: at("10:00"), stoppedByCrm: true }).reason, "parado_crm");
  assert.ok(SIGNALED_SKIPS.has("parado_crm"));
});

test("limites da publicação vindos do CRM: horário e quantidade; lixo volta ao padrão", () => {
  assert.deepEqual(publishLimits(), { dailyLimit: 3, startHour: 8, endHour: 20 });
  assert.deepEqual(publishLimits({ publishPerDay: 5, publishStartHour: 9, publishEndHour: 18 }), { dailyLimit: 5, startHour: 9, endHour: 18 });
  assert.deepEqual(publishLimits({ publishPerDay: 99, publishStartHour: 20, publishEndHour: 9 }), { dailyLimit: 10, startHour: 8, endHour: 20 });
  assert.equal(isWithinWindow(at("08:30"), { publishStartHour: 9, publishEndHour: 18 }), false);
  let state = initialState();
  for (let i = 0; i < 3; i += 1) state = finishJob(startJob(state, { id: `a${i}`, title: "x" }, at("10:00")), { ok: true }, at("10:00"), () => 0);
  state = { ...state, nextAllowedAt: null };
  assert.equal(decideTick(state, at("11:00")).reason, "limite_diario");
  assert.equal(decideTick(state, at("11:00"), { limits: { publishPerDay: 5 } }).action, "check");
});

test("crm-link: estado com cache curto; CRM fora do ar mantém o último estado (inclusive parado)", async () => {
  let agora = 1_000_000;
  let resposta = { status: 200, body: { stopped: true, config: { publishPerDay: 4 }, latestVersion: "9.9.9", outdated: true, downloadUrl: "https://crm/x" } };
  const chamadas = [];
  let guardado = null;
  const link = criarLigacaoCrm({
    fetchImpl: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      if (resposta === "rede") throw new Error("offline");
      return { ok: resposta.status < 400, status: resposta.status, json: async () => resposta.body };
    },
    ler: async () => guardado,
    gravar: async (v) => { guardado = structuredClone(v); },
    config: async () => ({ baseUrl: "https://crm.exemplo.com.br", key: "mkp_teste", version: "1.10.0" }),
    agora: () => agora
  });
  const e1 = await link.estado();
  assert.equal(e1.stopped, true);
  assert.equal(chamadas[0].url, "https://crm.exemplo.com.br/api/extensoes/estado");
  assert.equal(chamadas[0].opcoes.headers.Authorization, "Bearer mkp_teste");
  assert.equal(chamadas[0].opcoes.headers["X-Extension-Version"], "1.10.0");
  await link.estado();
  assert.equal(chamadas.length, 1, "cache de 10 s");
  agora += 11_000;
  resposta = "rede";
  const e2 = await link.estado();
  assert.equal(e2.stopped, true);
  assert.equal(e2.origem, "cache");
});

test("crm-link: sem chave não chama o CRM e nunca inventa 'parado'", async () => {
  let chamou = false;
  const link = criarLigacaoCrm({ fetchImpl: async () => { chamou = true; }, ler: async () => null, gravar: async () => {}, config: async () => ({ key: "" }) });
  const e = await link.estado();
  assert.equal(e.stopped, false);
  assert.equal(e.origem, "sem_chave");
  assert.equal(chamou, false);
});

test("crm-link: saúde leva erros, seletores e falhas engolidas das últimas 24 h, sem dado de terceiros", async () => {
  const enviados = [];
  let guardado = null;
  let agora = Date.parse("2026-10-29T12:00:00Z");
  const link = criarLigacaoCrm({
    fetchImpl: async (url, opcoes) => { enviados.push(JSON.parse(opcoes.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
    ler: async () => guardado,
    gravar: async (v) => { guardado = structuredClone(v); },
    config: async () => ({ key: "mkp_teste", version: "1.10.0" }),
    agora: () => agora
  });
  await link.registrarErro("chat", "Falhou ao responder @maria.silva no https://facebook.com/x (11) 99999-8888 joao@ex.com");
  await link.registrarSeletor("inbox.messageArea", "só genérico");
  link.engolido("fechar aba")(new Error("No tab with id: 3"));
  await new Promise((r) => setTimeout(r, 10));
  const r = await link.enviarSaude({ ok: false, stage: "chat_erro", error: "x", today: { publish: { done: 1, limit: 3 } } });
  assert.equal(r.enviado, true);
  const corpo = enviados[0];
  assert.equal(corpo.errors.length, 1);
  assert.doesNotMatch(corpo.errors[0].text, /maria|99999|joao@|facebook\.com/);
  assert.equal(corpo.selectorFailures[0].name, "inbox.messageArea");
  assert.equal(corpo.swallowed[0].context, "fechar aba");
  assert.deepEqual(corpo.today, { publish: { done: 1, limit: 3 } });
  // rodada ok logo depois: respeita o intervalo de 2 min
  assert.equal((await link.enviarSaude({ ok: true })).enviado, false);
  agora += 25 * 60 * 60 * 1000;
  await link.enviarSaude({ ok: false });
  assert.equal(enviados[1].errors.length, 0, "erro de mais de 24 h sai do sinal");
  assert.equal(limparTexto("@fulano"), "@…");
});

test("área de mensagens só pelo seletor genérico: para e avisa (nunca lê a página inteira)", () => {
  const selectors = ler("../selectors.js");
  const area = selectors.match(/messageArea: '([^']+)'/)[1];
  assert.doesNotMatch(area.split(",").map((s) => s.trim()).join("|"), /(^|\|)\[role="main"\](\||$)/);
  assert.match(selectors, /messageAreaGeneric: '\[role="main"\]'/);
  const inbox = ler("../inbox.js");
  assert.match(inbox, /if \(!area && !win && document\.querySelector\(MP\.inbox\.messageAreaGeneric\)\) \{\s*\/\/[^\n]*\n\s*return \{ ok: false, selectorFailed: "inbox\.messageArea"/);
  assert.match(ler("../background.js"), /if \(read\?\.selectorFailed\) await crmLink\.registrarSeletor/);
});

test("nenhum .catch(() => {}) engolindo erro em silêncio; crm-link é cópia idêntica nas duas extensões", () => {
  for (const arquivo of ["../background.js", "../content.js", "../options.js", "../inbox.js", "../popup.js", "../lib/page-awake.js"]) {
    assert.doesNotMatch(ler(arquivo), /\.catch\(\(\) => \{\}\)/, arquivo);
  }
  assert.equal(ler("../lib/crm-link.js"), ler("../../instagram-seguidor/lib/crm-link.js"));
});

test("Parar tudo é conferido antes de cada conversa e de cada envio do chat", () => {
  const bg = ler("../background.js");
  assert.match(bg, /for \(const \[index, thread\] of toRead\.entries\(\)\) \{\s*\/\/[^\n]*\n\s*if \(await stoppedByCrm\(\)\)/);
  assert.match(bg, /for \(let i = 0; i < MAX_SENDS_PER_ROUND; \) \{\s*\/\/[^\n]*\n\s*if \(await stoppedByCrm\(\)\)/);
  assert.match(bg, /decideTick\(state, new Date\(\), \{ chatBusy: await chatBusy\(\), stoppedByCrm: runtime\.stopped === true, limits: runtime\.config \|\| \{\} \}\)/);
});
