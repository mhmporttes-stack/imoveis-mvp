// Cache das telas guardado no aparelho (dono, 2026-10-26: "Sim, quero que guarde"): regras puras de
// components/device-view-cache-core.mjs + travas de limpeza (sair, sessão caída, login, "Alterar conta").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEVICE_CACHE_MAX_DETAILS,
  DEVICE_CACHE_MAX_MESSAGES,
  DEVICE_CACHE_SCHEMA,
  DEVICE_CACHE_TTL_MS,
  buildSnapshot,
  canPersistViewerKey,
  isFreshStamp,
  parseViewerKey,
  sanitizeForDevice,
  snapshotDecision,
  usableSnapshot
} from "../components/device-view-cache-core.mjs";

const NOW = Date.UTC(2026, 9, 26, 15, 0, 0);
const OWN = "user-a:user-a";
const OTHER = "user-b:user-b";
const VIEW_AS = "user-a:user-b";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("chave por conta: só a conta própria vai para o aparelho; 'Alterar conta' nunca", () => {
  assert.deepEqual(parseViewerKey(OWN), { realId: "user-a", effectiveId: "user-a" });
  assert.equal(canPersistViewerKey(OWN), true);
  assert.equal(canPersistViewerKey(VIEW_AS), false);
  assert.equal(canPersistViewerKey(""), false);
  assert.equal(canPersistViewerKey("só-um-pedaço"), false);
  assert.equal(canPersistViewerKey("a:b:c"), false);
  assert.equal(buildSnapshot({ key: VIEW_AS, entry: { data: [{ name: "x", at: NOW, value: { a: 1 } }] }, now: NOW }), null);
});

test("validade: 24 h por item; mais velho ou do futuro é descartado", () => {
  assert.equal(isFreshStamp(NOW - DEVICE_CACHE_TTL_MS + 1000, NOW), true);
  assert.equal(isFreshStamp(NOW - DEVICE_CACHE_TTL_MS - 1000, NOW), false);
  assert.equal(isFreshStamp(NOW + 60 * 60 * 1000, NOW), false);
  assert.equal(isFreshStamp(0, NOW), false);
  assert.equal(isFreshStamp("x", NOW), false);

  const snapshot = buildSnapshot({
    key: OWN,
    now: NOW,
    entry: {
      view: { at: NOW - 1000, value: { conversations: [] } },
      details: [],
      data: [
        { name: "novo", at: NOW - 1000, value: { ok: 1 } },
        { name: "velho", at: NOW - DEVICE_CACHE_TTL_MS - 1, value: { ok: 1 } }
      ]
    }
  });
  assert.deepEqual(snapshot.data.map((item) => item.name), ["novo"]);
  // Lido 23 h depois: o item ainda vale; 25 h depois, não.
  assert.equal(usableSnapshot(snapshot, OWN, NOW + 23 * 3600 * 1000).data.length, 1);
  assert.equal(usableSnapshot(snapshot, OWN, NOW + 25 * 3600 * 1000).data.length, 0);
  assert.equal(usableSnapshot(snapshot, OWN, NOW + 25 * 3600 * 1000).view, null);
});

test("nunca mostra dado de outra conta: troca de usuário apaga, 'Alterar conta' não usa", () => {
  const snapshot = buildSnapshot({ key: OWN, now: NOW, entry: { data: [{ name: "clients:default", at: NOW, value: { items: [] } }] } });
  assert.equal(snapshot.schema, DEVICE_CACHE_SCHEMA);
  assert.equal(snapshotDecision(snapshot, OWN), "use");
  assert.equal(snapshotDecision(snapshot, OTHER), "wipe");
  assert.equal(usableSnapshot(snapshot, OTHER, NOW), null);
  // Admin real em "Alterar conta": o registro é dele — não é usado, mas também não é apagado à toa.
  assert.equal(snapshotDecision(snapshot, VIEW_AS), "ignore");
  // Outra pessoa em "Alterar conta" sobre um registro alheio: apaga.
  assert.equal(snapshotDecision(snapshot, "user-c:user-a"), "wipe");
  // Versão antiga do formato ou registro de "Alterar conta" no disco: apaga.
  assert.equal(snapshotDecision({ ...snapshot, schema: 0 }, OWN), "wipe");
  assert.equal(snapshotDecision({ ...snapshot, key: VIEW_AS }, VIEW_AS), "wipe");
  assert.equal(snapshotDecision(null, OWN), "ignore");
});

test("gravar outra conta por cima descarta o registro anterior (não mistura)", () => {
  const previous = buildSnapshot({ key: OTHER, now: NOW, entry: { data: [{ name: "segredo", at: NOW, value: { x: 1 } }] } });
  const next = buildSnapshot({ key: OWN, now: NOW, previous, entry: { data: [{ name: "meu", at: NOW, value: { y: 1 } }] } });
  assert.deepEqual(next.data.map((item) => item.name), ["meu"]);
  // Mesma conta: memória vence item a item e o resto do registro anterior fica.
  const kept = buildSnapshot({ key: OWN, now: NOW + 1000, previous: next, entry: { data: [{ name: "outro", at: NOW + 1000, value: { z: 1 } }] } });
  assert.deepEqual(kept.data.map((item) => item.name).sort(), ["meu", "outro"]);
});

