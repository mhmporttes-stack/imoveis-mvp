import "server-only";
import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_DOCS_BUCKET, downloadClientDocumentBuffer, getClientDocumentSignedUrl } from "./media-storage";

function db() {
  return getSupabaseAdminClient();
}

// Item 2 do pedido: junta todos os documentos do cliente num único PDF, com
// uma capa de dados DIGITADOS (nome/e-mail/PIS/CPF do cadastro, nunca OCR de
// documento) na frente. PDF nativo (mergeado por página, não uma foto de
// cada arquivo) — mantém texto selecionável e tamanho de arquivo menor.
//
// Formatos mesclados nativamente: PDF (todas as páginas) e JPEG/PNG (uma
// página por imagem). WEBP/HEIC/HEIF não são suportados pelo pdf-lib (sem
// dependência nativa de conversão nesta versão) — ficam de fora da mesclagem
// e aparecem em "skipped" para o usuário baixar manualmente se precisar.
export async function buildClientDocumentPdf(clientId, registration) {
  const { data: documents, error } = await db()
    .from("client_documents")
    .select("id, filename, storage_path, mime_type")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  drawCoverPage(pdfDoc, font, boldFont, registration);

  const skipped = [];
  for (const document of documents || []) {
    try {
      const buffer = await downloadClientDocumentBuffer(document.storage_path);
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
  return { path, url, skipped, totalDocuments: (documents || []).length };
}

function drawCoverPage(pdfDoc, font, boldFont, registration) {
  const page = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page.getSize();
  let y = height - 130;

  page.drawText("Documentação para análise de crédito", { x: 50, y, size: 18, font: boldFont, color: rgb(0.05, 0.15, 0.35) });
  y -= 45;

  const fields = [
    ["Nome", registration.fullName],
    ["E-mail", registration.email],
    ["PIS", formatDigits(registration.pis)],
    ["CPF", formatDigits(registration.cpf)],
    ["Telefone", registration.phone]
  ];
  for (const [label, value] of fields) {
    page.drawText(`${label}:`, { x: 50, y, size: 12, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(String(value || "—"), { x: 170, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 24;
  }

  y -= 16;
  page.drawText(
    `Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    { x: 50, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) }
  );
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
