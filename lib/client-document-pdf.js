import "server-only";
import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { uniqueDocumentBytes } from "./document-identity.mjs";
import { coverFacts } from "./document-cover-facts.mjs";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_DOCS_BUCKET, downloadClientDocumentBuffer, getClientDocumentSignedUrl } from "./media-storage";
import { zipFiles } from "./document-zip.mjs";
import { MARITAL_LABELS, INCOME_LABELS } from "./document-status-labels";

function db() {
  return getSupabaseAdminClient();
}

// Item 2 do pedido: junta todos os documentos do cliente num único PDF, com
// uma capa DIGITADA (dados do cadastro + estado real do checklist na hora —
// nunca extraídos de OCR de documento) na frente, no estilo do relatório de
// análise documental de referência. PDF nativo (mergeado por página, não uma
// foto de cada arquivo) — mantém texto selecionável e tamanho menor.
//
// Formatos mesclados nativamente: PDF (todas as páginas) e JPEG/PNG (uma
// página por imagem). WEBP/HEIC/HEIF não são suportados pelo pdf-lib (sem
// dependência nativa de conversão nesta versão) — ficam de fora da mesclagem
// e aparecem em "skipped" para o usuário baixar manualmente se precisar.
export async function buildClientDocumentPdf(clientId, registration) {
  const [{ data: documents, error }, brokerName, facts] = await Promise.all([
    db().from("client_documents").select("id, filename, storage_path, mime_type").eq("client_id", clientId).is("deleted_at", null).order("created_at", { ascending: true }),
    getBrokerName(registration.responsibleUserId), getDocumentFacts(clientId)
  ]);
  if (error) throw error;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const logo = await pdfDoc.embedPng(await readFile(join(process.cwd(), "public/assets/matheus-machado-symbol.png")));
  drawCoverPages(pdfDoc, font, boldFont, registration, brokerName, facts, logo);

  const skipped = [];
  const { unique } = await uniqueDocumentBytes(documents || [], (document) => downloadClientDocumentBuffer(document.storage_path));
  for (const document of unique) {
    try {
      const buffer = document.buffer || await downloadClientDocumentBuffer(document.storage_path);
      if (document.mime_type === "application/pdf") {
        const sourceDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = await pdfDoc.copyPages(sourceDoc, sourceDoc.getPageIndices());
        for (const page of pages) pdfDoc.addPage(page);
      } else if (document.mime_type === "image/jpeg" || document.mime_type === "image/jpg") {
        drawImagePage(pdfDoc, await pdfDoc.embedJpg(buffer));
      } else if (document.mime_type === "image/png") {
        drawImagePage(pdfDoc, await pdfDoc.embedPng(buffer));
      } else {
        skipped.push(document.filename);
      }
    } catch {
      skipped.push(document.filename);
    }
  }

  const bytes = await pdfDoc.save();
  const path = `${clientId}/merged/pacote-${Date.now()}.pdf`;
  const { error: uploadError } = await db().storage.from(CLIENT_DOCS_BUCKET).upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
  if (uploadError) throw new Error(uploadError.message || "Não foi possível salvar o PDF consolidado.");

  const url = await getClientDocumentSignedUrl(path, 3600);
  return { path, url, skipped, totalDocuments: unique.length };
}

const PACKAGES_BUCKET = "client-document-packages";
export async function buildClientDocumentFolder(clientId, registration) {
  const [{ data: documents, error }, { data: classified }, brokerName, facts] = await Promise.all([
    db().from("client_documents").select("id, filename, storage_path, mime_type").eq("client_id", clientId).is("deleted_at", null).order("created_at"),
    db().from("client_document_checklist_items").select("document_id, document_type, confidence").eq("client_id", clientId).not("document_id", "is", null),
    getBrokerName(registration.responsibleUserId), getDocumentFacts(clientId)
  ]);
  if (error) throw error;
  const cover = await PDFDocument.create();
  const [font, boldFont, logo] = await Promise.all([cover.embedFont(StandardFonts.Helvetica), cover.embedFont(StandardFonts.HelveticaBold), readFile(join(process.cwd(), "public/assets/matheus-machado-symbol.png")).then((file) => cover.embedPng(file))]);
  drawCoverPages(cover, font, boldFont, registration, brokerName, facts, logo);
  const folder = String(registration.fullName || "Cliente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 90) || "Cliente";
  const files = [{ name: `${folder}/00_Ficha_do_cliente.pdf`, data: Buffer.from(await cover.save()) }];
  const { unique } = await uniqueDocumentBytes(documents || [], (document) => downloadClientDocumentBuffer(document.storage_path));
  for (const [index, document] of unique.entries()) {
    const match = (classified || []).find((row) => row.document_id === document.id && Number(row.confidence) >= 0.75 && row.document_type !== "nao_identificado");
    const extension = document.filename.match(/\.([a-z0-9]{2,5})$/i)?.[1] || ({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[document.mime_type] || "bin");
    const label = match?.document_type || document.filename.replace(/\.[^.]+$/, "");
    const name = String(label).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 70) || "Arquivo";
    files.push({ name: `${folder}/${String(index + 1).padStart(2, "0")}_${name}.${extension}`, data: document.buffer || await downloadClientDocumentBuffer(document.storage_path) });
  }
  const supabase = db();
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) throw bucketError;
  if (!buckets.some((bucket) => bucket.name === PACKAGES_BUCKET)) {
    const { error: createError } = await supabase.storage.createBucket(PACKAGES_BUCKET, { public: false });
    if (createError && !/already exists/i.test(createError.message || "")) throw createError;
  }
  const path = `${clientId}/pasta-${Date.now()}.zip`;
  const { error: uploadError } = await supabase.storage.from(PACKAGES_BUCKET).upload(path, zipFiles(files), { contentType: "application/zip" });
  if (uploadError) throw uploadError;
  const { data: url, error: urlError } = await supabase.storage.from(PACKAGES_BUCKET).createSignedUrl(path, 604800);
  if (urlError) throw urlError;
  return { path, url: url.signedUrl, totalDocuments: unique.length, skipped: [] };
}

