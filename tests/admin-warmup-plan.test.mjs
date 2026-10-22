import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWarmupPlan, isDue, isRouteOnly, MENU_WINDOW_MS, PRIMARY_WINDOW_MS } from "../components/admin-warmup-plan.mjs";

test("Clientes vem primeiro, depois barra/cabeçalho, depois o menu (sem repetir)", () => {
  const plan = buildWarmupPlan({
    primaryHrefs: ["/admin/desempenho/online", "/admin/simulacoes", "/admin/chat", "/admin/chat/marketplace", "/admin/calendario"],
    menuHrefs: ["/admin/inicio", "/admin/simulacoes", "/admin/calendario", "/admin/financeiro", "/admin/corretores"]
  });
  assert.deepEqual(plan.primary.map((item) => item.href), ["/admin/simulacoes", "/admin/desempenho/online", "/admin/chat", "/admin/chat/marketplace", "/admin/calendario"]);
  assert.deepEqual(plan.menu.map((item) => item.href), ["/admin/inicio", "/admin/financeiro", "/admin/corretores"]);
  assert.ok(plan.primary.every((item) => item.kind === "full"));
});

test("MD-16: a Meta Diária nunca é montada pelo pré-carregamento (só a rota)", () => {
  const plan = buildWarmupPlan({ primaryHrefs: ["/admin/meta-diaria"], menuHrefs: ["/admin/meta-diaria", "/admin/meta-diaria/gestao"] });
  assert.deepEqual(plan.primary.find((item) => item.href === "/admin/meta-diaria"), { href: "/admin/meta-diaria", kind: "auto" });
  assert.equal(isRouteOnly("/admin/meta-diaria?x=1"), true);
  assert.equal(isRouteOnly("/admin/anuncios"), true, "Anúncios chama a Meta e grava ao abrir");
  assert.equal(isRouteOnly("/admin/meta-diaria/gestao"), false);
});

test("economia de dados / 2G: só a rota da barra e do cabeçalho, sem menu", () => {
  const plan = buildWarmupPlan({ primaryHrefs: ["/admin/chat"], menuHrefs: ["/admin/financeiro"], slow: true });
  assert.deepEqual(plan.primary, [{ href: "/admin/simulacoes", kind: "auto" }, { href: "/admin/chat", kind: "auto" }]);
  assert.deepEqual(plan.menu, []);
});

test("não pré-carrega a tela atual nem destino fora do painel", () => {
  const plan = buildWarmupPlan({ primaryHrefs: ["/admin/chat"], menuHrefs: ["/academia", "/admin/chat"], currentPath: "/admin/simulacoes" });
  assert.deepEqual(plan.primary.map((item) => item.href), ["/admin/chat"]);
  assert.deepEqual(plan.menu, []);
});

test("janelas: barra a cada 5 min no máximo, menu a cada 30 min", () => {
  const now = 10_000_000;
  assert.equal(isDue(0, now, PRIMARY_WINDOW_MS), true);
  assert.equal(isDue(now - PRIMARY_WINDOW_MS + 1, now, PRIMARY_WINDOW_MS), false);
  assert.equal(isDue(now - PRIMARY_WINDOW_MS, now, PRIMARY_WINDOW_MS), true);
  assert.equal(isDue(now - 10 * 60 * 1000, now, MENU_WINDOW_MS), false);
});

test("AdminWarmup só prefetcha pelo plano e respeita economia de dados", () => {
  const source = readFileSync(new URL("../components/AdminWarmup.jsx", import.meta.url), "utf8");
  assert.match(source, /buildWarmupPlan\(/);
  assert.match(source, /connectionTooSlow\(\)/);
  assert.doesNotMatch(source, /meta-diaria/, "a Meta Diária só entra pelo plano (rota apenas)");
  assert.doesNotMatch(source, /setInterval\(/, "sem polling por relógio");
});