test("filtro de campos sensíveis: sem CPF, PIS, documentos, arquivos, mídia, tokens", () => {
  const client = {
    id: "c1",
    name: "Fulana",
    status: "in_service",
    registration: {
      id: "c1",
      fullName: "Fulana de Tal",
      phone: "(14) 99999-0000",
      cpf: "123.456.789-00",
      pis: "123",
      oldestBirthDate: "1990-01-01",
      preferencesAccessToken: "segredo",
      primaryMonthlyIncome: 3000
    },
    documents: [{ name: "rg.pdf" }],
    documentsCount: 2,
    files: 3,
    pdfData: "data:application/pdf;base64,AAAA",
    photoUrl: "https://storage.exemplo/foto.jpg?token=abc",
    avatarUrl: "/api/admin/whatsapp-chat/contact-photo/1",
    createdAt: new Date(NOW)
  };
  const clean = sanitizeForDevice(client);
  assert.equal(clean.registration.cpf, undefined);
  assert.equal(clean.registration.pis, undefined);
  assert.equal(clean.registration.oldestBirthDate, undefined);
  assert.equal(clean.registration.preferencesAccessToken, undefined);
  assert.equal(clean.registration.fullName, "Fulana de Tal");
  assert.equal(clean.registration.phone, "(14) 99999-0000");
  assert.equal(clean.registration.primaryMonthlyIncome, 3000);
  assert.equal(clean.documents, undefined);
  assert.equal(clean.documentsCount, 2);
  assert.equal(clean.files, 3); // contagem fica
  assert.equal(clean.pdfData, undefined);
  assert.equal(clean.photoUrl, undefined); // link externo/assinado sai
  assert.equal(clean.avatarUrl, "/api/admin/whatsapp-chat/contact-photo/1"); // rota do CRM (confere o login) fica
  assert.equal(clean.createdAt, new Date(NOW).toISOString());
  // Original intacto.
  assert.equal(client.registration.cpf, "123.456.789-00");
});

test("mídia das mensagens: só a rota do CRM, sem nome de arquivo nem endereço de storage; texto fica", () => {
  const detail = {
    conversation: { id: "conv1", contactName: "Fulana" },
    messages: [
      { id: "m1", body: "Olá", media: null },
      { id: "m2", body: "", type: "image", media: { url: "/api/admin/whatsapp-chat/media/m2", mime: "image/jpeg", name: "CPF-fulana.jpg", inbound: true } },
      { id: "m3", body: "", type: "document", media: { url: "https://x.supabase.co/storage/v1/object/public/chat/a.pdf", mime: "application/pdf", name: "holerite.pdf" } },
      { id: "m4", body: "", attachments: [{ url: "https://scontent.fbcdn.net/x.jpg", type: "image" }] },
      { id: "m5", body: "foto", media: { url: "data:image/png;base64,AAAA" } }
    ]
  };
  const clean = sanitizeForDevice(detail);
  assert.equal(clean.messages[0].body, "Olá");
  assert.deepEqual(clean.messages[1].media, { url: "/api/admin/whatsapp-chat/media/m2", mime: "image/jpeg", inbound: true });
  assert.deepEqual(clean.messages[2].media, { mime: "application/pdf" });
  assert.deepEqual(clean.messages[3].attachments, [{ type: "image" }]);
  assert.deepEqual(clean.messages[4].media, {});
  assert.ok(!JSON.stringify(clean).includes("holerite"));
  assert.ok(!JSON.stringify(clean).includes("CPF-fulana"));
  assert.ok(!JSON.stringify(clean).includes("base64"));
});

test("limites: últimas mensagens por conversa e no máximo 8 conversas abertas", () => {
  const messages = Array.from({ length: 150 }, (_, index) => ({ id: `m${index}`, body: `t${index}` }));
  const clean = sanitizeForDevice({ messages });
  assert.equal(clean.messages.length, DEVICE_CACHE_MAX_MESSAGES);
  assert.equal(clean.messages.at(-1).id, "m149");

  const details = Array.from({ length: 12 }, (_, index) => ({ id: `c${index}`, at: NOW - (12 - index) * 1000, value: { messages: [] } }));
  const snapshot = buildSnapshot({ key: OWN, now: NOW, entry: { details } });
  assert.equal(snapshot.details.length, DEVICE_CACHE_MAX_DETAILS);
  assert.equal(snapshot.details[0].id, "c11"); // as mais recentes ficam
});

test("limpeza: sair, sessão caída, login e 'Alterar conta' apagam o aparelho; SW continua sem guardar API/HTML", () => {
  const cache = read("components/chat-view-cache.js");
  assert.match(cache, /export function clearChatCache\(\) \{[\s\S]*return wipeDeviceCache\(\);/);
  assert.match(read("components/AdminLogoutButton.jsx"), /await clearChatCache\(\)/);
  assert.match(read("components/AdminSessionKeeper.jsx"), /clearChatCache\(\)/);
  assert.match(read("components/AdminViewAsSelector.jsx"), /clearChatCache\(\)/);
  assert.match(read("components/AdminViewAsBanner.jsx"), /clearChatCache\(\)/);
  assert.match(read("app/painel-acesso/login/page.jsx"), /<DeviceCacheWipe \/>/);
  assert.match(read("components/DeviceCacheWipe.jsx"), /wipeDeviceCache\(\)/);
  // Troca de usuário na abertura: registro de outra pessoa é apagado ao ler.
  assert.match(read("components/device-view-cache.js"), /decision === "wipe"[\s\S]*deleteRecord\(\)/);
  // Só a conta própria é gravada.
  assert.match(read("components/device-view-cache.js"), /canPersistViewerKey\(key\)/);
  const sw = read("public/sw.js");
  assert.ok(!/indexedDB/i.test(sw), "o service worker não lê o cache das telas");
});
