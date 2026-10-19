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
  for (const selector of [".stYAxis span", ".stXAxis span", ".stPayoff small"]) {
    const size = Number(/font-size:\s*(\d+(?:\.\d+)?)px/.exec(rule(selector))?.[1]);
    assert.ok(size >= 12, `${selector} com texto ≥ 12px (${size})`);
  }
  // só apresentação: os saldos vêm do motor (comparison); o gráfico não recalcula amortização
  assert.doesNotMatch(chart, /import[^;]*\b(compareStrategy|simulateStrategy)\b|taxaAnual|interestRate/);
  assert.match(chart, /<p className=\{styles\.stSrOnly\}>\{summary\}<\/p>/, "resumo para leitor de tela");
});
