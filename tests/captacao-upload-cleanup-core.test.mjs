import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCaptacaoUploadPath,
  extractCaptacaoUploadPathsFromValue,
  selectOrphanCaptacaoUploads
} from "../lib/captacao-upload-cleanup-core.mjs";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const OLD = NOW - 5 * 24 * 3600 * 1000;
const name = (ms, base = "foto-sala.jpg") => `captacoes/${ms}-${UUID}-${base}`;

test("extrai caminho de storagePath e de URL pública", () => {
  const path = name(OLD);
  assert.equal(extractCaptacaoUploadPath(path), path);
  assert.equal(extractCaptacaoUploadPath(`https://x.supabase.co/storage/v1/object/public/property-media/${path}?v=1`), path);
  assert.equal(extractCaptacaoUploadPath("https://x.supabase.co/storage/v1/object/public/property-media/imovel-1/foto.jpg"), "");
  assert.equal(extractCaptacaoUploadPath(""), "");
});

test("acha referências em qualquer formato salvo (array, texto JSON antigo, URL)", () => {
  const a = name(OLD, "a.jpg");
  const b = name(OLD, "b.png");
  const url = `https://x.supabase.co/storage/v1/object/public/property-media/${b}`;
  assert.deepEqual(extractCaptacaoUploadPathsFromValue([{ name: "a", data: "https://x/y", storagePath: a }]).sort(), [a]);
  assert.deepEqual(extractCaptacaoUploadPathsFromValue(JSON.stringify([{ data: url }])), [b]);
  assert.deepEqual(extractCaptacaoUploadPathsFromValue([url]), [b]);
  assert.deepEqual(extractCaptacaoUploadPathsFromValue(null), []);
});

test("só apaga arquivo gerado pelo upload, antigo e não referenciado; respeita o limite", () => {
  const used = name(OLD, "usada.jpg");
  const orphanOld = name(OLD, "orfa.jpg");
  const orphanRecent = name(NOW - 3600 * 1000, "recente.jpg");
  const foreign = "captacoes/manual-da-equipe.jpg";
  const objects = [
    { path: used, createdAt: new Date(OLD).toISOString() },
    { path: orphanOld, createdAt: new Date(OLD).toISOString() },
    { path: orphanRecent, createdAt: new Date(NOW - 3600 * 1000).toISOString() },
    { path: foreign, createdAt: new Date(OLD).toISOString() },
    { path: "imovel-1/123-foto.jpg", createdAt: new Date(OLD).toISOString() }
  ];
  const result = selectOrphanCaptacaoUploads(objects, new Set([used]), { now: NOW, minAgeMs: 72 * 3600 * 1000, limit: 10 });
  assert.deepEqual(result, [orphanOld]);
  assert.deepEqual(selectOrphanCaptacaoUploads(objects, new Set(), { now: NOW, minAgeMs: 72 * 3600 * 1000, limit: 0 }), []);
});

test("sem data de criação usa o timestamp do nome; idade desconhecida nunca é apagada", () => {
  const byName = name(OLD, "sem-data.jpg");
  const result = selectOrphanCaptacaoUploads([{ path: byName, createdAt: "" }], new Set(), { now: NOW, minAgeMs: 72 * 3600 * 1000, limit: 10 });
  assert.deepEqual(result, [byName]);
});
