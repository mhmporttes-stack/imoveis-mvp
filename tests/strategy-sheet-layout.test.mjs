// Folha "ESTRATÉGIA COM AMORTIZAÇÃO" (PRES-24) no celular — travas do incidente de 2026-10-18 (INCIDENTES.md):
// (1) nada passa de 100% da largura a 320–430 px (folha que encolhe, texto que quebra, colunas que empilham, campos 100%);
// (2) campos com fonte FIXA ≥ 16px (Safari do iPhone não amplia ao tocar);
// (3) máscara de moeda: o cursor nunca fica dentro do ",00" fixo ("99999" digitado = R$ 99.999,00).
// Verificação visual/medida (scrollWidth == clientWidth em Chromium e WebKit, 320/375/390/430 px): Playwright na vitrine
// `app/dev/vitrine/apresentacao?cena=5` — ver docs/CHANGELOG_AI.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatCurrencyInput, wholeReaisFromCurrencyInput } from "../lib/property-filter-options.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const css = read("components/presentation/presentation.module.css");
const jsx = read("components/presentation/StrategySheet.jsx");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n|,\\s*)${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  return matches.map((match) => match[1]).join(";");
}

test("a folha da Estratégia usa a rede de segurança de largura", () => {
  assert.match(jsx, /className=\{`\$\{styles\.sheet\} \$\{styles\.stSheet\}`\}/);
  assert.match(rule(".stSheet"), /min-width:\s*0/);
  assert.match(rule(".stSheet"), /max-width:\s*100%/);
  assert.match(rule(".stSheet .sheetBody"), /overflow-x:\s*hidden/);
});

test("Sem × Com amortização e campos empilham quando não cabem (nunca 2 colunas fixas)", () => {
  const compare = rule(".stCompare");
  assert.match(compare, /repeat\(auto-fit,\s*minmax\(min\(100%,\s*\d+px\),\s*1fr\)\)/);
  assert.match(rule(".stFields"), /repeat\(auto-fit,\s*minmax\(min\(100%,\s*\d+px\),\s*1fr\)\)/);
});

