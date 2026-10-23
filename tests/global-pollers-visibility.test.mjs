import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Desempenho (2026-10-20): pollers globais do layout do painel pausam com a aba oculta e checam na hora ao voltar.
// NewClientSoundListener fica de fora de propósito: o som de cliente novo precisa tocar com a aba oculta (prazo da roleta).
const files = [
  "components/celebrations/BrokerCelebrationGate.jsx",
  "components/DailyMessageGate.jsx",
  "components/TopRankingBadge.jsx"
];

for (const file of files) {
  test(`${file}: só consulta com a aba visível e checa ao voltar`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    // Desde 2026-10-23 pode ser pelo helper components/page-visibility.js (também pausa com o app de desktop minimizado).
    if (/isPageHidden\(\)/.test(source)) {
      assert.match(source, /if \(!isPageHidden\(\)\)/);
      assert.match(source, /const stopWatchingVisibility = onPageVisibilityChange\(/);
      assert.match(source, /stopWatchingVisibility\(\);/);
    } else {
      assert.match(source, /document\.visibilityState === "visible"/);
      assert.match(source, /document\.addEventListener\("visibilitychange", /);
      assert.match(source, /document\.removeEventListener\("visibilitychange", /);
    }
    assert.doesNotMatch(source, /setInterval\((poll|checkPending|load), /);
  });
}

test("NewClientSoundListener continua consultando com a aba oculta", () => {
  const source = readFileSync(new URL("../components/NewClientSoundListener.jsx", import.meta.url), "utf8");
  assert.match(source, /setInterval\(poll, POLL_INTERVAL_MS\)/);
});
