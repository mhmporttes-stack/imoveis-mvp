import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLeadOrigin, googleAdsLabel, isGoogleAdsAttribution, classifyPaidMedia, hasPaidMediaEvidence, GOOGLE_ADS_TAG } from "../lib/lead-origin.js";
import {
  AD_ATTRIBUTION_COOKIE,
  cleanClickId,
  parseAdAttributionCookie,
  pickAdAttribution,
  resolveAdAttribution,
  serializeAdAttributionCookie
} from "../lib/ad-click-attribution.mjs";
import { buildSendTo, createGoogleAdsLeadTracker, leadDedupeKey, normalizeAdsId } from "../lib/google-ads-client.mjs";

const GCLID = "Cj0KCQiAabcdEFGH1234567890_-xyz";
const URL_GOOGLE = `utm_source=google&utm_medium=cpc&utm_campaign=apps-marilia&utm_content=criativo-1&utm_term=app-x&gclid=${GCLID}`;
const params = (query) => new URLSearchParams(query);

// ---- Captura de UTM + gclid/gbraid/wbraid ----
test("captura UTM e identificadores de clique da URL; ignora id inválido", () => {
  const picked = pickAdAttribution(params(`${URL_GOOGLE}&gbraid=curto&wbraid=${GCLID}`));
  assert.equal(picked.utm_source, "google");
  assert.equal(picked.gclid, GCLID);
  assert.equal(picked.wbraid, GCLID);
  assert.equal("gbraid" in picked, false); // "curto" não é um id válido
  assert.equal(cleanClickId("<script>alert(1)</script>"), "");
});

test("cookie de 1ª parte: ida e volta, 90 dias, expira", () => {
  const now = Date.now();
  const cookie = serializeAdAttributionCookie(pickAdAttribution(params(URL_GOOGLE)), { secure: true, now });
  assert.match(cookie, new RegExp(`^${AD_ATTRIBUTION_COOKIE}=`));
  assert.match(cookie, /Max-Age=7776000/); // 90 dias
  assert.match(cookie, /SameSite=Lax; Secure/);
  const header = `outro=1; ${cookie.split(";")[0]}`;
  assert.equal(parseAdAttributionCookie(header, now + 1000).gclid, GCLID);
  assert.deepEqual(parseAdAttributionCookie(header, now + 91 * 24 * 3600 * 1000), {});
  assert.deepEqual(parseAdAttributionCookie("", now), {});
  assert.deepEqual(parseAdAttributionCookie(`${AD_ATTRIBUTION_COOKIE}=lixo`, now), {});
});

test("cadastro leva a URL de agora; sem parâmetros na URL usa o clique guardado; sempre as 5 UTM", () => {
  const stored = pickAdAttribution(params(URL_GOOGLE));
  const direct = resolveAdAttribution(params(""), stored);
  assert.equal(direct.gclid, GCLID);
  assert.equal(direct.utm_campaign, "apps-marilia");
  const newer = resolveAdAttribution(params("utm_source=instagram&utm_medium=social"), stored);
  assert.equal(newer.utm_source, "instagram");
  assert.equal("gclid" in newer, false);
  const none = resolveAdAttribution(params(""), {});
  assert.deepEqual(Object.keys(none), ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]);
  assert.ok(Object.values(none).every((value) => value === ""));
});

// ---- Origem derivada no servidor ----
test("origem Google Ads — Aplicativos: kind, label, metadata e tag", () => {
  const attribution = resolveAdAttribution(params(URL_GOOGLE), {});
  const origin = buildLeadOrigin({ attribution, roulette: true });
  assert.equal(origin.kind, "paid_link");
  assert.equal(origin.label, "Google Ads — Aplicativos");
  assert.equal(origin.destination, "roulette"); // distribuição como qualquer lead do site
  assert.equal(origin.metadata.gclid, GCLID);
  assert.equal(origin.metadata.utm_campaign, "apps-marilia");
  assert.equal(origin.metadata.utm_content, "criativo-1");
  assert.equal(origin.metadata.google_ads, true);
  assert.equal(origin.metadata.paid_media, true);
  assert.equal(origin.metadata.paid_channel, "google_ads");
  assert.equal(hasPaidMediaEvidence(origin.kind, origin.metadata), true);
  assert.equal(GOOGLE_ADS_TAG, "Google Ads");
});