test("textos que crescem com os valores quebram e o número grande é fluido", () => {
  assert.match(css, /\.stHighlight strong, \.stHighlight span,[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(rule(".stHighlight strong"), /font-size:\s*clamp\(/);
  assert.match(rule(".stYears"), /font-size:\s*clamp\(/);
});

test("campos com largura 100%, border-box e fonte fixa ≥ 16px no celular", () => {
  const fields = rule(".stMoney input, .stSelect");
  assert.match(fields, /width:\s*100%/);
  assert.match(fields, /box-sizing:\s*border-box/);
  for (const selector of [".stMoney input", ".stSelect"]) {
    const size = Number(/font-size:\s*(\d+)px/.exec(rule(selector))?.[1]);
    assert.ok(size >= 16, `${selector} com fonte ${size}px`);
  }
});

test("máscara: digitar 99999 dígito a dígito dá R$ 99.999,00 (cursor antes da vírgula)", () => {
  const source = /function caretPosition[\s\S]*?\n}\n/.exec(jsx)?.[0];
  assert.ok(source, "caretPosition não encontrado");
  const caretPosition = new Function(`${source}; return caretPosition;`)();
  let text = "";
  let caret = 0;
  for (const digit of "99999") {
    const typed = text.slice(0, caret) + digit + text.slice(caret);
    const valor = wholeReaisFromCurrencyInput(typed);
    text = valor > 0 ? formatCurrencyInput(String(valor), { cents: true }) : "";
    caret = caretPosition(text, 2);
    assert.equal(text[caret], ",", `cursor fora do lugar em "${text}"`);
  }
  assert.equal(text.replace(/\s/g, " "), "R$ 99.999,00");
});

test("causa real: a raiz não rola para o lado e os botões do Próximo passo nunca passam da tela", () => {
  const rootRule = /\.root \{([\s\S]*?)\n\}/.exec(css)?.[1] || "";
  assert.match(rootRule, /overflow:\s*clip/, "raiz com overflow: clip (hidden ainda deixa o Safari rolar ao focar um campo)");
  const buttons = /\.scene\[data-scene="proximo"\] \.cta, \.scene\[data-scene="proximo"\] \.ghostBtn \{([\s\S]*?)\}/.exec(css)?.[1] || "";
  assert.doesNotMatch(buttons, /white-space:\s*nowrap/);
  assert.match(buttons, /max-width:\s*100%/);
  assert.match(buttons, /min-width:\s*0/);
});

test("gráfico do saldo: sem amortização vermelho, com amortização verde, cabe na largura e respeita movimento reduzido", () => {
  const chart = read("components/presentation/StrategyBalanceChart.jsx");
  assert.match(jsx, /<StrategyBalanceChart comparison=\{comparison\}/);
  assert.match(rule(".stPathSem"), /stroke:\s*#b42318/i, "Sem amortização = vermelho (danger da paleta)");
  assert.match(rule(".stPathCom"), /stroke:\s*#067647/i, "Com amortização = verde (success)");
  assert.match(rule(".stPlot"), /min-width:\s*0/);
  assert.match(rule(".stPlotWrap"), /minmax\(0,\s*1fr\)/, "coluna do gráfico encolhe (nunca largura fixa)");
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.stDraw[^}]*animation:\s*none/);
  for (const selector of [".stYAxis span", ".stXAxis span", ".stPayoff"]) {
    const size = Number(/font-size:\s*(\d+(?:\.\d+)?)px/.exec(rule(selector))?.[1]);
    assert.ok(size >= 12, `${selector} com texto ≥ 12px (${size})`);
  }
  // só apresentação: os saldos vêm do motor (comparison); o gráfico não recalcula amortização
  assert.doesNotMatch(chart, /import[^;]*\b(compareStrategy|simulateStrategy)\b|taxaAnual|interestRate/);
  assert.match(chart, /<p className=\{styles\.stSrOnly\}>\{summary\}<\/p>/, "resumo para leitor de tela");
});

test("gráfico (dono, 2026-10-19): linhas iguais só com cor diferente, sobe de R$ 0, anos nas pontas, cena de 2,4 s com pulso", () => {
  const chart = read("components/presentation/StrategyBalanceChart.jsx");
  assert.match(css, /\.stPathSem, \.stPathCom \{[^}]*stroke-width:\s*3/, "mesma espessura nas duas linhas");
  assert.doesNotMatch(rule(".stPathSem"), /dasharray/, "sem amortização também sólida");
  assert.match(chart, /const toPaid = \(\[month, balance\]\) => \[month, start - balance\]/, "eixo = valor quitado (financiado − saldo do motor)");
  assert.match(chart, /yearsLessText\(/, "\"N anos a menos\" na faixa");
  assert.match(rule(".stDraw"), /animation:\s*stReveal 2\.4s /, "cada linha sobe em 2,4 s");
  assert.match(css, /@keyframes stPulse/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.stDraw, \.stBand, \.stDot, \.stPayoff, \.stGap \{ animation: none/);
});

test("gráfico (dono, 2026-10-19, 2ª rodada): vermelha sobe, depois a verde, depois a faixa; cena repete a cada mudança", () => {
  const chart = read("components/presentation/StrategyBalanceChart.jsx");
  // relógio: vermelha termina em 2,4 s; verde começa quando a vermelha termina e termina em 4,8 s; faixa/"a menos" depois
  assert.match(chart, /const SEM_END = DRAW_SECONDS;/);
  assert.match(chart, /const COM_END = 2 \* DRAW_SECONDS;/);
  assert.match(chart, /styles\.stDrawCom\}`\} style=\{at\(SEM_END\)\}/, "verde só começa quando a vermelha termina");
  assert.match(chart, /className=\{styles\.stBand\} style=\{at\(COM_END\)\}/, "faixa verde depois da linha verde");
  assert.match(chart, /styles\.stGapBeside\}`\}[\s\S]*?at\(COM_END \+ 0\.3\)/, "\"a menos\" depois da linha verde");
  assert.match(rule(".stDrawCom"), /animation-delay:\s*var\(--d/);
  assert.match(rule(".stBand"), /animation:\s*stFadeIn/);
  // repetição: o resultado muda → remonta a cena (key) parada e toca após ~400 ms sem nova mudança
  assert.match(chart, /const RESTART_MS = 400;/);
  assert.match(chart, /key=\{scene\.run\}/);
  assert.match(chart, /setTimeout\(\(\) => setScene\(\(prev\) => \(\{ \.\.\.prev, armed: true \}\)\), RESTART_MS\)/);
  assert.match(chart, /seen && scene\.armed \? "" : styles\.stWaiting/, "primeira vez: só quando aparece na tela");
  assert.match(css, /\.stWaiting \.stDraw, \.stWaiting \.stBand[^}]*animation-play-state:\s*paused/);
  // pontas só com os anos, sem "quitado em"
  assert.doesNotMatch(chart, /quitado em<\/small>|<small>/);
  assert.match(chart, /formatRoundedYears\(com\.months\)/);
  assert.match(chart, /yearsLessText\(sem\.months, com\.months\)/);
  const pdf = read("lib/payment-strategy-pdf.mjs");
  assert.match(pdf, /yearsLessText\(comparison\.sem\.months, comparison\.com\.months\)/);
  assert.match(pdf, /formatRoundedYears\(comparison\.com\.months\)/);
  assert.doesNotMatch(pdf, /formatDuration\(comparison\.sem\.months - comparison\.com\.months\)/);
});

// Ajustes do dono (2026-10-19, PRES-24): gráfico é PROJEÇÃO (o cliente nem assinou) e o 13º não tem mais seletor de mês.
test("gráfico 'Projeção de quitação' (tela e PDF), nunca 'já quitou'; 13º sem seletor de mês e texto do 13º líquido", () => {
  const chart = read("components/presentation/StrategyBalanceChart.jsx");
  const pdf = read("lib/payment-strategy-pdf.mjs");
  assert.match(chart, /<figcaption[^>]*>Projeção de quitação<\/figcaption>/);
  assert.match(pdf, /text\("PROJEÇÃO DE QUITAÇÃO"/);
  for (const source of [chart, pdf, jsx]) assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), /já quitou|JÁ QUITOU/);
  assert.match(jsx, /const MONTH_DEFAULTS = \{ extraAnual: DEFAULT_ANNUAL_EXTRA_MONTH \};/);
  assert.match(jsx, /por ano \(13º líquido estimado\)/);
});
