import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path";
const require=createRequire("/opt/node22/lib/node_modules/");
let pw; for (const b of ["/opt/node22/lib/node_modules","/usr/lib/node_modules",process.cwd()]) { try{pw=require(require.resolve("playwright",{paths:[b]}));break}catch{} }
const {chromium}=pw;
async function fontCss(q){const css=await(await fetch(`https://fonts.googleapis.com/css2?${q}&display=swap`,{headers:{"user-agent":"Mozilla/5.0 Chrome/120"}})).text();const out=[];for(const blk of css.split("@font-face").slice(1)){const u=/url\((https:[^)]+)\)/.exec(blk)?.[1];if(!u)continue;const buf=Buffer.from(await(await fetch(u)).arrayBuffer());out.push("@font-face"+blk.replace(u,`data:font/woff2;base64,${buf.toString("base64")}`))}return out.join("\n")}
const fonts=await fontCss("family=Anton&family=Sora:wght@400;600;700;800&family=Playfair+Display:ital,wght@1,600");
const br=await chromium.launch(); const pg=await br.newPage({viewport:{width:1311,height:1819}});
for (const n of process.argv.slice(2)) {
  let h=fs.readFileSync(`p${n}.html`,"utf8").replace("</head>",`<style>${fonts}</style></head>`);
  h=h.replace(/src="(img\/[^"]+)"/g,(m,s)=>{const ext=path.extname(s).slice(1);return `src="data:image/${ext==="jpg"?"jpeg":ext};base64,${fs.readFileSync(s).toString("base64")}"`});
  await pg.setContent(h); await pg.evaluate(()=>document.fonts.ready); await pg.waitForTimeout(500);
  await pg.screenshot({path:`panfleto-${n}.png`,clip:{x:0,y:0,width:1311,height:1819}});
}
await br.close();
