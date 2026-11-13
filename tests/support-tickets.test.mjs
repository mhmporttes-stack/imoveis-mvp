// Ajuda e chamados (dono, 2026-11-13): contexto, texto copiado, visibilidade só-dono, anexos, anti-spam, guards e migration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SUPPORT_COPY_INSTRUCTION,
  TICKET_IMAGE_MAX_BYTES,
  TICKET_IMAGES_TOTAL_MAX_BYTES,
  TICKET_MAX_IMAGES,
  addTicketImages,
  buildReplyNotice,
  buildTicketContext,
  canReadSupportTicket,
  canSeeSupportQueue,
  checkTicketRateLimit,
  formatTicketText,
  normalizePathname,
  sanitizeErrorList,
  scrubSensitive,
  summarizeDevice,
  validateTicketDescription,
  validateTicketImages,
  validateTicketReply
} from "../lib/support-tickets-core.mjs";
import { NOTIFICATION_KIND, isNotificationAllowed } from "../lib/notification-policy-core.mjs";
import { createErrorBuffer } from "../components/support/support-error-buffer.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("contexto: usuário vem da sessão, tela sem consulta/ids, aparelho resumido, erros limpos e limitados a 5", () => {
  const context = buildTicketContext({
    user: { id: "u1", name: "Carol", role: "broker", viaAccountSwitch: true, realId: "owner", realName: "Matheus" },
    client: {
      pathname: "/admin/simulacoes/11111111-2222-3333-4444-555555555555?clientId=abc&phone=11999998888",
      title: "Clientes",
      userAgent: IPHONE,
      viewport: { width: 390, height: 844 },
      errors: Array.from({ length: 8 }, (_, index) => ({ kind: "error", message: `falha ${index} fulano@x.com 11999998888`, at: 1000 + index }))
    },
    now: new Date("2026-11-13T15:00:00Z")
  });
  assert.equal(context.user.roleLabel, "Corretor");
  assert.equal(context.user.viaAccountSwitch, true);
  assert.equal(context.user.realName, "Matheus");
  assert.equal(context.screen.path, "/admin/simulacoes/:id");
  assert.equal(context.device.summary, "iPhone · Safari");
  assert.equal(context.device.viewport, "390x844");
  assert.equal(context.timeZone, "America/Sao_Paulo");
  assert.equal(context.errors.length, 5);
  assert.ok(context.errors.every((entry) => !/@|11999998888/.test(entry.message)));
  // sem "Alterar conta" o real não é gravado
  assert.equal(buildTicketContext({ user: { id: "u1", name: "A", role: "admin", realId: "x", realName: "Y" } }).user.realId, "");
});

test("privacidade: e-mail, CPF, telefone, número longo, código e id somem do texto de erro", () => {
  const out = scrubSensitive("erro em joao@x.com cpf 123.456.789-09 tel (11) 99999-8888 id 123456789 token abcdefghijklmnopqrstuvwxyz0123 uuid 11111111-2222-3333-4444-555555555555");
  for (const raw of ["joao@x.com", "123.456.789-09", "99999-8888", "123456789", "abcdefghijklmnopqrstuvwxyz0123", "11111111-2222"]) assert.ok(!out.includes(raw), raw);
  assert.ok(scrubSensitive("x".repeat(500), 160).length <= 160);
  assert.equal(normalizePathname("/admin/chat?cliente=1#a"), "/admin/chat");
  assert.deepEqual(sanitizeErrorList("nada"), []);
});

test("buffer de erros guarda só os últimos 5 e só em memória", () => {
  const buffer = createErrorBuffer(5);
  for (let index = 0; index < 9; index += 1) buffer.push("error", `e${index}`);
  buffer.push("promise", "");
  assert.deepEqual(buffer.list().map((entry) => entry.message), ["e4", "e5", "e6", "e7", "e8"]);
  assert.equal(buffer.list()[0].kind, "error");
});

