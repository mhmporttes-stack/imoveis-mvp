// Captura screenshots da vitrine de componentes (app/dev/vitrine) em várias
// larguras. Requer `pnpm dev` rodando (a vitrine só existe no next dev).
//
// Uso:
//   node .claude/skills/design-crm/scripts/capturar-vitrine.mjs --tela clientes [--perfil corretor]
//     [--estado normal|carregando|erro] [--larguras 360,390,768,1280,1440]
//     [--base http://localhost:3000] [--saida scratch/vitrine] [--pagina-inteira]
//     [--clicar "texto visível"]  (clica no primeiro elemento com esse texto antes de capturar)
//     [--sufixo nome]             (acrescenta ao nome do arquivo, ex.: conversa-aberta)
//
// Saída: <saida>/<tela>-<perfil>-<estado>-<largura>.png (scratch/ é ignorado
// pelo git — apague ao terminar).

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    try {
      const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
      return require(path.join(globalRoot, "playwright"));
    } catch {
      console.error("Playwright não encontrado. Instale-o fora do projeto (ex.: npm i -g playwright) — não adicione ao package.json sem aprovação.");
      process.exit(1);
    }
  }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const tela = arg("tela", "");
if (!tela) {
  console.error("Informe --tela (ex.: clientes, chat, meta-diaria, meta-diaria-equipe, desempenho).");
  process.exit(1);
}
const perfil = arg("perfil", "admin");
const estado = arg("estado", "normal");
const larguras = String(arg("larguras", "360,390,768,1280,1440")).split(",").map(Number).filter(Boolean);
const base = arg("base", "http://localhost:3000");
const saida = arg("saida", "scratch/vitrine");
const paginaInteira = Boolean(arg("pagina-inteira", false));
const clicar = arg("clicar", "");
const sufixo = arg("sufixo", "");

const { chromium } = loadPlaywright();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
mkdirSync(saida, { recursive: true });

for (const largura of larguras) {
  const altura = largura < 768 ? 844 : largura < 1280 ? 1024 : 900;
  const context = await browser.newContext({
    viewport: { width: largura, height: altura },
    deviceScaleFactor: largura < 768 ? 2 : 1,
    isMobile: largura < 768,
    hasTouch: largura < 768,
    reducedMotion: "reduce",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo"
  });
  const page = await context.newPage();
  const avisos = [];
  page.on("console", (msg) => { if (["warning", "error"].includes(msg.type())) avisos.push(msg.text()); });
  page.on("pageerror", (error) => avisos.push(`pageerror: ${error.message}`));

  const url = `${base}/dev/vitrine?${new URLSearchParams({ tela, perfil, estado, limpo: "1" })}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  // Esconde o indicador de desenvolvimento do Next (não faz parte da tela).
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(1500);
  if (clicar) {
    await page.getByText(String(clicar), { exact: false }).first().click();
    await page.waitForTimeout(1500);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const arquivo = path.join(saida, `${tela}-${perfil}-${estado}${sufixo ? `-${sufixo}` : ""}-${largura}.png`);
  await page.screenshot({ path: arquivo, fullPage: paginaInteira });
  console.log(`${arquivo}${overflow > 0 ? `  ⚠ rolagem horizontal de ${overflow}px` : ""}`);
  for (const aviso of avisos.slice(0, 8)) console.log(`   · ${aviso.slice(0, 200)}`);
  await context.close();
}

await browser.close();
