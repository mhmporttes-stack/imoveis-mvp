import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cursorTargetPoint,
  cursorTimeline,
  decideClientOpen,
  henryClientSheetPath,
  isAcceptance,
  isAllowedHenryNavigation,
  navTargetPath,
  offeredToOpen,
  shouldMinimizeForNavigation
} from "../lib/henry-navigation-core.mjs";

const ID = "11111111-2222-4333-8444-555555555555";

test("navegação: toda tela da lista (e a ficha de cliente) minimiza; o resto é recusado", () => {
  assert.equal(shouldMinimizeForNavigation({ path: "/admin/desempenho", label: "Desempenho" }), true);
  assert.equal(shouldMinimizeForNavigation({ path: henryClientSheetPath(ID) }), true);
  assert.equal(shouldMinimizeForNavigation(null), false);
  assert.equal(isAllowedHenryNavigation("/admin/simulacoes?clientId=1;drop"), false);
  assert.equal(isAllowedHenryNavigation("https://evil.com"), false);
  assert.equal(isAllowedHenryNavigation("/admin/usuarios"), false);
  assert.equal(henryClientSheetPath("abc"), "");
  assert.equal(henryClientSheetPath(ID), `/admin/simulacoes?clientId=${ID}`); // o mesmo parâmetro que o painel já usa
  assert.equal(navTargetPath(henryClientSheetPath(ID)), "/admin/simulacoes");
  // O navegador minimiza e entrega ao cursor (não navega direto); a lista abre a ficha pelo evento.
  const client = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(client, /if \(shouldMinimizeForNavigation\(navigate\)\) \{\n\s+setExpanded\(false\);\n\s+setNavRequest/);
  const workspace = readFileSync(new URL("../components/clients/ClientWorkspace.jsx", import.meta.url), "utf8");
  assert.match(workspace, /addEventListener\("mm:henry-open-client"/);
  assert.match(workspace, /params\.get\("clientId"\)/);
});

test("aceite da sugestão: 'sim', 'abre', 'pode' depois de 'quer que eu abra?'", () => {
  for (const text of ["sim", "Abre", "pode", "pode abrir", "sim, por favor", "manda ver", "Henry, abre"]) assert.equal(isAcceptance(text), true, text);
  for (const text of ["não", "quantos leads hoje?", "sim mas antes me fala da Carol e do Pedro"]) assert.equal(isAcceptance(text), false, text);
  assert.equal(offeredToOpen("São 9 clientes. Quer que eu abra a lista?"), true);
  assert.equal(offeredToOpen("Posso abrir o Desempenho pra você."), true);
  assert.equal(offeredToOpen("Hoje entraram 4 leads."), false);
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(lib, /const accepted = isAcceptance\(text\) && offeredToOpen\(lastAssistant\);/);
});

test("abrir ficha de cliente: um achado abre; vários perguntam qual; nenhum avisa", () => {
  const one = decideClientOpen([{ id: ID, firstName: "Maria", lastInitial: "S.", stage: "Em atendimento", responsible: "Ana" }], "maria");
  assert.equal(one.kind, "open");
  assert.deepEqual(one.navigate, { key: "cliente", path: `/admin/simulacoes?clientId=${ID}`, label: "ficha de Maria", clientId: ID });
  const many = decideClientOpen([
    { id: ID, firstName: "Maria", lastInitial: "S.", stage: "Em atendimento", responsible: "Ana" },
    { id: "22222222-2222-4333-8444-555555555555", firstName: "Maria", lastInitial: "L.", stage: "Simulação enviada", responsible: "Bruno" }
  ], "maria");
  assert.equal(many.kind, "ask");
  assert.deepEqual(many.options[1], { primeiro_nome: "Maria", sobrenome_inicial: "L.", etapa: "Simulação enviada", responsavel: "Bruno" });
  assert.equal(JSON.stringify(many).includes("2222"), false); // id não vai para o modelo
  assert.equal(decideClientOpen([], "zé").kind, "not_found");
  assert.equal(decideClientOpen([{ id: "x", firstName: "Zé" }], "zé").kind, "not_found"); // id fora do formato
  // Ferramenta só de leitura, mesmo escopo/filtro da lista (sem Particular), sem telefone/CPF.
  const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
  const fn = reports.slice(reports.indexOf("export async function findHenryClientsByName"));
  assert.match(fn, /applyResponsibleUserScope/);
  assert.match(fn, /\.is\("private_contact_at", null\)/);
  assert.doesNotMatch(fn, /phone|cpf/i);
});

test("cursor: alvo real quando visível, aproximado quando escondido, duração 1,2–2 s, movimento reduzido navega direto", () => {
  const viewport = { width: 1280, height: 800 };
  assert.deepEqual(cursorTargetPoint({ left: 10, top: 200, width: 56, height: 42, right: 66, bottom: 242 }, viewport), { x: 38, y: 221, exact: true });
  assert.deepEqual(cursorTargetPoint({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }, viewport), { x: 38, y: 320, exact: false });
  assert.deepEqual(cursorTargetPoint(null, { width: 390, height: 844 }, { mobile: true }), { x: 195, y: 816, exact: false });
  assert.equal(cursorTargetPoint(null, viewport, { approx: false }), null);
  const simple = cursorTimeline();
  const withClient = cursorTimeline({ withClient: true });
  assert.ok(simple.total >= 1200 && simple.total <= 2000, String(simple.total));
  assert.ok(withClient.total <= 2000, String(withClient.total));
  assert.deepEqual(cursorTimeline({ reducedMotion: true }), { total: 0, steps: [] });
  const cursor = readFileSync(new URL("../components/henry/HenryCursor.jsx", import.meta.url), "utf8");
  assert.match(cursor, /addEventListener\("pointerdown", cancel, true\)/); // qualquer clique/tecla cancela e navega
  assert.match(cursor, /prefers-reduced-motion: reduce/);
  assert.match(cursor, /\[data-henry-target=/);
  assert.match(cursor, /\[data-henry-client-id=/);
  for (const file of ["../components/AdminMenu.jsx", "../components/AdminBottomNav.jsx"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /data-henry-target=\{item\.href\.split\("\?"\)\[0\]\}/);
  }
  assert.match(readFileSync(new URL("../components/clients/ClientCard.jsx", import.meta.url), "utf8"), /data-henry-client-id=\{client\.id\}/);
});

test("ícone minimizado dobra de tamanho ao ouvir o nome, gravando, pensando ou falando", () => {
  const client = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(client, /engaged=\{inConversation \|\| phase !== "idle" \|\| recording \|\| calling \|\| pttHolding\}/);
  assert.match(client, /handlers\.markCalling\(\)/);
  const view = readFileSync(new URL("../components/henry/HenryVoiceView.jsx", import.meta.url), "utf8");
  assert.match(view, /const box = engaged \? ICON_BIG : ICON_SMALL;/);
  assert.match(view, /const box = engaged \? MOBILE_BIG : MOBILE_SMALL;/);
});