test("texto copiado: perfil, tela, horário de Brasília, aparelho, erros, descrição e a instrução final fixa", () => {
  const context = buildTicketContext({
    user: { id: "u1", name: "Carol", role: "broker" },
    client: { pathname: "/admin/chat", title: "Chat", userAgent: IPHONE, viewport: { width: 390, height: 844 }, errors: [{ kind: "promise", message: "Failed to fetch", at: 1 }] }
  });
  const text = formatTicketText({ created_at: "2026-11-13T15:30:00Z", description: "A tela trava ao salvar.", context });
  assert.match(text, /^Corretor: Carol/);
  assert.match(text, /Perfil: Corretor/);
  assert.match(text, /Tela: Chat — \/admin\/chat/);
  assert.match(text, /Horário: 13\/11\/2026 às 12:30 \(Brasília\)/);
  assert.match(text, /Aparelho: iPhone · Safari \(390x844\)/);
  assert.match(text, /- \[promessa rejeitada\] Failed to fetch/);
  assert.match(text, /A tela trava ao salvar\./);
  assert.ok(text.trim().endsWith(SUPPORT_COPY_INSTRUCTION));
  assert.match(SUPPORT_COPY_INSTRUCTION, /^Investigue no CRM\/banco se necessário e responda ao corretor em linguagem simples, curta e pronta para colar/);
  assert.match(formatTicketText({ description: "x", context: {} }), /- nenhum registrado/);
  assert.match(summarizeDevice("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537"), /Windows · Chrome/);
});

test("fila: SÓ o dono na conta real; gestor, corretor e 'Alterar conta' nunca; o autor lê só o próprio", () => {
  assert.equal(canSeeSupportQueue({ isOwner: true, accountSwitchMode: false }), true);
  assert.equal(canSeeSupportQueue({ isOwner: true, accountSwitchMode: true }), false);
  assert.equal(canSeeSupportQueue({ isOwner: false, accountSwitchMode: false }), false);
  assert.equal(canSeeSupportQueue(), false);
  const ticket = { created_by: "autor" };
  assert.equal(canReadSupportTicket({ viewerId: "autor", queueViewer: false, ticket }), true);
  assert.equal(canReadSupportTicket({ viewerId: "gestor", queueViewer: false, ticket }), false);
  assert.equal(canReadSupportTicket({ viewerId: "", queueViewer: false, ticket }), false);
  assert.equal(canReadSupportTicket({ viewerId: "dono", queueViewer: true, ticket }), true);
  assert.equal(canReadSupportTicket({ viewerId: "autor", queueViewer: true, ticket: null }), false);
});

test("anexos: 1 a 3 imagens, só imagem, limite por arquivo e no total; fila acrescenta e nunca troca", () => {
  const ok = { type: "image/jpeg", size: 500_000 };
  assert.equal(validateTicketImages([]).ok, true);
  assert.equal(validateTicketImages([ok, ok, ok]).ok, true);
  assert.equal(validateTicketImages([ok, ok, ok, ok]).ok, false);
  assert.equal(validateTicketImages([{ type: "application/pdf", size: 10 }]).ok, false);
  assert.equal(validateTicketImages([{ type: "image/png", size: TICKET_IMAGE_MAX_BYTES + 1 }]).ok, false);
  assert.equal(validateTicketImages([{ type: "image/png", size: 0 }]).ok, false);
  assert.ok(TICKET_IMAGE_MAX_BYTES * TICKET_MAX_IMAGES > TICKET_IMAGES_TOTAL_MAX_BYTES);
  const big = { type: "image/jpeg", size: TICKET_IMAGE_MAX_BYTES };
  assert.equal(validateTicketImages([big, big, big]).ok, false); // soma passa de 3,8 MB
  const first = addTicketImages([], ["a", "b"]);
  const second = addTicketImages(first.items, ["c", "d"]);
  assert.deepEqual(second.items, ["a", "b", "c"]);
  assert.equal(second.rejected, 1);
});

test("descrição e resposta: obrigatórias, com limite", () => {
  assert.equal(validateTicketDescription("  oi ").ok, false);
  assert.equal(validateTicketDescription("a tela não salva").ok, true);
  assert.equal(validateTicketDescription("x".repeat(2001)).ok, false);
  assert.equal(validateTicketReply("").ok, false);
  assert.equal(validateTicketReply("É um erro, já corrigimos.").value, "É um erro, já corrigimos.");
  assert.equal(buildReplyNotice("x ".repeat(300)).description.length <= 200, true);
});

test("anti-spam: 5 em 10 minutos e 20 por dia", () => {
  const now = new Date("2026-11-13T15:00:00Z");
  const ago = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  assert.equal(checkTicketRateLimit([ago(1), ago(2), ago(3), ago(4)], now).ok, true);
  const blocked = checkTicketRateLimit([ago(1), ago(2), ago(3), ago(4), ago(5)], now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "window");
  assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 600);
  assert.equal(checkTicketRateLimit([ago(11), ago(12), ago(13), ago(14), ago(15)], now).ok, true);
  const day = Array.from({ length: 20 }, (_, index) => ago(30 + index * 60));
  assert.equal(checkTicketRateLimit(day, now).reason, "day");
});

