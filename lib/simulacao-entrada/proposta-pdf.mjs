import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * PDF "Proposta de Valores" (A4) — versão para o cliente da apresentação de valores do
 * empreendimento. SOMENTE DESENHA: todos os números vêm de `buildPresentationModel`
 * (presentation-model.mjs); aqui só há formatação e layout. Nenhuma conta financeira.
 */

const W = 595.28;
const H = 841.89;
const M = 42;
const CW = W - M * 2;
const HEADER_H = 74;
const TOP = 100;
const BOTTOM = H - 62;

const NAVY = rgb(0.051, 0.231, 0.4); // #0D3B66
const BRAND = rgb(0.09, 0.412, 0.82); // #1769D1
const PANEL = rgb(0.957, 0.976, 1); // #F4F9FF
const MIST = rgb(0.961, 0.969, 0.98); // #F5F7FA
const LINE = rgb(0.898, 0.918, 0.945); // #E5EAF1
const MUTED = rgb(0.4, 0.45, 0.52);
const WHITE = rgb(1, 1, 1);
const ON_NAVY_SOFT = rgb(0.8, 0.86, 0.94); // texto secundário sobre o navy
const SUCCESS = rgb(0.027, 0.463, 0.278); // #067647
const BRAND_SOFT_LINE = rgb(0.74, 0.83, 0.95);

export function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(value) || 0)
    .replace(/ /g, " ");
}

export function sanitizeFileName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40);
}

