import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hiddenNavKeys, isEffectivelyBlocked, isWhatsappPathProtected } from "../lib/whatsapp-access-core.mjs";

// Controle individual de acesso aos recursos WhatsApp por corretor (pedido do dono, 2026-10-04).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");
const between = (code, from, to) => {
  const start = code.indexOf(from);
  assert.ok(start >= 0, `não achei: ${from}`);
  const end = to ? code.indexOf(to, start + from.length) : -1;
  return code.slice(start, end > 0 ? end : undefined);
};

test("B — rotas de WhatsApp protegidas para o corretor bloqueado (acesso direto pela URL/API é negado)", () => {
  for (const [p, method] of [
    ["/api/admin/whatsapp-chat/conversations", "GET"],
    ["/api/admin/whatsapp-chat/conversations/abc/messages", "POST"],
    ["/api/admin/whatsapp-chat/open-client", "POST"],
    ["/api/admin/whatsapp-individual/connect", "POST"],
    ["/api/admin/whatsapp-individual/status", "GET"],
    ["/api/admin/whatsapp-individual/disconnect", "POST"],
    ["/api/admin/whatsapp-individual/card-state", "GET"],
    ["/api/admin/whatsapp-individual/restriction", "POST"],
    ["/api/daily-goal", "GET"],
    ["/api/daily-goal/attempt", "POST"],
    ["/api/daily-goal/auto", "PATCH"],
    ["/api/daily-goal/message-override", "POST"],
    ["/api/prospecting/extra-dispatch", "GET"],
    ["/api/prospecting/6f1c2a", "POST"],
    ["/api/admin/client-documents/from-chat", "POST"]
  ]) {
    assert.equal(isWhatsappPathProtected(p, method), true, `${method} ${p}`);
  }
});

test("o que NÃO é recurso de WhatsApp fica livre (clientes, supervisão, ranking, bulk, configuração)", () => {
  for (const [p, method] of [
    ["/api/simulation-registrations/list", "GET"],
    ["/api/daily-goal/team-overview", "GET"],
    ["/api/daily-goal/top-ranking", "GET"],
    ["/api/daily-goal/settings", "GET"],
    ["/api/admin/daily-goal-auto", "GET"],
    ["/api/admin/daily-goal-auto/requeue", "POST"],
    ["/api/admin/whatsapp-access", "PATCH"],
    ["/api/admin/whatsapp-individual/restriction/team", "GET"],
    ["/api/admin/whatsapp-individual/restriction/validate", "POST"],
    ["/api/prospecting/bulk", "POST"],
    ["/api/prospecting/6f1c2a", "GET"],
    ["/api/prospecting/clients/abc", "POST"],
    ["/api/crm-notifications/new-client-alerts", "GET"]
  ]) {
    assert.equal(isWhatsappPathProtected(p, method), false, `${method} ${p}`);
  }
});

test("administrador geral nunca é bloqueado; a marca vale para corretor/associado/gestor", () => {
  assert.equal(isEffectivelyBlocked({ role: "admin", whatsappAccessBlocked: true }), false);
  assert.equal(isEffectivelyBlocked({ role: "broker", whatsappAccessBlocked: true }), true);
  assert.equal(isEffectivelyBlocked({ role: "manager", whatsappAccessBlocked: true }), true);
  assert.equal(isEffectivelyBlocked({ role: "broker", whatsappAccessBlocked: false }), false);
  assert.equal(isEffectivelyBlocked({ role: "broker" }), false, "sem a marca = liberado");
  assert.equal(isEffectivelyBlocked(null), false);
});

