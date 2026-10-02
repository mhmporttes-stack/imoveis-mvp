import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseSafeText, parseAnchor, resolveOpening, sectionDomId, formatUpdatedDate, updatedLabel, showNewBadge, showAckButton,
  canShowApprovalButtons, approvalState, OWNER_ONLY_NOTICE, searchPlan, createDebouncer, apiErrorMessage, CONTENT_NOT_ALLOWED, moveId, statusLabel
} from "../lib/manual-ui-core.mjs";

test("texto seguro: parágrafos, subtítulo e listas", () => {
  const blocks = parseSafeText("Olá mundo\ncontinua\n\n## Título\n- a\n- b\n\n1. um\n2. dois");
  assert.deepEqual(blocks, [
    { type: "p", text: "Olá mundo continua" },
    { type: "h", text: "Título" },
    { type: "ul", items: ["a", "b"] },
    { type: "ol", items: ["um", "dois"] }
  ]);
});

test("texto seguro: HTML e scripts permanecem como texto cru (o React escapa)", () => {
  const blocks = parseSafeText('<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>');
  assert.equal(blocks[0].text, "<script>alert(1)</script>");
  assert.equal(blocks[1].items[0], "<img src=x onerror=alert(1)>");
  assert.ok(blocks.every((b) => ["p", "h", "ul", "ol"].includes(b.type)));
  assert.deepEqual(parseSafeText(null), []);
});

test("âncoras: hash e novidade", () => {
  assert.deepEqual(parseAnchor("#meta/regras"), { topic: "meta", section: "regras" });
  assert.deepEqual(parseAnchor(""), { topic: "", section: "" });
  const topics = [{ slug: "meta", sections: [{ slug: "regras" }] }];
  const news = [{ slug: "aviso" }];
  assert.deepEqual(resolveOpening({ hash: "#meta/regras", topics, news }), { view: "topic", topicSlug: "meta", sectionSlug: "regras", newsSlug: "" });
  assert.equal(resolveOpening({ hash: "#meta", topics, news }).sectionSlug, "");
  assert.equal(resolveOpening({ hash: "#meta/nao-existe", topics, news }).sectionSlug, "");
  assert.equal(resolveOpening({ hash: "#inexistente", topics, news }).view, "home");
  assert.equal(resolveOpening({ novidade: "aviso", hash: "#meta", topics, news }).view, "news");
  assert.equal(resolveOpening({ novidade: "outra", topics, news }).view, "home");
  assert.equal(sectionDomId("meta", "regras"), "manual-meta-regras");
});

test("Novo e Última atualização (pt-BR, America/Sao_Paulo)", () => {
  assert.equal(showNewBadge({ isNew: true }), true);
  assert.equal(showNewBadge({ isNew: false }), false);
  assert.equal(showNewBadge({}), false);
  // 02:00 UTC de 10/out ainda é 09/out em São Paulo
  assert.equal(formatUpdatedDate("2026-10-10T02:00:00Z"), "09/10/2026");
  assert.equal(updatedLabel("2026-10-10T15:00:00Z"), "Última atualização: 10/10/2026");
  assert.equal(updatedLabel(""), "");
  assert.equal(formatUpdatedDate("lixo"), "");
});

test("botão 'Li e entendi' só quando exige e ainda não leu", () => {
  assert.equal(showAckButton({ requires_ack: true, read: false }), true);
  assert.equal(showAckButton({ requires_ack: true, read: true }), false);
  assert.equal(showAckButton({ requires_ack: false, read: false }), false);
});

test("aprovação: botões só para o dono", () => {
  assert.equal(canShowApprovalButtons({ isOwner: true }), true);
  assert.equal(canShowApprovalButtons({ isOwner: false }), false);
  assert.equal(canShowApprovalButtons({}), false);
  assert.deepEqual(approvalState({ isOwner: true }), { buttons: true, notice: "" });
  assert.deepEqual(approvalState({ isOwner: false }), { buttons: false, notice: OWNER_ONLY_NOTICE });
  assert.equal(OWNER_ONLY_NOTICE, "Somente o Matheus aprova e publica");
  const other = approvalState({ isOwner: false, ownerViewingAsOther: true });
  assert.equal(other.buttons, false);
  assert.match(other.notice, /própria conta/);
});

test("busca: mínimo de 2 caracteres e debounce lógico", () => {
  assert.equal(searchPlan("a").run, false);
  assert.equal(searchPlan("  ab ").run, true);
  assert.equal(searchPlan("  ab ").q, "ab");
  const calls = [];
  const queue = [];
  const timers = { set: (fn) => { queue.push(fn); return queue.length - 1; }, clear: (h) => { queue[h] = null; } };
  const debounced = createDebouncer((q) => calls.push(q), 300, timers);
  debounced("me"); debounced("met"); debounced("meta");
  assert.equal(calls.length, 0);
  queue.forEach((fn) => fn && fn()); queue.length = 0;
  assert.deepEqual(calls, ["meta"]);
  debounced("x"); debounced.cancel();
  queue.forEach((fn) => fn && fn());
  assert.deepEqual(calls, ["meta"]);
});

test("erros: 422 vira mensagem padrão sem termos", () => {
  assert.equal(apiErrorMessage(422, "qualquer coisa do servidor"), CONTENT_NOT_ALLOWED);
  assert.equal(CONTENT_NOT_ALLOWED, "Conteúdo não permitido — revise o texto");
  assert.equal(apiErrorMessage(409, "Já existe."), "Já existe.");
  assert.equal(apiErrorMessage(500, ""), "Não foi possível concluir. Tente novamente.");
});

test("ordem e rótulos", () => {
  assert.deepEqual(moveId(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.equal(statusLabel("pending"), "Aguardando aprovação");
});

// ---- estático: telas do Manual ----
const root = path.resolve(import.meta.dirname, "..");
function files(dir) {
  return fs.readdirSync(path.join(root, dir)).filter((f) => /\.(jsx|js)$/.test(f)).map((f) => path.join(dir, f));
}
const screenFiles = [...files("components/manual"), "components/ui/Accordion.jsx", "app/admin/manual/page.jsx", "app/admin/manual/gerenciar/page.jsx"];

test("telas do Manual não importam a guarda de conteúdo nem o serviço no cliente", () => {
  for (const file of screenFiles) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!/manual-guard/.test(src), `${file} importa manual-guard`);
    if (file.startsWith("components/")) {
      assert.ok(!/@\/lib\/manual["']/.test(src) && !/manual-service/.test(src), `${file} importa lib de servidor`);
    }
  }
});

test("telas do Manual não usam HTML cru", () => {
  for (const file of screenFiles) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!/dangerouslySetInnerHTML/.test(src), `${file} usa dangerouslySetInnerHTML`);
    assert.ok(!/\.innerHTML\s*=/.test(src), `${file} escreve innerHTML`);
  }
});

test("texto da interface do Manual não fala de supervisão de conversas ou acessos especiais", () => {
  const banned = /(monitor|espion|supervis|ver (as )?conversas|hist[oó]rico de conversas|acesso privilegiado)/i;
  for (const file of [...screenFiles, "app/dev/vitrine/_fixtures/manual.js"]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!banned.test(src), `${file} contém termo proibido`);
  }
});
