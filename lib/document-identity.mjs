import { createHash } from "node:crypto";

// Somente bytes idênticos são descartados; mesmo tipo ou mesmo mês não basta.
// Downloads em paralelo (antes eram sequenciais, um por vez) — a
// deduplicação por hash roda depois, sobre o resultado já baixado, então
// não depende da ordem de chegada.
export async function uniqueDocumentBytes(documents, download) {
  const results = await Promise.all((documents || []).map(async (document) => {
    try {
      const buffer = await download(document);
      return { document, buffer, ok: true };
    } catch {
      return { document, buffer: null, ok: false };
    }
  }));

  const seen = new Set();
  const unique = [];
  const duplicates = [];
  for (const { document, buffer, ok } of results) {
    if (!ok) { unique.push({ ...document, buffer: null }); continue; }
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (seen.has(hash)) duplicates.push(document.id);
    else { seen.add(hash); unique.push({ ...document, buffer }); }
  }
  return { unique, duplicates };
}
