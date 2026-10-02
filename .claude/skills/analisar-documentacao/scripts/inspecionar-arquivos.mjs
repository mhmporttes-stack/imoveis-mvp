#!/usr/bin/env node
// Inspeção LOCAL de documentos (desenvolvimento/auditoria — nunca produção).
// Para cada arquivo: tipo, tamanho, SHA-256, e para PDF: páginas, caracteres
// de texto por página e se parece ESCANEADO (pouco texto => precisa de visão/OCR).
// No fim, lista duplicados EXATOS (mesmo SHA-256) — mesma regra de
// lib/document-identity.mjs. Não imprime o conteúdo dos documentos, a menos que
// --texto seja passado (e só na tela; nunca grave/commite a saída).
//
// Uso (na raiz do repo):
//   node .claude/skills/analisar-documentacao/scripts/inspecionar-arquivos.mjs <arquivo|pasta> [...] [--texto]
import { readFileSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname, basename } from "node:path";

const args = process.argv.slice(2);
const showText = args.includes("--texto");
const inputs = args.filter((arg) => !arg.startsWith("--"));
if (!inputs.length) {
  console.error("Uso: inspecionar-arquivos.mjs <arquivo|pasta> [...] [--texto]");
  process.exit(1);
}

const files = [];
for (const input of inputs) {
  const stats = statSync(input);
  if (stats.isDirectory()) {
    for (const name of readdirSync(input).sort()) {
      const path = join(input, name);
      if (statSync(path).isFile()) files.push(path);
    }
  } else files.push(input);
}

const MIME = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif" };
// Mesmos tipos aceitos/analisados hoje pelo CRM (lib/media-storage.js, lib/document-analysis.js).
const ANALYZED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MERGED_IN_PDF = new Set(["application/pdf", "image/jpeg", "image/png"]);

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

async function inspectPdf(buffer) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
    pages.push({ page: index, chars: text.length, text });
  }
  await task.destroy();
  const textless = pages.filter((page) => page.chars < 30).length;
  return { pages, scanned: pages.length > 0 && textless / pages.length >= 0.5 };
}

const byHash = new Map();
console.log(`Arquivos: ${files.length}\n`);
for (const path of files) {
  const buffer = readFileSync(path);
  const mime = MIME[extname(path).toLowerCase()] || "desconhecido";
  const sha = createHash("sha256").update(buffer).digest("hex");
  if (!byHash.has(sha)) byHash.set(sha, []);
  byHash.get(sha).push(basename(path));
  const flags = [ANALYZED.has(mime) ? "analisado pela IA" : "NÃO analisado pela IA", MERGED_IN_PDF.has(mime) ? "entra no PDF" : "fica FORA do PDF mesclado"];
  if (buffer.length > 20 * 1024 * 1024) flags.push("ACIMA de 20 MB (recusado no upload)");
  console.log(`• ${basename(path)} — ${mime}, ${(buffer.length / 1024).toFixed(0)} KB, sha256 ${sha.slice(0, 16)}… (${flags.join("; ")})`);
  if (mime === "application/pdf") {
    try {
      const { pages, scanned } = await inspectPdf(buffer);
      console.log(`  PDF: ${pages.length} página(s); texto por página: ${pages.map((page) => page.chars).join(", ")}; ${scanned ? "PARECE ESCANEADO (precisa de visão/OCR)" : "tem camada de texto"}`);
      if (showText) for (const page of pages) console.log(`  --- página ${page.page} ---\n  ${page.text.slice(0, 2000)}`);
    } catch (error) {
      console.log(`  PDF ilegível/corrompido/protegido: ${error.message}`);
    }
  }
}

const duplicates = [...byHash.values()].filter((names) => names.length > 1);
console.log(`\nDuplicados exatos (mesmo SHA-256): ${duplicates.length ? duplicates.map((names) => names.join(" = ")).join(" | ") : "nenhum"}`);
console.log("Obs.: documento reescaneado/refotografado tem bytes diferentes e NÃO aparece aqui (limite conhecido do sistema).");
