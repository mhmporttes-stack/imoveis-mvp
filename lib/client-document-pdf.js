import "server-only";
import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_DOCS_BUCKET, downloadClientDocumentBuffer, getClientDocumentSignedUrl } from "./media-storage";
import { DOCUMENT_TYPE_OPTIONS } from "./document-type-options";
import { MARITAL_LABELS, INCOME_LABELS, DOCUMENT_STATUS_LABELS as STATUS_LABELS, PERSON_ROLE_LABELS } from "./document-status-labels";

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
  const [{ data: documents, error }, brokerName, checklist] = await Promise.all([
    db().from("client_documents").select("id, filename, storage_path, mime_type").eq("client_id", clientId).is("deleted_at", null).order("created_at", { ascending: true }),
    getBrokerName(registration.responsibleUserId),
    getChecklistSummary(clientId)
  ]);
  if (error) throw error;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  drawCoverPages(pdfDoc, font, boldFont, registration, brokerName, checklist);

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

async function getBrokerName(brokerId) {
  if (!brokerId) return "";
  const { data } = await db().from("admin_users").select("name").eq("id", brokerId).maybeSingle();
  return data?.name || "";
}

// Mesmo estado que aparece na tela (client_document_checklist_items do
// cliente inteiro) — nunca reconstrói nada, só lê o que já existe.
async function getChecklistSummary(clientId) {
  const { data } = await db()
    .from("client_document_checklist_items")
    .select("person_label, person_role, document_type, status")
    .eq("client_id", clientId)
    .order("person_role", { ascending: true });

  return (data || []).map((row) => {
    const roleLabel = PERSON_ROLE_LABELS[row.person_role] || row.person_role || "";
    const personLabel = row.person_label && row.person_label !== roleLabel ? `${roleLabel} · ${row.person_label}` : roleLabel || row.person_label;
    return {
      personLabel,
      documentLabel: DOCUMENT_TYPE_OPTIONS.find((option) => option.key === row.document_type)?.label || row.document_type,
      status: row.status
    };
  });
}

function drawCoverPages(pdfDoc, font, boldFont, registration, brokerName, checklist) {
  let page = pdfDoc.addPage(PageSizes.A4);
  const { width, height } = page.getSize();
  const marginX = 45;
  const contentWidth = width - marginX * 2;
  let y = height - 55;

  // Cabeçalho da imobiliária — mesmo texto usado no rodapé do site.
  page.drawText("MATHEUS MACHADO IMÓVEIS · CRECI 323106", { x: marginX, y, size: 10, font: boldFont, color: rgb(0.4, 0.4, 0.4) });
  y -= 26;
  page.drawText("Relatório de Documentação para Análise de Crédito", { x: marginX, y, size: 17, font: boldFont, color: rgb(0.05, 0.15, 0.35) });
  y -= 16;
  page.drawText(
    `Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${brokerName ? ` · Corretor: ${brokerName}` : ""}`,
    { x: marginX, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) }
  );
  y -= 30;

  y = drawSectionTitle(page, boldFont, "1. Dados do proponente", marginX, y);
  y = drawFieldGrid(page, font, boldFont, marginX, y, contentWidth, [
    ["Nome completo", registration.fullName],
    ["CPF", formatDigits(registration.cpf)],
    ["PIS", formatDigits(registration.pis)],
    ["Estado civil", MARITAL_LABELS[registration.primaryMaritalStatus] || ""],
    ["E-mail", registration.email],
    ["Telefone", registration.phone],
    ["Tipo de renda", INCOME_LABELS[registration.primaryIncomeType] || ""],
    ["Filho(s) menor(es) de 18 anos", registration.hasChildrenUnder18 ? "Sim" : "Não"]
  ]);
  y -= 20;

  y = drawSectionTitle(page, boldFont, "2. Conferência documental", marginX, y);
  y -= 6;

  const rowHeight = 20;
  const colDocX = marginX;
  const colPersonX = marginX + contentWidth * 0.55;
  const colStatusX = marginX + contentWidth * 0.8;

  page.drawText("DOCUMENTO", { x: colDocX, y, size: 9, font: boldFont, color: rgb(0.4, 0.4, 0.4) });
  page.drawText("PESSOA", { x: colPersonX, y, size: 9, font: boldFont, color: rgb(0.4, 0.4, 0.4) });
  page.drawText("STATUS", { x: colStatusX, y, size: 9, font: boldFont, color: rgb(0.4, 0.4, 0.4) });
  y -= 8;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= rowHeight;

  for (const item of checklist) {
    if (y < 60) {
      page = pdfDoc.addPage(PageSizes.A4);
      y = height - 55;
    }
    page.drawText(truncate(item.documentLabel, 42), { x: colDocX, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(truncate(item.personLabel, 26), { x: colPersonX, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    const statusColor = item.status === "conforme" ? rgb(0.05, 0.5, 0.3) : item.status === "ausente" ? rgb(0.75, 0.15, 0.15) : rgb(0.75, 0.5, 0.05);
    page.drawText(STATUS_LABELS[item.status] || item.status, { x: colStatusX, y, size: 10, font: boldFont, color: statusColor });
    y -= rowHeight;
  }
  if (!checklist.length) {
    page.drawText("Nenhum item de checklist encontrado.", { x: colDocX, y, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
  }
}

function drawSectionTitle(page, boldFont, text, x, y) {
  page.drawText(text.toUpperCase(), { x, y, size: 11, font: boldFont, color: rgb(0.05, 0.15, 0.35) });
  return y - 20;
}

function drawFieldGrid(page, font, boldFont, x, y, contentWidth, fields) {
  const colWidth = contentWidth / 2;
  fields.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const fx = x + col * colWidth;
    const fy = y - row * 34;
    page.drawText(label.toUpperCase(), { x: fx, y: fy, size: 8, font: boldFont, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(String(value || "Não informado"), { x: fx, y: fy - 13, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
  });
  const rows = Math.ceil(fields.length / 2);
  return y - rows * 34;
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

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
