// Renderiza a cena em quadros (Chromium/Playwright) e salva events.json (efeitos sonoros) ao lado dos quadros.
// uso: node render_frames.cjs <cena.html> <pasta_quadros> [fps] [duracao_s] [t1,t2,...  (só prévias PNG)]
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
(async () => {
  const [html, outDir, fpsA, durA, only] = process.argv.slice(2);
  const fps = +(fpsA || 30);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('file://' + path.resolve(html));
  await p.waitForFunction('window.__ready === true');
  const meta = await p.evaluate(() => ({ duration: window.DURATION, events: window.EVENTS || [] }));
  const dur = +(durA || meta.duration || 8);
  fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify({ duration: dur, events: meta.events }, null, 1));
  const times = only ? only.split(',').map(Number) : Array.from({ length: Math.round(fps * dur) }, (_, i) => i / fps);
  for (let i = 0; i < times.length; i++) {
    await p.evaluate(t => window.render(t), times[i]);
    const name = only ? `prev_${String(times[i]).replace('.', '_')}.png` : `f${String(i).padStart(4, '0')}.jpg`;
    await p.screenshot({ path: path.join(outDir, name), ...(only ? {} : { type: 'jpeg', quality: 94 }) });
  }
  await b.close();
})();