async function getDocumentFacts(clientId) {
  const [{ data }, { data: rows }] = await Promise.all([
    db().from("client_document_batches").select("summary").eq("client_id", clientId).eq("status", "analyzed").order("created_at", { ascending: false }).limit(1),
    db().from("client_document_checklist_items").select("person_label, person_role, document_type, status, confidence, extracted_data").eq("client_id", clientId).not("document_id", "is", null)
  ]);
  return { ...(data?.[0]?.summary?.messageFacts || {}), _income: data?.[0]?.summary?.income || null, _rows: rows || [] };
}

async function getBrokerName(brokerId) {
  if (!brokerId) return "";
  const { data } = await db().from("admin_users").select("name").eq("id", brokerId).maybeSingle();
  return data?.name || "";
}

function drawCoverPages(pdfDoc, font, boldFont, registration, brokerName, facts = {}, logo) {
  let page = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page.getSize();
  const marginX = 38;
  const contentWidth = width - marginX * 2;
  let y = height - 44;

  if (logo) page.drawImage(logo, { x: marginX, y: y - 42, width: 53, height: 42 });
  page.drawText("Matheus Machado", { x: marginX + 64, y: y - 11, size: 18, font: boldFont, color: rgb(0.05, 0.15, 0.35) });
  page.drawText("Corretor de Imóveis", { x: marginX + 64, y: y - 29, size: 11, font, color: rgb(0.3, 0.35, 0.45) });
  y -= 61;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: rgb(0.78, 0.84, 0.92) });
  y -= 29;
  page.drawText("Ficha cadastral", { x: marginX, y, size: 18, font: boldFont, color: rgb(0.05, 0.15, 0.35) });
  y -= 19;
  page.drawText(
    `Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${brokerName ? ` · Corretor: ${brokerName}` : ""}`,
    { x: marginX, y, size: 9.5, font, color: rgb(0.5, 0.5, 0.5) }
  );
  y -= 22;

  const cover = coverFacts(registration, facts._rows, facts);
  y = drawSectionTitle(page, boldFont, "Dados do proponente principal", marginX, y);
  y = drawFieldGrid(page, font, boldFont, marginX, y, contentWidth, [
    ["Nome completo", cover.primary.name],
    ["CPF", formatDigits(cover.primary.cpf)],
    ["Data de nascimento", cover.primary.birth || "Não identificado"],
    ["PIS", formatDigits(cover.primary.pis)],
    ["Estado civil", MARITAL_LABELS[cover.swapped ? registration.secondaryMaritalStatus : registration.primaryMaritalStatus] || ""],
    ["E-mail", cover.swapped ? "" : registration.email],
    ["Telefone", cover.swapped ? "" : registration.phone],
    ["Tipo de renda", INCOME_LABELS[cover.swapped ? registration.secondaryIncomeType : registration.primaryIncomeType] || ""],
    ["Profissão", cover.swapped ? registration.secondaryProfession : registration.primaryProfession],
    ["Dependentes menores", registration.hasChildrenUnder18 === true ? "Sim" : registration.hasChildrenUnder18 === false ? "Não" : ""]
  ].filter(([, value]) => value !== null && value !== undefined && value !== ""));
  y -= 10;
  if (y < 155) { page = pdfDoc.addPage(PageSizes.A4); y = height - 44; }
  y = drawSectionTitle(page, boldFont, "Endereço", marginX, y);
  y = drawFieldGrid(page, font, boldFont, marginX, y, contentWidth, [
    ["Rua / logradouro", cover.address.street], ["Número", cover.address.number],
    ["Complemento", cover.address.complement], ["Bairro", cover.address.neighborhood],
    ["Cidade / UF", [cover.address.city, cover.address.state].filter(Boolean).join(" / ")], ["CEP", cover.address.zip]
  ].filter(([, value]) => value));
  if (!Object.values(cover.address).some(Boolean)) {
    y = drawFieldGrid(page, font, boldFont, marginX, y, contentWidth, [["Endereço", "Não identificado nos documentos"]]);
  }
  if (cover.secondary) {
    y -= 10;
    if (y < 190) { page = pdfDoc.addPage(PageSizes.A4); y = height - 44; }
    y = drawSectionTitle(page, boldFont, cover.secondary.role, marginX, y);
    y = drawFieldGrid(page, font, boldFont, marginX, y, contentWidth, [
      ["Nome completo", cover.secondary.name], ["CPF", formatDigits(cover.secondary.cpf)],
      ["Data de nascimento", cover.secondary.birth || "Não identificado"], ["PIS", formatDigits(cover.secondary.pis)],
      ["E-mail", cover.swapped ? registration.email : ""], ["Telefone", cover.swapped ? registration.phone : ""]
    ].filter(([, value]) => value));
  }
  y -= 12;
  if (facts._income) {
    const income = facts._income;
    if (y < 115 + (income.months?.length || 0) * 21) { page = pdfDoc.addPage(PageSizes.A4); y = height - 44; }
    y = drawSectionTitle(page, boldFont, "Renda por extratos", marginX, y);
    for (const month of income.months || []) {
      page.drawText(`${month.month}: bruto ${formatCurrency(month.gross)} | exclusões ${formatCurrency(month.excluded)} | considerado ${formatCurrency(month.net)}`, { x: marginX + 11, y, size: 10, font });
      y -= 21;
    }
    if (!income.needsValidation) {
      page.drawText(`Média bruta mensal: ${formatCurrency(income.grossMonthlyAverage)}   Média líquida: ${formatCurrency(income.netMonthlyAverage)}`, { x: marginX + 11, y, size: 10.5, font: boldFont });
      y -= 22;
    } else { page.drawText("Cálculo pendente de validação dos três meses.", { x: marginX + 11, y, size: 10.5, font }); y -= 22; }
  }
}

