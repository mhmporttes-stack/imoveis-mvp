// Viewport da apresentação pública (/s/<token>) — trava do incidente de 2026-10-18 (INCIDENTES.md): no iPhone, tocar no
// campo "Valor" da folha "ESTRATÉGIA COM AMORTIZAÇÃO" ampliava a página (~1,3x) e ela não voltava. maximumScale: 1 trava o
// zoom automático de foco do iOS (no iOS 10+ a pinça manual continua liberada); userScalable nunca vira false aqui.
// O WebKit do Playwright no Linux NÃO simula o zoom de foco do iOS — por isso a trava é no viewport, não num teste de tela.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PRESENTATION_VIEWPORT } from "../lib/presentation-viewport.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("viewport da apresentação: sem zoom automático de foco e sem user-scalable=no", () => {
  assert.equal(PRESENTATION_VIEWPORT.width, "device-width");
  assert.equal(PRESENTATION_VIEWPORT.initialScale, 1);
  assert.equal(PRESENTATION_VIEWPORT.maximumScale, 1);
  assert.equal(PRESENTATION_VIEWPORT.userScalable, true);
  assert.equal(PRESENTATION_VIEWPORT.viewportFit, "cover");
});

test("a página pública /apresentacao/[token] (reescrita de /s/<token>) usa o viewport único", () => {
  const page = read("app/apresentacao/[token]/page.jsx");
  assert.match(page, /import \{ PRESENTATION_VIEWPORT \} from "@\/lib\/presentation-viewport\.mjs"/);
  assert.match(page, /export const viewport = \{ \.\.\.PRESENTATION_VIEWPORT \}/);
  assert.doesNotMatch(page, /maximumScale:\s*[2-9]/);
});

test("a prévia do corretor não sobrescreve o viewport do layout raiz (que já é maximumScale 1)", () => {
  const preview = read("app/admin/simulacoes/[id]/apresentacao/page.jsx");
  assert.doesNotMatch(preview, /export (const viewport|async function generateViewport|function generateViewport)/);
  const layout = read("app/layout.jsx");
  assert.match(layout, /maximumScale:\s*1\b/);
});

test("campos da folha da Estratégia continuam com fonte fixa ≥ 16px no celular", () => {
  const css = read("components/presentation/presentation.module.css");
  assert.match(css, /\.stMoney input \{[^}]*font-size: 17px;/);
  assert.match(css, /\.stSelect \{[^}]*font-size: 17px;/);
});
