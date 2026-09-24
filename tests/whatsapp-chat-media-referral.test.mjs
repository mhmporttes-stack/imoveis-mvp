import test from "node:test";
import assert from "node:assert/strict";
import { audioContentType, audioExtensionForMime, baseMime, inboundAudioMediaId, parseByteRange } from "../lib/whatsapp-media-utils.mjs";
import { SPONSORED_KIND, SPONSORED_LABEL, buildSponsoredOriginMetadata, isSponsoredAdReferral, sanitizeReferral } from "../lib/whatsapp-referral.mjs";
import { floatChannelsToWav } from "../lib/audio-wav.mjs";

// ---------------------------------------------------------------- mídia recebida
test("mime base e extensão dos áudios do WhatsApp (OGG/Opus, AAC, M4A, MP4, AMR)", () => {
  assert.equal(baseMime("audio/ogg; codecs=opus"), "audio/ogg");
  assert.equal(audioExtensionForMime("audio/ogg; codecs=opus"), "ogg");
  assert.equal(audioExtensionForMime("audio/mp4"), "m4a");
  assert.equal(audioExtensionForMime("audio/aac"), "aac");
  assert.equal(audioExtensionForMime("audio/amr"), "amr");
  assert.equal(audioExtensionForMime("audio/mpeg"), "mp3");
  assert.equal(audioExtensionForMime("application/x-desconhecido"), "bin");
});

test("Content-Type entregue ao navegador preserva codecs=opus e nunca serve não-áudio como áudio", () => {
  assert.equal(audioContentType("audio/ogg; codecs=opus"), "audio/ogg; codecs=opus");
  assert.equal(audioContentType("audio/ogg"), "audio/ogg; codecs=opus");
  assert.equal(audioContentType("audio/mp4"), "audio/mp4");
  assert.equal(audioContentType("text/html"), "application/octet-stream");
});

test("Range: intervalo, aberto, últimos N bytes e inválido", () => {
  assert.equal(parseByteRange(null, 1000), null);
  assert.deepEqual(parseByteRange("bytes=0-499", 1000), { start: 0, end: 499 });
  assert.deepEqual(parseByteRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange("bytes=0-0", 1000), { start: 0, end: 0 });
  assert.deepEqual(parseByteRange("bytes=-200", 1000), { start: 800, end: 999 });
  assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 });
  assert.equal(parseByteRange("bytes=2000-", 1000), "invalid");
  assert.equal(parseByteRange("bytes=abc", 1000), "invalid");
  assert.equal(parseByteRange("bytes=10-5", 1000), "invalid");
});

test("ID da mídia do áudio recebido", () => {
  assert.equal(inboundAudioMediaId({ type: "audio", audio: { id: " 123456789012345 ", voice: true } }), "123456789012345");
  assert.equal(inboundAudioMediaId({ type: "audio", audio: {} }), "");
  assert.equal(inboundAudioMediaId(null), "");
});

test("WAV 16 bits: cabeçalho, tamanho e amostras", () => {
  const wav = floatChannelsToWav([new Float32Array([0, 1, -1, 0.5])], 16000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 8); // 4 amostras x 2 bytes
  assert.equal(wav.length, 44 + 8);
  assert.equal(view.getInt16(44 + 2, true), 32767);
  assert.equal(view.getInt16(44 + 4, true), -32768);
});

// ---------------------------------------------------------------- referral de anúncio
test("referral de ANÚNCIO (source_type ad) é patrocinado; post e vazio não", () => {
  assert.equal(isSponsoredAdReferral({ source_type: "ad", source_id: "123", ctwa_clid: "abc" }), true);
  assert.equal(isSponsoredAdReferral({ source_type: "AD" }), true);
  assert.equal(isSponsoredAdReferral({ source_type: "post", source_id: "1" }), false);
  assert.equal(isSponsoredAdReferral({ ctwa_clid: "abc" }), true); // sem tipo, mas identificador de anúncio
  assert.equal(isSponsoredAdReferral({ headline: "só título" }), false);
  assert.equal(isSponsoredAdReferral(null), false);
  assert.equal(isSponsoredAdReferral("texto"), false);
});

test("sanitização guarda só os campos úteis e tolera campos ausentes", () => {
  const clean = sanitizeReferral({
    source_id: "120234", source_type: "ad", source_url: "https://fb.me/x?y=1", headline: "Matheus Machado Corretor",
    body: "", media_type: "video", ctwa_clid: "AbC", video_url: "https://cdn/x.mp4", thumbnail_url: "https://cdn/t.jpg", extra: "x"
  });
  assert.deepEqual(clean, { source_id: "120234", source_type: "ad", source_url: "https://fb.me/x?y=1", headline: "Matheus Machado Corretor", media_type: "video", ctwa_clid: "AbC" });
  assert.deepEqual(sanitizeReferral({}), {});
  assert.deepEqual(sanitizeReferral(undefined), {});
});

test("metadados da origem: canal, entrada, referral e nomes do anúncio só quando existem", () => {
  const withNames = buildSponsoredOriginMetadata({ source_id: "9", source_type: "ad" }, { ad_id: "9", ad_name: "Anúncio A", campaign_name: "Campanha X", adset_name: "" }, { conversation_id: "c1" });
  assert.equal(withNames.channel, "whatsapp");
  assert.equal(withNames.entry, "click_to_whatsapp");
  assert.equal(withNames.ad_name, "Anúncio A");
  assert.equal(withNames.campaign_name, "Campanha X");
  assert.equal("adset_name" in withNames, false);
  assert.equal(withNames.conversation_id, "c1");
  const bare = buildSponsoredOriginMetadata({ ctwa_clid: "z" });
  assert.deepEqual(bare.referral, { ctwa_clid: "z" });
  assert.equal(SPONSORED_KIND, "whatsapp_ad");
  assert.equal(SPONSORED_LABEL, "WhatsApp — Anúncio patrocinado");
});