function drawSectionTitle(page, boldFont, text, x, y) {
  page.drawRectangle({ x, y: y - 8, width: page.getWidth() - 2 * x, height: 27, color: rgb(0.94, 0.97, 1) });
  page.drawRectangle({ x, y: y - 8, width: 3, height: 27, color: rgb(0.14, 0.42, 0.74) });
  page.drawText(text.toUpperCase(), { x: x + 12, y: y + 1, size: 11.5, font: boldFont, color: rgb(0.05, 0.15, 0.35) });
  return y - 20;
}

function drawFieldGrid(page, font, boldFont, x, y, contentWidth, fields) {
  const colWidth = contentWidth / 2;
  const rowHeight = 54;
  fields.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const fx = x + col * colWidth;
    const fy = y - row * rowHeight;
    page.drawText(label.toUpperCase(), { x: fx + 11, y: fy - 5, size: 9.5, font: boldFont, color: rgb(0.38, 0.44, 0.54) });
    let size = 13.5;
    let lines = wrapFieldValue(String(value), font, size, colWidth - 23);
    while (lines.length > 2 && size > 8) { size -= 0.5; lines = wrapFieldValue(String(value), font, size, colWidth - 23); }
    for (const [lineIndex, line] of lines.slice(0, 2).entries()) {
      page.drawText(line, { x: fx + 11, y: fy - 23 - lineIndex * 14, size, font, color: rgb(0.06, 0.17, 0.32) });
    }
  });
  const rows = Math.ceil(fields.length / 2);
  for (let row = 1; row <= rows; row += 1) {
    const lineY = y - row * rowHeight + 11;
    page.drawLine({ start: { x, y: lineY }, end: { x: x + contentWidth, y: lineY }, thickness: 0.65, color: rgb(0.83, 0.87, 0.92) });
  }
  if (fields.length > 1) page.drawLine({ start: { x: x + colWidth, y: y + 5 }, end: { x: x + colWidth, y: y - rows * rowHeight + 11 }, thickness: 0.65, color: rgb(0.83, 0.87, 0.92) });
  return y - rows * rowHeight + 8;
}

function wrapFieldValue(value, font, size, width) {
  const lines = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let split = line.length - 1;
      while (split > 1 && font.widthOfTextAtSize(line.slice(0, split), size) > width) split -= 1;
      lines.push(line.slice(0, split));
      line = line.slice(split);
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawImagePage(pdfDoc, image) {
  const page = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page.getSize();
  const scale = Math.min((width - 40) / image.width, (height - 40) / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
}

function formatDigits(value) {
  return value ? String(value) : "";
}
function formatCurrency(value) { return `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`; }
