import test from "node:test";
import assert from "node:assert/strict";

import { fetchWithTimeout } from "../lib/fetch-with-timeout.mjs";

test("GET tenta de novo uma vez quando a conexão falha", async () => {
  let calls = 0;
  const impl = async () => { calls += 1; if (calls === 1) throw new Error("socket closed"); return "ok"; };
  assert.equal(await fetchWithTimeout("u", { method: "GET" }, impl), "ok");
  assert.equal(calls, 2);
});

test("escrita nunca é repetida", async () => {
  let calls = 0;
  const impl = async () => { calls += 1; throw new Error("x"); };
  await assert.rejects(fetchWithTimeout("u", { method: "POST" }, impl));
  assert.equal(calls, 1);
});
