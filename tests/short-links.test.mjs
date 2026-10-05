import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanRef, displayLink, isUuid, safeDecode, shortCampaignPath, shortCaptacaoPath, shortJourneyPath, shortSimulationPath } from "../lib/short-links.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");

test("caminhos curtos", () => {
  assert.equal(shortSimulationPath(""), "/s");
  assert.equal(shortSimulationPath("Ana-Souza_1"), "/s/ana-souza_1");
  assert.equal(shortSimulationPath("a b/../c"), "/s/abc");
  assert.equal(shortCaptacaoPath(""), "/v");
  assert.equal(shortCaptacaoPath("ana"), "/v/ana");
  assert.equal(shortCampaignPath("A3F9B21"), "/c/a3f9b21");
  assert.equal(shortCampaignPath(""), "");
  assert.equal(shortJourneyPath("abc123"), "/j/abc123");
  assert.equal(cleanRef(" Ref!! "), "ref");
  assert.equal(isUuid("3f2b8c1e-1111-4222-8333-444455556666"), true);
  assert.equal(isUuid("a3f9b21"), false);
  assert.equal(safeDecode("%E0%A4%A"), "%E0%A4%A", "percent-encoding malformado não lança");
});

test("os construtores de link do CRM geram a versão curta e as rotas redirecionam para a URL longa de sempre", () => {
  // Os links GERADOS pelo CRM voltaram ao formato longo (decisão do dono 2026-10-05); as rotas curtas seguem funcionando.
  assert.match(source("lib/admin-profiles.js"), //simulacao?ref=${encodeURIComponent(ref)}/);
  assert.match(source("lib/campaigns.js"), //simulacao?c=${encodeURIComponent(campaign.id)}/);
  assert.doesNotMatch(source("lib/admin-profiles.js"), /shortSimulationPath/);
  assert.match(source("app/s/route.js"), /target\.pathname = "\/simulacao"/);
  assert.match(source("app/s/[ref]/route.js"), /target\.searchParams\.set\("ref", resolved\)/);
  assert.match(source("app/c/[code]/route.js"), /from\("campaigns"\)\.select\("id"\)\.eq\("short_code", clean\)/);
  assert.match(source("app/c/[code]/route.js"), /target\.searchParams\.set\("c", campaignId\)/);
  assert.match(source("app/v/[ref]/route.js"), /target\.pathname = "\/captacao"/);
  assert.match(source("app/j/[token]/route.js"), /\/minha-jornada\//);
  // Prévia: simulação/captação respondem 200 com Open Graph direto no link curto (crawlers não seguem redirects bem);
  // quem abre no navegador é levado ao destino (meta refresh + script). /j (token privado) continua redirect 307.
  for (const file of ["app/s/route.js", "app/s/[ref]/route.js", "app/c/[code]/route.js", "app/v/route.js", "app/v/[ref]/route.js"]) {
    assert.match(source(file), /sharePreviewResponse\(request, target,/, file);
    assert.match(source(file), /request\.nextUrl\.clone\(\)/, `${file} repassa os demais parâmetros (utm, jornada…)`);
  }
  assert.match(source("app/j/[token]/route.js"), /NextResponse\.redirect\(url, 307\)/);
  const html = source("lib/share-preview-html.mjs");
  for (const tag of ["og:title", "og:description", "og:image\"", "og:url", "twitter:card", "rel=\"canonical\"", "http-equiv=\"refresh\"", "location.replace"]) assert.ok(html.includes(tag), tag);
});

test("código curto por usuário (short_ref): resolve para o ref de atribuição e o ref longo antigo continua valendo", () => {
  assert.equal(displayLink("https://www.matheusmachadoimoveis.com.br/s/mhm"), "matheusmachadoimoveis.com.br/s/mhm");
  assert.match(source("lib/short-ref-resolver.js"), /\.eq\("short_ref", clean\)/);
  assert.match(source("lib/short-ref-resolver.js"), /return resolved \|\| clean;/, "sem código curto, o valor é o ref de sempre");
  assert.match(source("app/s/[ref]/route.js"), /resolveShortRef\(.*"simulation"\)/);
  assert.match(source("app/v/[ref]/route.js"), /resolveShortRef\(.*"captacao"\)/);
  assert.match(source("supabase/migrations/20261005010000_admin_users_short_ref.sql"), /set short_ref = 'mhm'/);
});
