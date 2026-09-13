// Opt-in integration test: creates and removes a temporary non-distributing user.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
if (!process.env.JOURNEY_QA_CLIENT_ID) throw new Error("Set JOURNEY_QA_CLIENT_ID to an isolated test client.");
const id = process.env.JOURNEY_QA_CLIENT_ID;
const base = process.env.JOURNEY_TEST_BASE || "http://localhost:3107";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = r => { if (r.error) throw r.error; return r.data; };
const email = `journey-qa-${randomUUID()}@example.com`;
const password = `${randomUUID()}Aa!9`;
let user, profile;
try {
  const client = checked(await db.from("simulation_registrations").select("full_name").eq("id", id).single());
  assert.match(client.full_name, /Jornada QA/);
  user = checked(await db.auth.admin.createUser({ email, password, email_confirm: true })).user;
  profile = checked(await db.from("admin_users").insert({ auth_user_id: user.id, email, name: "Jornada QA temporário", role: "manager", status: "active", phone: "11999998888", lead_distribution_enabled: false }).select("id").single());
  checked(await db.from("simulation_registrations").update({ responsible_user_id: profile.id, status: "completed" }).eq("id", id));
  checked(await db.from("client_journeys").update({ progress: 40, previous_progress: 40, current_status: "completed" }).eq("client_id", id));
  const authClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { session } = checked(await authClient.auth.signInWithPassword({ email, password }));
  const login = await fetch(`${base}/api/admin/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token, refreshToken: session.refresh_token }) });
  assert.equal(login.status, 200, "App session login");
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const request = (path, method = "GET", body) => fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  assert.equal((await request("/admin/minha-jornada")).status, 200, "Manager configuration page");
  const path = `/api/client-journey/${id}`;
  let response = await request(path);
  assert.equal(response.status, 200);
  const initial = await response.json();
  const unrelated = checked(await db.from("simulation_registrations").select("id").neq("id", id).not("responsible_user_id", "is", null).limit(1))[0];
  if (unrelated) assert.equal((await request(`/api/client-journey/${unrelated.id}`)).status, 403, "Manager scope");
  response = await request(`/api/simulation-registrations/${id}`, "PATCH", { status: "approval_pending" });
  assert.equal(response.status, 200);
  const changed = await (await request(path)).json();
  assert.equal(changed.state.progress, 65);
  assert.equal(changed.state.previous_progress, 40);
  response = await request(path, "POST", { action: "notify" });
  assert.equal(response.status, 200);
  const notified = await response.json();
  assert.match(notified.whatsappUrl, /^https:\/\/wa.me\/5511999990000/);
  assert.ok(decodeURIComponent(notified.whatsappUrl).includes(initial.url));
  assert.equal(notified.state.notified_version, notified.state.version);
  assert.equal(notified.state.changed_at, changed.state.changed_at);
  assert.ok(notified.events.some(event => event.event_type === "notify" && event.actor === email));
  response = await request(path, "POST", { action: "regenerate" });
  assert.equal(response.status, 200);
  const regenerated = await response.json();
  assert.notEqual(regenerated.url, initial.url);
  assert.equal((await fetch(`${base}/minha-jornada/${initial.url.split("/").at(-1)}`)).status, 404);
  checked(await db.from("admin_users").update({ role: "broker" }).eq("id", profile.id));
  assert.equal((await request(path)).status, 200, "Broker own client");
  assert.equal((await request(path, "POST", { action: "regenerate" })).status, 403, "Broker cannot regenerate");
  assert.equal((await request("/api/client-journey/settings", "PUT", {})).status, 403, "Broker cannot edit configuration");
  assert.equal((await request(path, "POST", { action: "notify" })).status, 200, "Broker can notify");
  console.log("PASS: authenticated manager/broker scope, status capture, notice URL/audit, token regeneration, configuration permissions.");
} finally {
  if (profile) {
    checked(await db.from("simulation_registrations").update({ responsible_user_id: null }).eq("id", id));
    checked(await db.from("admin_users").delete().eq("id", profile.id));
  }
  if (user) checked(await db.auth.admin.deleteUser(user.id));
}
