import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AWAKE_OFF, AWAKE_ON, createAwakeManager } from "../lib/page-awake.js";
import { SIGNALED_SKIPS, roundStatus } from "../lib/round-status.js";

// 1.9.8 (dono, 25/10/2026): "abro outra janela para utilizar, em tela cheia; as duas abas das extensões ficam abertas atrás".

function fakeDebugger({ failAttach = false, failFocus = false } = {}) {
  const calls = [];
  return {
    calls,
    attach: async (tabId) => {
      calls.push(["attach", tabId]);
      if (failAttach) throw new Error("Another debugger is already attached");
    },
    detach: async (tabId) => calls.push(["detach", tabId]),
    send: async (tabId, method, params) => {
      calls.push([method, tabId, params]);
      if (failFocus && method === "Emulation.setFocusEmulationEnabled" && params.enabled) throw new Error("falhou");
    }
  };
}

test("emulação de foco: liga o depurador só durante a ação, emula foco, nunca traz a janela para a frente, solta no fim", async () => {
  const dbg = fakeDebugger();
  const awake = createAwakeManager(dbg);
  const seen = await awake.run(7, async (info) => {
    assert.equal(awake.isAttached(7), true);
    return info;
  });
  assert.deepEqual(seen, { attached: true, awake: true, error: "" });
  assert.equal(awake.isAttached(7), false);
  assert.deepEqual(dbg.calls.map((call) => call[0]), ["attach", "Emulation.setFocusEmulationEnabled", "Page.setWebLifecycleState", "Emulation.setFocusEmulationEnabled", "detach"]);
  assert.deepEqual(dbg.calls[1][2], { enabled: true });
  assert.deepEqual(dbg.calls[3][2], { enabled: false });
  for (const command of [...AWAKE_ON, ...AWAKE_OFF]) assert.doesNotMatch(command.method, /bringToFront|activateTarget/);
});

test("ações aninhadas ligam uma vez; erro na ação também solta o depurador", async () => {
  const dbg = fakeDebugger();
  const awake = createAwakeManager(dbg);
  await awake.run(1, () => awake.run(1, async () => {}));
  assert.equal(dbg.calls.filter((call) => call[0] === "attach").length, 1);
  assert.equal(dbg.calls.filter((call) => call[0] === "detach").length, 1);
  await assert.rejects(awake.run(2, async () => { throw new Error("falhou no meio"); }), /falhou no meio/);
  assert.equal(awake.isAttached(2), false);
  assert.deepEqual(dbg.calls.at(-1), ["detach", 2]);
});

test("depurador recusado (DevTools aberto) ou emulação recusada: a ação roda e recebe o motivo", async () => {
  const refused = createAwakeManager(fakeDebugger({ failAttach: true }));
  const info = await refused.run(3, async (value) => value);
  assert.equal(info.awake, false);
  assert.match(info.error, /depurador não ligou/);
  const noFocus = createAwakeManager(fakeDebugger({ failFocus: true }));
  const info2 = await noFocus.run(4, async (value) => value);
  assert.equal(info2.attached, true);
  assert.equal(info2.awake, false);
  assert.match(info2.error, /emulação de foco falhou/);
});

test("release forçado (etapa abandonada pelo prazo): a ação antiga que termina tarde não solta a nova", async () => {
  const dbg = fakeDebugger();
  const awake = createAwakeManager(dbg);
  let finishOld;
  const old = awake.run(5, () => new Promise((resolve) => { finishOld = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await awake.release(5);
  assert.equal(awake.isAttached(5), false);
  let during = null;
  const fresh = awake.run(5, async () => {
    finishOld();
    await old;
    during = awake.isAttached(5);
  });
  await fresh;
  assert.equal(during, true, "a ação nova continua com o depurador depois que a antiga terminou");
  assert.equal(awake.isAttached(5), false);
});

test("estado da rodada que vai ao CRM: nunca silêncio, sempre com motivo", () => {
  assert.deepEqual(roundStatus({ result: "lendo" }), { ok: true, stage: "lendo", error: "" });
  assert.equal(roundStatus({ inboxError: "Caixa do Marketplace não lida: Etapa passou de 180 s" }).stage, "caixa");
  assert.equal(roundStatus({ hidden: "O Chrome não está mostrando a aba" }).ok, false);
  assert.equal(roundStatus({ fatalError: "No tab with id: 12" }).stage, "rodada");
  assert.deepEqual(roundStatus({ skipReason: "pausado", skipDetail: "Extensão pausada no popup" }), { ok: false, stage: "pausado", error: "Extensão pausada no popup" });
  assert.equal(roundStatus({ fatalError: "x".repeat(900) }).error.length, 300);
  assert.ok(SIGNALED_SKIPS.has("pausa_verificacao") && !SIGNALED_SKIPS.has("chat_fora_do_horario"));
});

test("background 1.9.8: toda ação no Facebook passa pela emulação; falha na caixa não pula o CRM nem os envios", () => {
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.doesNotMatch(bg, /attachDebugger|detachDebugger|attachedTabs/);
  assert.doesNotMatch(bg, /bringToFront/);
  assert.match(bg, /withAwakePage\(tab\.id, \(\) => readInbox\(tab\.id\)\)/);
  assert.match(bg, /withAwakePage\(tab\.id, \(awakeInfo\) => readThread\(/);
  assert.match(bg, /withAwakePage\(tabId, \(awakeInfo\) => sendOnPage\(/);
  assert.match(bg, /withAwakePage\(tab\.id, \(\) => publishOnTab\(/);
  const tick = bg.slice(bg.indexOf("async function chatTick("), bg.indexOf("// --- Diagnóstico de estrutura"));
  // Caixa não lida: registra e segue (não relança), chama o CRM com o motivo e depois tenta as respostas.
  assert.match(tick, /inboxError = `Caixa do Marketplace não lida: /);
  assert.ok(tick.indexOf("if (!posted || !status.ok)") < tick.indexOf("fetchNextOutbound(config)"));
  // Rodada que morreu antes de falar com o CRM manda o sinal no finally.
  assert.match(tick, /if \(!signaled && !\(fatal instanceof ChatLockLost\)/);
  assert.match(bg, /SIGNALED_SKIPS\.has\(decision\.reason\)\) await signalSkip/);
  // Ao fim da rodada nenhum depurador fica ligado.
  assert.match(tick, /if \(tab\) await awake\.release\(tab\.id\)/);
});