test("Google Ads por gclid sozinho (sem UTM) ou por source google + cpc", () => {
  assert.equal(buildLeadOrigin({ attribution: { gclid: GCLID } }).label, "Google Ads — Aplicativos");
  assert.equal(buildLeadOrigin({ attribution: { gbraid: GCLID } }).metadata.google_ads, true);
  const other = buildLeadOrigin({ attribution: { utm_source: "google", utm_medium: "cpc", utm_campaign: "busca-marilia" } });
  assert.equal(other.label, "Google Ads — busca-marilia");
  assert.equal(googleAdsLabel("APPS_marilia"), "Google Ads — Aplicativos");
  assert.equal(googleAdsLabel("appstore"), "Google Ads — appstore");
});

test("não confunde: Google orgânico, Meta pago e site continuam como antes", () => {
  assert.equal(isGoogleAdsAttribution({ utm_source: "google", utm_medium: "organic" }), false);
  assert.equal(isGoogleAdsAttribution({ utm_source: "fb", utm_medium: "paid" }), false);
  assert.equal(isGoogleAdsAttribution({ gclid: "curto" }), false);
  const meta = buildLeadOrigin({ attribution: { utm_source: "fb", utm_medium: "paid", utm_campaign: "123" } });
  assert.equal(meta.label, "Cadastro patrocinado — 123");
  assert.equal(meta.metadata.paid_channel, "meta_site");
  assert.equal("google_ads" in meta.metadata, false);
  assert.equal(buildLeadOrigin({}).label, "Link Geral do Site");
  assert.equal(classifyPaidMedia({ utm_source: "google", utm_medium: "cpc" }).channel, null);
});

test("link pessoal/campanha continuam mandando na origem; Google fica no metadata", () => {
  const attribution = resolveAdAttribution(params(URL_GOOGLE), {});
  assert.equal(buildLeadOrigin({ direct: true, ref: "luana", attribution }).kind, "broker_link");
  const campaign = { id: "c1", name: "Campanha X" };
  const byCampaign = buildLeadOrigin({ campaign, attribution });
  assert.equal(byCampaign.kind, "campaign");
  assert.equal(byCampaign.metadata.google_ads, true);
});

// ---- Evento de conversão ----
function harness({ configured = true, gtag = true, consent = true } = {}) {
  const calls = [];
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const timers = [];
  const tracker = createGoogleAdsLeadTracker({
    sendTo: configured ? "AW-123456789/AbCdEf_123" : "",
    getGtag: () => (gtag ? (...args) => calls.push(args) : null),
    storage,
    hasConsent: () => consent,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {}
  });
  return { tracker, calls, store, timers };
}

test("dispara 1x no sucesso, com transaction_id e sem dado pessoal", async () => {
  const { tracker, calls, timers } = harness();
  const promise = tracker({ id: "reg-1" });
  assert.equal(calls.length, 1);
  const [command, name, payload] = calls[0];
  assert.equal(command, "event");
  assert.equal(name, "conversion");
  assert.equal(payload.send_to, "AW-123456789/AbCdEf_123");
  assert.equal(payload.transaction_id, "reg-1");
  assert.deepEqual(Object.keys(payload).sort(), ["event_callback", "send_to", "transaction_id"]);
  assert.ok(timers[0].ms <= 300);
  payload.event_callback(); // o Google confirmou: libera o redirecionamento na hora
  assert.deepEqual(await promise, { fired: true });
});

test("sem confirmação do Google o redirecionamento espera no máximo 300 ms (timer)", async () => {
  const { tracker, timers } = harness();
  const promise = tracker({ id: "reg-2" });
  timers[0].fn();
  assert.deepEqual(await promise, { fired: true });
});

test("0x sem id do cadastro, sem configuração, sem gtag, sem consentimento", async () => {
  for (const [input, options, reason] of [
    [{}, {}, "no_id"],
    [{ id: "" }, {}, "no_id"],
    [{ id: "reg-3" }, { configured: false }, "not_configured"],
    [{ id: "reg-3" }, { gtag: false }, "gtag_unavailable"],
    [{ id: "reg-3" }, { consent: false }, "no_consent"]
  ]) {
    const { tracker, calls } = harness(options);
    const result = await tracker(input);
    assert.equal(result.fired, false);
    assert.equal(result.reason, reason);
    assert.equal(calls.length, 0);
  }
});

