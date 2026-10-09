// Conversa vinda de anúncio que vira cliente por mensagem (sem roleta no clique) mantém a origem de ANÚNCIO (2026-10-09).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("routeOrganicLead usa a origem de anúncio quando a conversa tem referral de anúncio", () => {
  const lib = readFileSync(new URL("../lib/whatsapp-sponsored-lead.js", import.meta.url), "utf8");
  assert.match(lib, /if \(!isSponsoredAdReferral\(referral\)\) return \{ kind: ORGANIC_KIND/);
  assert.match(lib, /return \{ kind: SPONSORED_KIND, label: SPONSORED_LABEL, metadata: buildSponsoredOriginMetadata\(referral, names, base\) \};/);
  assert.match(lib, /acquisitionContext: \{ \.\.\.context, actor: "sistema", destination: "broker" \}/);
  assert.match(lib, /p_context: \{ \.\.\.context, actor: "sistema", destination: "roulette" \}/);
});
