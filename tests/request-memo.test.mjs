// Memória por requisição da Meta Diária do administrador (2026-10-06).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoInRequest, runWithRequestMemo } from "../lib/request-memo.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("dentro da requisição, a mesma chave executa UMA vez (mesmo concorrente) e chaves diferentes não se misturam", async () => {
  let calls = 0;
  const load = (value) => async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return value; };
  const result = await runWithRequestMemo(async () => {
    const [a, b, c] = await Promise.all([memoInRequest("k1", load(1)), memoInRequest("k1", load(99)), memoInRequest("k2", load(2))]);
    const again = await memoInRequest("k1", load(77));
    return [a, b, c, again];
  });
  assert.deepEqual(result, [1, 1, 2, 1]);
  assert.equal(calls, 2);
});

test("fora de uma requisição com memória nada é guardado (nunca há dado velho entre requisições)", async () => {
  let calls = 0;
  const load = async () => { calls += 1; return calls; };
  assert.equal(await memoInRequest("k", load), 1);
  assert.equal(await memoInRequest("k", load), 2);
  await runWithRequestMemo(() => memoInRequest("k", load));
  await runWithRequestMemo(() => memoInRequest("k", load));
  assert.equal(calls, 4, "cada requisição calcula a sua");
});

test("erro não fica guardado: a próxima chamada tenta de novo", async () => {
  let calls = 0;
  await runWithRequestMemo(async () => {
    await assert.rejects(() => memoInRequest("e", async () => { calls += 1; throw new Error("falha"); }), /falha/);
    assert.equal(await memoInRequest("e", async () => { calls += 1; return "ok"; }), "ok");
  });
  assert.equal(calls, 2);
});

test("Meta Diária do administrador: memória por requisição, só quem aparece na lista e etapas em paralelo", () => {
  const goal = read("lib/daily-goal.js");
  assert.ok(goal.includes("return runWithRequestMemo(async () => {"));
  assert.ok(goal.includes('profile.id && profile.status !== "inactive" && !isOwnerAdminEmail(profile.email)).map((profile) => profile.id);'));
  assert.ok(goal.includes("const [walletEntries, pendingEntries] = await Promise.all([walletPromise, pendingPromise]);"));
  const wallet = read("lib/daily-goal-wallet.js");
  assert.ok(wallet.includes("memoInRequest(`wallet-day:${brokerId}:${day}`"));
  assert.ok(wallet.includes("memoInRequest(`wallet-config:${brokerId}`"));
});