test("aviso da resposta: tipo permitido na política do sino e liberado no gatilho da migration", () => {
  assert.equal(NOTIFICATION_KIND.SUPPORT_REPLY, "support_reply");
  assert.equal(isNotificationAllowed("support_reply"), true);
  const migration = read("supabase/migrations/20261113120000_support_tickets.sql");
  assert.match(migration, /'marketplace_inbound', 'support_reply'\)/);
});

test("migration: RLS ligado sem policy, bucket PRIVADO, nome com 14 dígitos", () => {
  const file = "supabase/migrations/20261113120000_support_tickets.sql";
  const sql = read(file);
  assert.match(sql, /create table if not exists public\.support_tickets/);
  assert.match(sql, /alter table public\.support_tickets enable row level security/);
  assert.ok(!/create policy/i.test(sql));
  assert.match(sql, /values \('support-tickets', 'support-tickets', false,/);
  assert.match(sql, /status in \('open', 'answered', 'closed'\)/);
  assert.match(sql, /kind in \('bug', 'not_bug', 'improvement'\)/);
  for (const column of ["created_by", "screen_path", "screen_title", "description", "context jsonb", "reply_text", "replied_at", "replied_by"]) assert.ok(sql.includes(column), column);
});

test("rotas: guard antes de tocar em dado; fila e resposta só-dono; autor cria/lista os próprios", () => {
  const tickets = read("app/api/admin/support/tickets/route.js");
  assert.equal((tickets.match(/requireAdminApi\(request\)/g) || []).length, 2);
  assert.ok(tickets.indexOf("requireAdminApi(request)") < tickets.indexOf("listOwnSupportTickets(auth)"));
  assert.ok(tickets.lastIndexOf("requireAdminApi(request)") < tickets.indexOf("createSupportTicket(auth"));
  const queue = read("app/api/admin/support/queue/route.js");
  assert.ok(queue.indexOf("requireAdminApi(request)") < queue.indexOf("assertSupportQueueAccess(auth)"));
  assert.ok(queue.indexOf("assertSupportQueueAccess(auth)") < queue.indexOf("listSupportQueue(auth"));
  const detail = read("app/api/admin/support/tickets/[id]/route.js");
  const patch = detail.slice(detail.indexOf("export async function PATCH"));
  assert.ok(patch.indexOf("requireAdminApi(request)") < patch.indexOf("assertSupportQueueAccess(auth)"));
  assert.ok(patch.indexOf("assertSupportQueueAccess(auth)") < patch.indexOf("replySupportTicket"));
  const lib = read("lib/support-tickets.js");
  assert.match(lib, /isOwnerAdminEmail\(auth\?\.user\?\.email\)/);
  for (const fn of ["listSupportQueue", "setSupportTicketKind", "replySupportTicket"]) {
    const body = lib.slice(lib.indexOf(`export async function ${fn}`));
    assert.ok(body.slice(0, 200).includes("assertSupportQueueAccess(auth)"), fn);
  }
  // o autor nunca recebe contexto técnico nem a classificação do dono
  const author = lib.slice(lib.indexOf("function toAuthorView"), lib.indexOf("function toOwnerView"));
  assert.ok(!author.includes("context") && !author.includes("kind"));
  // anexos em bucket privado, URL assinada (nunca pública)
  assert.ok(lib.includes("createSignedUrl") && !lib.includes("getPublicUrl"));
});

test("página da fila: só o dono (conta real) e item só para ele no rodapé; botão em todos os perfis logados", () => {
  const page = read("app/admin/ajuda/page.jsx");
  assert.ok(page.indexOf("requireAdminPage()") < page.indexOf("canSeeSupportQueue("));
  assert.match(page, /redirect\("\/admin"\)/);
  const layout = read("app/admin/layout.jsx");
  assert.match(layout, /<SupportHelp /);
  assert.match(layout, /!auth\.accountSwitchMode && isOwnerAdminEmail\(auth\.user\?\.email\) \? \(\s*<Link[^>]*href="\/admin\/ajuda"/);
});
