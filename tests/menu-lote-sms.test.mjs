// Item "Lote de SMS" no menu (menu lateral e folha "Mais" do celular) e atalho no Início — dono, 2026-11-02.
// Executa o getAdminMenuGroups REAL (trecho puro de components/AdminMenu.jsx, sem JSX) para cada perfil.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hiddenNavKeys } from "../lib/whatsapp-access-core.mjs";
import { withAcademyMenuGroup } from "../lib/academy-menu.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const menuSource = read("components/AdminMenu.jsx");
const start = menuSource.indexOf("const MARKETPLACE_CHAT_ITEM");
const end = menuSource.indexOf("// Chave da tela atual a partir do caminho");
assert.ok(start > 0 && end > start, "trecho do menu não encontrado");
const body = menuSource.slice(start, end).replace("export function getAdminMenuGroups", "function getAdminMenuGroups");
const getAdminMenuGroups = new Function("hiddenNavKeys", "withAcademyMenuGroup", `${body}\nreturn getAdminMenuGroups;`)(hiddenNavKeys, withAcademyMenuGroup);

const keys = (flags) => getAdminMenuGroups(flags).flatMap((group) => group.items.map((item) => item.key));

test("admin geral e gestor veem o Lote de SMS (menu lateral e Mais); corretor e associado não", () => {
  assert.ok(keys({ isAdmin: true }).includes("sms-batch"));
  assert.ok(keys({ isManager: true, isBroker: true }).includes("sms-batch"));
  assert.ok(keys({ isManager: true }).includes("sms-batch"));
  assert.ok(!keys({ isBroker: true }).includes("sms-batch"));
  assert.ok(!keys({ isAssociate: true, isBroker: true }).includes("sms-batch"));
});

test("o Lote de SMS aponta para a rota e tem ícone e chave de rota ativa", () => {
  const item = getAdminMenuGroups({ isAdmin: true }).flatMap((group) => group.items).find((entry) => entry.key === "sms-batch");
  assert.equal(item.href, "/admin/lote-sms");
  assert.match(read("components/admin-nav-icons.js"), /"sms-batch": MessageSquareText/);
  assert.match(menuSource, /\["\/admin\/lote-sms", "sms-batch"\]/);
});

test("a folha Mais mostra todos os itens do menu que não estão na barra (sem lista paralela)", () => {
  const nav = read("components/AdminBottomNav.jsx");
  assert.match(nav, /getAdminMenuGroups\(\{ \.\.\.flags, academiaEnabled \}\)/);
  assert.match(nav, /group\.items\.filter\(\(item\) => !barKeys\.includes\(item\.key\)\)/);
  assert.ok(!/sms-batch/.test(nav), "barra não deve listar o item à mão");
});

test("Início: atalho do Lote de SMS só para admin geral e gestor; a página do Lote continua protegida", () => {
  const page = read("app/admin/inicio/page.jsx");
  assert.match(page, /smsBatch=\{isGeneralAdminAuth\(auth\) \|\| isManagerProfile\(auth\.profile\)\}/);
  const inicio = read("components/inicio/PainelInicio.jsx");
  assert.match(inicio, /\{smsBatch \? <InicioAtalhoLoteSms \/> : null\}/);
  assert.match(inicio, /href="\/admin\/lote-sms"/);
  assert.match(read("app/admin/lote-sms/page.jsx"), /await requireBrokerManagementPage\(\)/);
});

test("Mais aplica a versão pendente e reabre a folha", () => {
  const nav = read("components/AdminBottomNav.jsx");
  assert.match(nav, /if \(!applyPendingUpdateOnMenuOpen\(\)\) setMoreOpen\(true\)/);
  assert.match(read("components/PwaLifecycle.jsx"), /sessionStorage\.setItem\(REOPEN_MORE_KEY/);
});