test("interface: itens do bloqueado NÃO são renderizados (Chat e Meta Diária do corretor); liberado vê tudo", () => {
  assert.deepEqual([...hiddenNavKeys({ blocked: false, isBrokerOrAssociate: true })], []);
  assert.deepEqual([...hiddenNavKeys({ blocked: true, isBrokerOrAssociate: true })].sort(), ["chat", "daily-goal"]);
  assert.deepEqual([...hiddenNavKeys({ blocked: true, isBrokerOrAssociate: false })], ["chat"], "gestor bloqueado mantém a Meta Diária de supervisão");
  assert.match(source("components/AdminMenu.jsx"), /hidden\.size \? groups\.map/);
  assert.match(source("components/AdminBottomNav.jsx"), /destinationsFor\(flags\)\.filter\(\(item\) => !hiddenKeys\.has\(item\.key\)\)/);
  const layout = source("app/admin/layout.jsx");
  assert.match(layout, /weeklyIndicator=\{whatsappBlocked \? null : <WhatsappIndividualStatus/);
  assert.match(layout, /<WhatsappAccessProvider blocked=\{whatsappBlocked\}>/);
  assert.match(source("components/clients/ClientCard.jsx"), /\{whatsappBlocked \? null : <Button/);
  assert.match(source("components/clients/ClientSheet.jsx"), /\{whatsappBlocked \? null : <Button/);
  assert.match(source("components/ProspectingManager.jsx"), /!readOnly && !whatsappBlocked \?/);
  assert.match(source("app/admin/chat/page.jsx"), /requireWhatsappAccessPage\(\)/);
  assert.match(source("app/admin/meta-diaria/page.jsx"), /if \(whatsappBlocked && !isOwner && !isTeamManager\) redirect\("\/admin\/simulacoes"\)/);
});

test("backend: barreira central na autenticação das APIs + toda rota protegida passa por ela", () => {
  const auth = source("lib/admin-auth.js");
  assert.match(between(auth, "export async function requireAdminApi(", "// BARREIRA CENTRAL"), /return applyWhatsappAccessGuard\(request, effectiveResult\);/);
  assert.match(between(auth, "function applyWhatsappAccessGuard(", "// Páginas do WhatsApp"), /status: 403/);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.js") files.push(full);
    }
  };
  walk(path.join(root, "app/api"));
  let checked = 0;
  for (const file of files) {
    const url = "/" + path.relative(root, path.dirname(file)).split(path.sep).slice(1).join("/").replace(/\[[^\]]+\]/g, "abc");
    const code = readFileSync(file, "utf8");
    if (["GET", "POST", "PATCH", "PUT", "DELETE"].some((method) => isWhatsappPathProtected(url, method))) {
      checked += 1;
      assert.match(code, /requireAdminApi\(|requireBrokerManagementApi\(|requirePerformanceApi\(/, `${url} precisa passar pela barreira central`);
    }
  }
  assert.ok(checked >= 20, `esperava varrer as rotas de WhatsApp (achei ${checked})`);
});

test("backend: conexão/QR/envio/reação/edição/exclusão da sessão têm a barreira final", () => {
  const code = source("lib/whatsapp-individual.js");
  for (const fn of ["connectIndividualSession(userId, phoneNumber)", "sendIndividualMessage(userId, {", "reactIndividualMessage(userId", "editIndividualMessage(userId", "deleteIndividualMessageForEveryone(userId"]) {
    const start = code.indexOf(`export async function ${fn}`);
    assert.ok(start >= 0, fn);
    assert.match(code.slice(start, start + 400), /await assertWhatsappAccessAllowed\(userId\);/, fn);
  }
  assert.doesNotMatch(between(code, "export async function disconnectIndividualSession", "export async function fetchIndividualSessionStatusFromService"), /assertWhatsappAccessAllowed/);
});

test("cron/automação: bloqueado é ignorado ANTES de gerar/reservar e o envio atrasado volta intacto", () => {
  const auto = source("lib/daily-goal-auto.js");
  const cycle = between(auto, "const accessBlockedIds = await listWhatsappBlockedUserIds();", "const result = await dispatchOneForBroker");
  assert.match(cycle, /if \(accessBlockedIds\.has\(brokerId\)\) return \{ brokerId, skipped: "acesso_whatsapp_bloqueado" \};/);
  assert.ok(cycle.indexOf("acesso_whatsapp_bloqueado") < cycle.indexOf("ensureDailyGoalGeneratedForBroker"), "antes de gerar");
  assert.ok(cycle.indexOf("acesso_whatsapp_bloqueado") < cycle.indexOf("enqueueTodayItemsForBroker"), "antes de enfileirar/claimar");
  const failure = between(auto, "async function handleSendFailure(", "const kind = classifySendError(sendError);");
  assert.match(failure, /WHATSAPP_ACCESS_BLOCKED_CODE/);
  assert.match(failure, /markItem\(item\.id, \{ status: "pending", send_started_at: null \}\)/);
  assert.doesNotMatch(failure.replace(/\/\/.*$/gm, ""), /pauseBrokerAfterErrors|attempts_count|auto_error_count|consecutive_errors/);
});

test("retomada sem acúmulo: ao LIBERAR a fila é reprogramada ANTES de a marca virar; bloquear não toca em nada", () => {
  const access = source("lib/whatsapp-access.js");
  const setter = between(access, "export async function setWhatsappAccessBlocked(", undefined);
  const resumeAt = setter.indexOf("resumeBrokerQueueAfterUnblock(brokerId)");
  assert.ok(resumeAt > 0 && resumeAt < setter.indexOf(".update({ whatsapp_access_blocked: blocked"), "reprograma antes de liberar");
  assert.match(setter, /if \(!blocked\) \{/);
  assert.match(setter, /from\("whatsapp_access_audit"\)\.insert\(\{/);
  assert.match(setter, /previous_blocked: previous/);
  assert.match(setter, /new_blocked: blocked/);
  assert.match(setter, /changed_by: actor\.id/);
  assert.match(setter, /assertGeneralAdmin\(auth\)/, "o corretor nunca altera a própria permissão");
  const code = access.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /disconnect|session_creds|\.delete\(|daily_goal_auto_queue|simulation_registrations|whatsapp_messages|whatsapp_individual_sessions/i);
  const auto = source("lib/daily-goal-auto.js");
  const resume = between(auto, "export async function resumeBrokerQueueAfterUnblock(", "// Exceção pontual");
  assert.match(resume, /!settingsRow\?\.enabled \|\| settingsRow\.paused/, "não liga/desliga automação de ninguém");
  assert.match(resume, /requeueBrokerQueueCore\(brokerId, settingsRow, broker, "reordenado_apos_desbloqueio"\)/);
});

test("estado inicial: todos LIBERADOS — migration aditiva, default false, sem UPDATE em corretor", () => {
  const sql = source("supabase/migrations/20261004190000_whatsapp_access_control.sql");
  assert.match(sql, /add column if not exists whatsapp_access_blocked boolean not null default false/);
  assert.match(sql, /create table if not exists public\.whatsapp_access_audit/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\bupdate\s+public\.admin_users|\bdelete\s+from|\bdrop\s/i);
});

test("administração: switch no card (Liberado/Bloqueado) chama a API que persiste e audita", () => {
  const card = source("components/TeamDailyPerformance.jsx");
  assert.match(card, /Acesso WhatsApp/);
  assert.match(card, /\{blocked \? "Bloqueado" : "Liberado"\}/);
  assert.match(card, /fetch\("\/api\/admin\/whatsapp-access", \{\s*method: "PATCH"/);
  assert.match(card, /automation\?\.whatsappAccessControllable \? \(/);
  assert.match(source("app/api/admin/whatsapp-access/route.js"), /setWhatsappAccessBlocked\(auth,/);
  assert.match(source("lib/daily-goal-auto.js"), /whatsappAccessBlocked: broker\.whatsapp_access_blocked === true/);
});
