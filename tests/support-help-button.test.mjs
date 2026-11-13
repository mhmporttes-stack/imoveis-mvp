// Botão "?" da Ajuda (dono, 2026-11-13): posição igual à do Henry, esconder com teclado/conversa/gavetas, legenda só na 1ª vez.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HELP_BOTTOM_BASE, HELP_LABEL_STORAGE_KEY, helpBottomOffset, isHelpButtonHidden, markHelpLabelSeen, shouldShowHelpLabel } from "../components/support/help-button-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("posição: mesma conta de safe-area/--admin-bottom-nav-space do Henry; religado, empilha acima", () => {
  const henry = read("components/henry/HenryVoiceView.jsx");
  assert.ok(henry.includes(`const MOBILE_BOTTOM = "${HELP_BOTTOM_BASE}"`), "o Henry mudou a conta do rodapé: alinhe a Ajuda");
  assert.equal(helpBottomOffset(false), HELP_BOTTOM_BASE);
  assert.match(helpBottomOffset(true), /^calc\(calc\(.*\) \+ 100px\)$/);
  const component = read("components/support/SupportHelp.jsx");
  assert.match(component, /fixed left-3/); // nunca à direita
  assert.ok(!/fixed [^"]*right-/.test(component));
});

test("esconde com teclado aberto, em gaveta/tela cheia e com a própria gaveta aberta", () => {
  assert.equal(isHelpButtonHidden({}), false);
  assert.equal(isHelpButtonHidden({ typing: true }), true);
  assert.equal(isHelpButtonHidden({ overlayOpen: true }), true);
  assert.equal(isHelpButtonHidden({ helpOpen: true }), true);
});

test("Chat/Marketplace em modo aplicativo: some no celular, volta no computador", () => {
  assert.equal(isHelpButtonHidden({ chatAppMode: true, viewportWidth: 390 }), true);
  assert.equal(isHelpButtonHidden({ chatAppMode: true, viewportWidth: 1280 }), false);
  assert.equal(isHelpButtonHidden({ chatAppMode: false, viewportWidth: 390 }), false);
});

test("legenda 'Ajuda' só na 1ª vez, com try/catch no armazenamento", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.equal(shouldShowHelpLabel(storage), true);
  markHelpLabelSeen(storage);
  assert.equal(store.get(HELP_LABEL_STORAGE_KEY), "1");
  assert.equal(shouldShowHelpLabel(storage), false);
  const broken = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
  assert.equal(shouldShowHelpLabel(broken), true);
  assert.doesNotThrow(() => markHelpLabelSeen(broken));
  assert.doesNotThrow(() => markHelpLabelSeen(null));
});

test("a gaveta usa Sheet (voltar fecha só ela) e a redução de imagem do Chat", () => {
  const component = read("components/support/SupportHelp.jsx");
  assert.match(component, /import Sheet from "@\/components\/ui\/Sheet"/);
  assert.match(component, /prepareImageFile\(file\)/);
  assert.match(component, /addTicketImages/);
  assert.match(read("components/ui/Sheet.jsx"), /useBackToClose\(open, requestClose\)/);
});
