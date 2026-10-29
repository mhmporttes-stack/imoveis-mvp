// EXT-1 (dono, 2026-10-29): o zip das extensões é sempre gerado do código (scripts/gerar-zips-extensoes.mjs). Falha se a
// versão do zip for diferente da do manifest.json ou se o zip não for exatamente o do código atual.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXTENSOES, caminhoZip, gerarZip, lerZip } from "../scripts/gerar-zips-extensoes.mjs";

for (const extensao of EXTENSOES) {
  test(`${extensao}.zip: versão = manifest e conteúdo = código atual`, () => {
    const manifest = JSON.parse(readFileSync(new URL(`../ferramentas/${extensao}/manifest.json`, import.meta.url), "utf8"));
    const zip = readFileSync(caminhoZip(extensao));
    const arquivos = lerZip(zip);
    const doZip = JSON.parse(arquivos[`${extensao}/manifest.json`].toString("utf8"));
    assert.equal(doZip.version, manifest.version, `zip na ${doZip.version}, código na ${manifest.version} — rode: node scripts/gerar-zips-extensoes.mjs`);
    assert.ok(!Object.keys(arquivos).some((nome) => nome.includes("/tests/")), "testes não vão no zip");
    assert.ok(zip.equals(gerarZip(extensao)), "zip diferente do código — rode: node scripts/gerar-zips-extensoes.mjs");
  });
}

test("zip gerado é lido de volta (deflate) com os mesmos bytes do código", () => {
  const arquivos = lerZip(gerarZip("instagram-seguidor"));
  assert.equal(arquivos["instagram-seguidor/background.js"].toString("utf8"), readFileSync(new URL("../ferramentas/instagram-seguidor/background.js", import.meta.url), "utf8"));
});
