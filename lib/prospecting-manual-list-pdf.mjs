import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  contactCountLabel,
  formatDateSaoPaulo,
  formatListPhone,
  toWinAnsiSafe,
  truncateToWidth
} from "./prospecting-manual-list-core.mjs";

/**
 * PDF "Lista de Prospecção" (A4, 1 página) — pedido do dono, 2026-10-04. SOMENTE DESENHA a partir do snapshot
 * gravado na geração (nome e telefone de cada contato): reimprimir devolve sempre o mesmo conteúdo.
 * Pensado para IMPRIMIR: fundo branco, um filete azul, linhas cinza finas, tipografia sóbria, caixas ☐
 * desenhadas como retângulo (a fonte padrão não tem o glifo), texto de 11 pt ou mais nas linhas.
 * Identidade: navy #0D3B66 e azul #1769D1; o logo oficial tem partes brancas que somem em fundo claro, então
 * a marca vai como wordmark em texto (decisão do dono/Designer, ver .claude/design/DESIGN.md).
 * Fonte sem embutir (Helvetica/WinAnsi): textos passam por toWinAnsiSafe (acentos mantidos, resto descartado).
 */

const W = 595.28;
const H = 841.89;
const M = 42;
const NAVY = rgb(0.051, 0.231, 0.4); // #0D3B66
const BRAND = rgb(0.09, 0.412, 0.82); // #1769D1
const INK = rgb(0.09, 0.11, 0.16);
const MUTED = rgb(0.34, 0.38, 0.45);
const RULE = rgb(0.835, 0.855, 0.886); // #D5DAE1

const ROWS_TOP = 160;
const PITCH = 20.8;
const NAME_X = M + 50;

export async function gerarListaProspeccaoPdf({ numero, brokerName, createdAt, items }) {
  const rows = (Array.isArray(items) ? items : []).slice(0, 30);
  const created = createdAt ? new Date(createdAt) : new Date();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Lista de Prospecção nº ${numero}`);
  pdf.setAuthor("Matheus Machado Imóveis");
  pdf.setCreator("Matheus Machado Imóveis");
  pdf.setProducer("Matheus Machado Imóveis");
  // Datas fixas = a MESMA lista gera sempre os MESMOS bytes (reimpressão idêntica).
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([W, H]);
  const lines = [];

  function text(value, x, top, size, font, color, align = "left") {
    const content = toWinAnsiSafe(value);
    const width = font.widthOfTextAtSize(content, size);
    const drawX = align === "right" ? x - width : x;
    page.drawText(content, { x: drawX, y: H - top - size * 0.82, size, font, color });
    lines.push(content);
    return width;
  }
  function hr(top, color, thickness) {
    page.drawLine({ start: { x: M, y: H - top }, end: { x: W - M, y: H - top }, thickness, color });
  }

  // Cabeçalho: wordmark + nº da lista, filete azul, título, associado, data e quantidade.
  const brandWidth = text("Matheus Machado", M, 36, 12, bold, NAVY);
  text("Imóveis", M + brandWidth + regular.widthOfTextAtSize(" ", 12), 36, 12, regular, NAVY);
  text(`Lista nº ${numero}`, W - M, 36, 12, bold, BRAND, "right");
  hr(58, BRAND, 1.5);
  text("LISTA DE PROSPECÇÃO", M, 72, 24, bold, NAVY);

  const countText = toWinAnsiSafe(contactCountLabel(rows.length));
  const labelWidth = text("Associado:", M, 111, 11, regular, MUTED);
  const nameMax = W - M * 2 - labelWidth - 8;
  const brokerShown = truncateToWidth(toWinAnsiSafe(brokerName) || "-", nameMax, (t) => bold.widthOfTextAtSize(t, 15));
  text(brokerShown, M + labelWidth + 8, 108, 15, bold, NAVY);
  const dateLabel = text("Data:", M, 133, 11, regular, MUTED);
  text(formatDateSaoPaulo(created), M + dateLabel + 6, 132, 12, bold, INK);
  text(countText, W - M, 132, 12, bold, NAVY, "right");
  hr(154, RULE, 0.8);

  // Linhas: ☐ 01.  Nome ........ (14) 99999-9999
  const phoneColumnWidth = 100;
  const nameMaxWidth = W - M - phoneColumnWidth - 14 - NAME_X;
  rows.forEach((item, index) => {
    const top = ROWS_TOP + index * PITCH;
    page.drawRectangle({ x: M, y: H - (top + 4.2) - 11, width: 11, height: 11, borderColor: NAVY, borderWidth: 1 });
    text(`${String(index + 1).padStart(2, "0")}.`, M + 20, top + 3.2, 11, bold, MUTED);
    const name = truncateToWidth(toWinAnsiSafe(item?.name) || "(sem nome)", nameMaxWidth, (t) => regular.widthOfTextAtSize(t, 12));
    text(name, NAME_X, top + 2.6, 12, regular, INK);
    text(formatListPhone(item?.phone), W - M, top + 2.6, 12, bold, INK, "right");
    hr(top + PITCH - 1.6, RULE, 0.5);
  });

  // Rodapé discreto.
  const footTop = ROWS_TOP + 30 * PITCH + 6;
  text("Matheus Machado Imóveis", M, footTop, 8.5, regular, MUTED);
  text(`Lista nº ${numero} · gerada em ${formatDateSaoPaulo(created)}`, W - M, footTop, 8.5, regular, MUTED, "right");

  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, lines, pageCount: pdf.getPageCount() };
}