export async function gerarPropostaValoresPdf({ model, clienteNome, dataTexto, empreendimento = {}, logoBytes = null }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Proposta de Valores - ${empreendimento.nome || model.empreendimentoNome || ""}`.trim());
  pdf.setAuthor("Matheus Machado Imóveis");
  pdf.setCreator("Matheus Machado Imóveis");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  if (logoBytes) {
    try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; }
  }

  const boxes = []; // {page, x, y(top), w, h, kind}
  const texts = []; // {page, text}
  const pages = [];
  let page = null;
  let y = TOP;

  const encodable = new Map();
  function safe(text, font) {
    let out = "";
    for (const ch of String(text ?? "").replace(/\s+/g, " ")) {
      const key = `${font === bold ? "b" : "r"}${ch}`;
      if (!encodable.has(key)) {
        let ok = true;
        try { font.encodeText(ch); } catch { ok = false; }
        encodable.set(key, ok);
      }
      out += encodable.get(key) ? ch : "?";
    }
    return out;
  }

  function newPage() {
    page = pdf.addPage([W, H]);
    pages.push(page);
    const pageIndex = pages.length - 1;
    // Cabeçalho: faixa navy (token do sistema visual) para a parte clara da marca aparecer.
    page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: NAVY });
    page.drawRectangle({ x: 0, y: H - HEADER_H - 2, width: W, height: 2, color: BRAND });
    boxes.push({ page: pageIndex, x: 0, y: 0, w: W, h: HEADER_H, kind: "band" });
    let textX = M;
    if (logo) {
      // Asset oficial único (recebido de fora; proporção original preservada).
      const hh = 36;
      const w = (logo.width / logo.height) * hh;
      const top = (HEADER_H - hh) / 2;
      page.drawImage(logo, { x: M, y: H - top - hh, width: w, height: hh });
      boxes.push({ page: pageIndex, x: M, y: top, w, h: hh, kind: "logo" });
      textX = M + w + 12;
    }
    text("MATHEUS MACHADO", textX, 21, 13, bold, WHITE);
    text("CORRETOR DE IMÓVEIS", textX, 38, 8, bold, ON_NAVY_SOFT);
    text("PROPOSTA DE VALORES", W - M, 23, 9, bold, WHITE, "right");
    text(dataTexto || "", W - M, 38, 9, regular, ON_NAVY_SOFT, "right");
    y = TOP;
  }

  function text(value, x, top, size, font, color, align = "left", maxWidth = null) {
    const content = safe(value, font);
    let width = font.widthOfTextAtSize(content, size);
    let drawX = x;
    if (align === "right") drawX = x - width;
    if (align === "center") drawX = x - width / 2;
    page.drawText(content, { x: drawX, y: H - top - size * 0.82, size, font, color });
    boxes.push({ page: pages.length - 1, x: drawX, y: top, w: width, h: size, kind: "text" });
    texts.push({ page: pages.length - 1, text: content });
    return width;
  }

  function wrap(value, font, size, maxWidth) {
    const words = safe(value, font).split(" ").filter(Boolean);
    const lines = [];
    let line = "";
    const push = () => { if (line) lines.push(line); line = ""; };
    for (const word of words) {
      let piece = word;
      // palavra maior que a linha: quebra por caractere
      while (font.widthOfTextAtSize(piece, size) > maxWidth) {
        let cut = piece.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(piece.slice(0, cut), size) > maxWidth) cut -= 1;
        push();
        lines.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      const candidate = line ? `${line} ${piece}` : piece;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else { push(); line = piece; }
    }
    push();
    return lines.length ? lines : [""];
  }

  function paragraph(value, x, top, size, font, color, maxWidth, lineHeight = size * 1.28, align = "left") {
    const lines = wrap(value, font, size, maxWidth);
    lines.forEach((line, i) => text(line, align === "center" ? x + maxWidth / 2 : x, top + i * lineHeight, size, font, color, align));
    return lines.length * lineHeight;
  }

  function roundedRect(x, top, w, h, r, { fill, border, borderWidth = 1 }) {
    const path = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    page.drawSvgPath(path, { x, y: H - top, color: fill, borderColor: border, borderWidth: border ? borderWidth : 0 });
    boxes.push({ page: pages.length - 1, x, y: top, w, h, kind: "rect" });
  }

  function ensure(h) {
    if (y + h > BOTTOM) newPage();
  }

  function label(value, x, top, color = BRAND, align = "left") {
    return text(String(value).toUpperCase(), x, top, 8, bold, color, align);
  }

  newPage();

  // ---- Identificação -------------------------------------------------------
  label("Proposta personalizada para", M, y);
  y += 16;
  let nameSize = 26;
  while (nameSize > 16 && wrap(clienteNome || "Cliente", bold, nameSize, CW).length > 2) nameSize -= 2;
  y += paragraph(clienteNome || "Cliente", M, y, nameSize, bold, NAVY, CW, nameSize * 1.2) + 14;

  const builder = empreendimento.construtora || "";
  if (builder) { label(builder, M, y); y += 14; }
  y += paragraph(empreendimento.nome || model.empreendimentoNome || "Empreendimento", M, y, 17, bold, NAVY, CW, 21) + 2;
  if (empreendimento.localizacao) {
    y += paragraph(empreendimento.localizacao, M, y + 2, 10, regular, MUTED, CW, 13) + 2;
  }
  y += 8;

  // ---- Valor do imóvel (destaque navy, como na apresentação) ---------------
  ensure(80);
  roundedRect(M, y, CW, 74, 14, { fill: NAVY });
  text("VALOR TOTAL DO IMÓVEL", W / 2, y + 15, 9, bold, rgb(0.8, 0.86, 0.94), "center");
  text(formatBRL(model.valorImovel), W / 2, y + 32, 32, bold, WHITE, "center");
  y += 74 + 12;

  // ---- Descontos e benefícios ----------------------------------------------
  if (model.temDescontosOuBeneficios) {
    const rows = [
      ...model.descontos.map((d) => ({ label: d.label, valor: d.valor })),
      ...(model.subsidioMcmv > 0 ? [{ label: "Subsídio Minha Casa Minha Vida", valor: model.subsidioMcmv }] : []),
      ...(model.casaPaulista > 0 ? [{ label: "Casa Paulista", valor: model.casaPaulista, destaque: true }] : []),
      ...(model.documentacaoGratuita.aplica ? [{ label: "Documentação gratuita", valor: model.documentacaoGratuita.valor }] : [])
    ];
    const rowH = 20;
    const total = 36 + rows.length * rowH + 30;
    ensure(total);
    roundedRect(M, y, CW, total - 6, 10, { fill: WHITE, border: LINE });
    label("Descontos e benefícios", M + 16, y + 14);
    let ry = y + 34;
    rows.forEach((row, i) => {
      const color = row.destaque ? BRAND : NAVY;
      const labelLines = wrap(row.label, row.destaque ? bold : regular, 11, CW - 32 - 110);
      text(labelLines[0], M + 16, ry, 11, row.destaque ? bold : regular, color);
      text(formatBRL(row.valor), W - M - 16, ry, 11, bold, color, "right");
      if (i < rows.length - 1) page.drawRectangle({ x: M + 16, y: H - (ry + 17), width: CW - 32, height: 0.6, color: LINE });
      ry += rowH;
    });
    page.drawRectangle({ x: M + 16, y: H - (ry - 2), width: CW - 32, height: 0.8, color: BRAND_SOFT_LINE });
    text("Total de descontos e benefícios", M + 16, ry + 5, 11, bold, NAVY);
    text(formatBRL(model.totalDescontosEBeneficios), W - M - 16, ry + 5, 12, bold, BRAND, "right");
    y += total + 6;
  }

  // ---- Financiamento -------------------------------------------------------
  {
    const metrics = [{ k: "Financiamento aprovado", v: model.financiamentoAprovado }];
    if (model.primeiraParcelaFinanciamento > 0) metrics.push({ k: "Primeira parcela", v: model.primeiraParcelaFinanciamento });
    if (model.ultimaParcelaFinanciamento > 0) metrics.push({ k: "Última parcela", v: model.ultimaParcelaFinanciamento });
    ensure(66);
    roundedRect(M, y, CW, 58, 10, { fill: MIST });
    const colW = CW / metrics.length;
    metrics.forEach((m, i) => {
      const cx = M + colW * i + 16;
      label(m.k, cx, y + 13);
      text(formatBRL(m.v), cx, y + 28, metrics.length > 2 ? 16 : 19, bold, NAVY);
    });
    y += 58 + 10;
  }

  // ---- Entrada (destaque do ato inicial) -----------------------------------
  {
    const outros = model.outrosBlocos;
    const parcelado = model.saldoParcelado > 0 || model.parcelamento;
    const h = 96 + (parcelado ? 62 : 0) + outros.length * 20 + (model.entradaTotalmenteParcelada ? 24 : 0);
    ensure(h);
    roundedRect(M, y, CW, h, 14, { fill: PANEL, border: BRAND_SOFT_LINE });
    let cy = y + 16;
    label("Sua entrada", M + 18, cy);
    cy += 16;
    const half = CW / 2;
    label("Entrada total", M + 18, cy);
    text(formatBRL(model.entradaTotal), M + 18, cy + 14, 22, bold, NAVY);
    label("Ato inicial", M + half, cy, BRAND);
    const atoColor = model.atoInicial > 0 ? NAVY : BRAND;
    text(formatBRL(model.atoInicial), M + half, cy + 12, model.atoInicial > 0 ? 24 : 34, bold, atoColor);
    cy += 52;
    if (model.entradaTotalmenteParcelada) {
      const msg = "Entrada 100% parcelada, sem pagamento inicial";
      const tw = bold.widthOfTextAtSize(msg, 9.5) + 22;
      roundedRect(M + 18, cy - 4, tw, 20, 10, { fill: WHITE, border: SUCCESS });
      text(msg, M + 29, cy + 2, 9.5, bold, SUCCESS);
      cy += 24;
    }
    if (parcelado) {
      roundedRect(M + 14, cy, CW - 28, 52, 10, { fill: WHITE, border: BRAND_SOFT_LINE });
      label("Valor parcelado", M + 28, cy + 10);
      const saldo = formatBRL(model.saldoParcelado);
      const sw = text(saldo, M + 28, cy + 25, 16, bold, NAVY);
      if (model.parcelamento) {
        text(`em ${model.parcelamento.parcelas}x de ${formatBRL(model.parcelamento.valorParcela)}`, M + 28 + sw + 10, cy + 28, 12, bold, BRAND);
      }
      cy += 60;
    }
    outros.forEach((block) => {
      text(block.label, M + 18, cy, 10.5, regular, NAVY);
      text(`${block.parcelas}x de ${formatBRL(block.valorParcela)}`, W - M - 18, cy, 10.5, bold, NAVY, "right");
      cy += 20;
    });
    y += h + 12;
  }

  // ---- Benefícios do empreendimento ----------------------------------------
  {
    const seen = new Set();
    const chips = [];
    const add = (labelText) => {
      const key = String(labelText).toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return;
      if (model.documentacaoGratuita.aplica && /document/i.test(key)) return; // já em "Descontos e benefícios"
      seen.add(key);
      chips.push(labelText);
    };
    model.beneficios.forEach((b) => add(b.valor > 0 ? `${b.label}: ${formatBRL(b.valor)}` : b.label));
    model.diferenciais.forEach(add);
    if (chips.length) {
      const size = 9.5;
      const padX = 10;
      const chipH = 22;
      const rowsOfChips = [];
      let row = [];
      let rowW = 0;
      chips.forEach((chipText) => {
        const lines = wrap(chipText, bold, size, CW - padX * 2);
        const label1 = lines[0]; // chip de uma linha (texto longo é truncado com reticências)
        let shown = label1;
        if (lines.length > 1) {
          while (shown.length > 3 && bold.widthOfTextAtSize(`${shown}...`, size) > CW - padX * 2) shown = shown.slice(0, -1);
          shown = `${shown.trim()}...`;
        }
        const w = bold.widthOfTextAtSize(shown, size) + padX * 2;
        if (row.length && rowW + 8 + w > CW) { rowsOfChips.push(row); row = []; rowW = 0; }
        row.push({ shown, w });
        rowW += (row.length > 1 ? 8 : 0) + w;
      });
      if (row.length) rowsOfChips.push(row);
      ensure(18 + chipH + 8);
      label("Benefícios do empreendimento", M, y);
      y += 18;
      rowsOfChips.forEach((r) => {
        ensure(chipH + 8); // quebra de página linha a linha
        const cy = y;
        let cx = M;
        r.forEach((chip) => {
          roundedRect(cx, cy, chip.w, chipH, 11, { fill: PANEL, border: BRAND_SOFT_LINE });
          text(chip.shown, cx + padX, cy + 6.5, size, bold, NAVY);
          cx += chip.w + 8;
        });
        y += chipH + 8;
      });
      y += 6;
    }
  }

  // ---- Rodapé (todas as páginas) ------------------------------------------
  const total = pages.length;
  pages.forEach((p, index) => {
    const idx = index;
    p.drawRectangle({ x: M, y: 52, width: CW, height: 0.8, color: LINE });
    const note = "Simulação estimada. Os valores finais dependem da análise de crédito do banco e da confirmação da incorporadora.";
    const noteLines = wrap(note, regular, 7.5, CW);
    noteLines.forEach((line, i) => {
      const top = H - 52 + 5 + i * 9;
      p.drawText(line, { x: M, y: H - top - 6.2, size: 7.5, font: regular, color: MUTED });
      boxes.push({ page: idx, x: M, y: top, w: regular.widthOfTextAtSize(line, 7.5), h: 7.5, kind: "text" });
      texts.push({ page: idx, text: line });
    });
    const footerText = "www.matheusmachadoimoveis.com.br  |  @mhm.machado";
    const fw = regular.widthOfTextAtSize(footerText, 8.5);
    p.drawText(footerText, { x: M, y: 14, size: 8.5, font: regular, color: MUTED });
    boxes.push({ page: idx, x: M, y: H - 14 - 8.5, w: fw, h: 8.5, kind: "text" });
    texts.push({ page: idx, text: footerText });
    const pn = `${index + 1}/${total}`;
    const pw = regular.widthOfTextAtSize(pn, 8.5);
    p.drawText(pn, { x: W - M - pw, y: 14, size: 8.5, font: regular, color: MUTED });
    boxes.push({ page: idx, x: W - M - pw, y: H - 14 - 8.5, w: pw, h: 8.5, kind: "text" });
  });

  const bytes = await pdf.save();
  return { bytes, boxes, texts, pageCount: total, page: { width: W, height: H, margin: M, top: TOP, bottom: BOTTOM } };
}
