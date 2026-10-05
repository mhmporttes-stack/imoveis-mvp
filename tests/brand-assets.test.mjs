// Trava da identidade visual (CLAUDE.md regra 10): a logo antiga (prédios/skyline) foi apagada
// e nada pode voltar a referenciá-la; os assets oficiais atuais precisam existir.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const OLD_ASSETS = [
  "public/assets/matheus-machado-logo.png",
  "public/assets/matheus-machado-logo-transparent.png",
  "public/assets/matheus-machado-logo-premium.jpeg",
  "public/assets/matheus-machado-symbol-premium.png",
  "public/assets/company-mark-avatar.png",
  "public/icons/apple-touch-icon.png",
  "public/icons/favicon-32.png",
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "public/icons/icon-maskable-192.png",
  "public/icons/icon-maskable-512.png"
];
const OFFICIAL = [
  "public/assets/matheus-machado-symbol.png",
  "public/assets/og-matheus-machado-v2.png",
  "public/icons/favicon-32-mm.png",
  "public/icons/apple-touch-icon-mm.png",
  "public/icons/icon-192-mm.png",
  "public/icons/icon-512-mm.png",
  "public/icons/icon-maskable-192-mm.png",
  "public/icons/icon-maskable-512-mm.png"
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (["node_modules", ".next", ".git", "scratch"].includes(e.name)) continue;
      walk(rel, out);
    } else if (/\.(js|jsx|mjs|ts|tsx|css|json|html|md)$/.test(e.name)) out.push(rel);
  }
  return out;
}

test("logos antigas não existem mais no projeto", () => {
  for (const f of OLD_ASSETS) assert.equal(fs.existsSync(path.join(root, f)), false, `logo antiga voltou: ${f}`);
});

test("assets oficiais atuais existem", () => {
  for (const f of OFFICIAL) assert.ok(fs.existsSync(path.join(root, f)), `asset oficial sumiu: ${f}`);
});

test("nenhum código/config referencia a logo antiga", () => {
  const needles = [
    /matheus-machado-logo/,
    /matheus-machado-symbol-premium/,
    /company-mark-avatar/,
    /\/icons\/(apple-touch-icon|favicon-32|icon-(maskable-)?(192|512))\.png/
  ];
  const files = [...walk("app"), ...walk("components"), ...walk("lib"), ...walk("scripts"), ...walk("public"), "proxy.js", "next.config.mjs"]
    .filter((f) => fs.existsSync(path.join(root, f)) && !f.endsWith("public/sw.js"));
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    if (needles.some((n) => n.test(text))) hits.push(f);
  }
  assert.deepEqual(hits, [], `referência à logo antiga em: ${hits.join(", ")}`);
});

test("manifest, layout e service worker usam só ícones oficiais (-mm)", () => {
  for (const f of ["app/manifest.js", "app/layout.jsx", "public/sw.js"]) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of text.matchAll(/\/icons\/([a-z0-9-]+)\.png/g)) assert.ok(m[1].endsWith("-mm"), `${f} usa ícone sem -mm: ${m[1]}`);
  }
});
