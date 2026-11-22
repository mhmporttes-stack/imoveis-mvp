// Renderiza SVGs/HTML em PNG com o Chromium do Playwright.
// uso: node render.js <entrada.(svg|html)> <saida.png> <largura> <altura> [escala]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [inp, out, w, h, sc] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(sc || 1) });
  const src = fs.readFileSync(inp, 'utf8');
  if (inp.endsWith('.svg')) await p.setContent(`<body style="margin:0;background:#EEF2F9">${src}</body>`);
  else await p.setContent(src);
  await p.waitForTimeout(150);
  await p.screenshot({ path: out });
  await b.close();
})();
