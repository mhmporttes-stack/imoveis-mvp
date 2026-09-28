import { createHash } from "node:crypto";

// Somente bytes idênticos são descartados; mesmo tipo ou mesmo mês não basta.
export async function uniqueDocumentBytes(documents, download) {
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  for (const document of documents || []) {
    let buffer;
    try { buffer = await download(document); } catch { unique.push({ ...document, buffer: null }); continue; }
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (seen.has(hash)) duplicates.push(document.id);
    else { seen.add(hash); unique.push({ ...document, buffer }); }
  }
  return { unique, duplicates };
}
