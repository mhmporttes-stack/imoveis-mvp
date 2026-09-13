import test from "node:test";
import assert from "node:assert/strict";
const base = process.env.JOURNEY_TEST_BASE || "http://localhost:3107";
const token = process.env.JOURNEY_TEST_TOKEN;
test("public journey is available without authentication and contains only safe presentation data", { skip: !token }, async () => {
  const response = await fetch(`${base}/minha-jornada/${token}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const html = await response.text();
  for (const field of ["primary_monthly_income", "phone_normalized", "internal_note", "responsible_user_id", "oldest_birth_date", "acquisition_context", "SUPABASE_SERVICE_ROLE_KEY"]) assert.ok(!html.includes(field), field);
  assert.ok(!html.includes("João Jornada QA"));
  assert.match(html, /no-referrer/);
});
test("predictable identifiers and invalid random tokens do not expose clients", async () => {
  for (const invalid of ["C1001", "1", "a".repeat(64)]) assert.equal((await fetch(`${base}/minha-jornada/${invalid}`)).status, 404);
});
test("administrative journey endpoints require a real authenticated session", async () => {
  const id = "00000000-0000-0000-0000-000000000000";
  for (const [path, method, body] of [[`/api/client-journey/${id}`, "GET"], [`/api/client-journey/${id}`, "POST", { action: "regenerate" }], ["/api/client-journey/settings", "PUT", {}]]) {
    const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.status, 401);
  }
});
