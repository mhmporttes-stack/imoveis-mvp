// uso: node shot.cjs <html> <png> <w> <h> [scale]
const { chromium } = require('playwright'); const path=require('path');
(async()=>{ const [h,o,w,hh,sc]=process.argv.slice(2);
 const b=await chromium.launch(); const p=await b.newPage({viewport:{width:+w,height:+hh},deviceScaleFactor:+(sc||1)});
 p.on('pageerror',e=>console.log('PAGEERROR',e.message)); p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
 await p.goto('file://'+path.resolve(h)); await p.waitForFunction('window.__ready===true',{timeout:8000}).catch(()=>console.log('not ready'));
 await p.screenshot({path:o}); await b.close(); })();