test("dedupe por cadastro: segundo envio do mesmo id não dispara; outro id dispara", async () => {
  const { tracker, calls, timers, store } = harness();
  const first = tracker({ id: "reg-4" });
  const second = await tracker({ id: "reg-4" });
  assert.equal(second.reason, "duplicate");
  assert.equal(store.has(leadDedupeKey("reg-4")), true);
  timers[0].fn();
  await first;
  const other = tracker({ id: "reg-5" });
  timers[1].fn();
  await other;
  assert.equal(calls.length, 2);
});

test("valor só quando informado (BRL); falha do gtag não derruba o cadastro", async () => {
  const withValue = harness();
  const promise = withValue.tracker({ id: "reg-6", value: 10 });
  assert.equal(withValue.calls[0][2].value, 10);
  assert.equal(withValue.calls[0][2].currency, "BRL");
  withValue.timers[0].fn();
  await promise;
  const broken = createGoogleAdsLeadTracker({ sendTo: "AW-123456789/AbCdEf_123", getGtag: () => () => { throw new Error("boom"); }, storage: null });
  assert.deepEqual(await broken({ id: "reg-7" }), { fired: false, reason: "error" });
});

test("IDs do Google validados (nada de script injetado) e rótulo aceita as duas formas", () => {
  assert.equal(normalizeAdsId("AW-123456789"), "AW-123456789");
  assert.equal(normalizeAdsId("AW-1');alert(1);//"), "");
  assert.equal(normalizeAdsId(""), "");
  assert.equal(buildSendTo("AW-123456789", "AbCdEf_123"), "AW-123456789/AbCdEf_123");
  assert.equal(buildSendTo("AW-123456789", "AW-123456789/AbCdEf_123"), "AW-123456789/AbCdEf_123");
  assert.equal(buildSendTo("AW-123456789", ""), "");
  assert.equal(buildSendTo("", "AbCdEf_123"), "");
});

// ---- Ligação no formulário: só no sucesso, antes do redirecionamento; fluxo do WhatsApp intacto ----
test("SimulationForm: conversão só depois de response.ok, antes de abrir o WhatsApp; Meta e fluxo intactos", () => {
  const source = readFileSync(new URL("../components/simulation-form/SimulationForm.jsx", import.meta.url), "utf8");
  const notOk = source.indexOf("if (!response.ok)");
  const track = source.indexOf("await trackGoogleAdsLead({ id: data.registrationId })");
  const redirect = source.indexOf("await openWhatsappOrFallback(nextContext)");
  assert.ok(notOk > 0 && track > notOk && redirect > track);
  assert.equal(source.split("trackGoogleAdsLead(").length - 1, 1); // uma única chamada
  assert.match(source, /if \(data\.isNewRegistration !== false\) await trackGoogleAdsLead/);
  assert.match(source, /trackMetaLead\(\{ phone: validation\.data\.phoneNormalized/);
  assert.match(source, /\.\.\.currentAdAttribution\(searchParams\)/);
});

test("QuickAttendanceForm: conversão só depois de response.ok", () => {
  const source = readFileSync(new URL("../components/simulation-form/QuickAttendanceForm.jsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("trackGoogleAdsLead({ id: data.registrationId })") > source.indexOf("if (!response.ok)"));
  assert.equal(source.split("trackGoogleAdsLead(").length - 1, 1);
});

test("gtag.js só nas páginas públicas e só com NEXT_PUBLIC_GOOGLE_ADS_ID", () => {
  const chrome = readFileSync(new URL("../components/AppChrome.jsx", import.meta.url), "utf8");
  assert.match(chrome, /\{!isAdminRoute \? <GoogleAds \/> : null\}/);
  const component = readFileSync(new URL("../components/GoogleAds.jsx", import.meta.url), "utf8");
  assert.match(component, /if \(!GOOGLE_ADS_ID\) return null/);
  assert.match(component, /strategy="afterInteractive"/);
});

test("servidor: etiqueta Google Ads só pelo metadata derivado no servidor", () => {
  const source = readFileSync(new URL("../lib/simulation-registrations.js", import.meta.url), "utf8");
  assert.equal(source.split("googleAds: registrationData.acquisitionContext?.metadata?.google_ads === true").length - 1, 2);
  assert.match(source, /addTagToClient\(registration\.id, GOOGLE_ADS_TAG\)/);
});
