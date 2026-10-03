import { PDFDocument, StandardFonts } from "pdf-lib";
import { createKit } from "./proposta-pdf-kit.mjs";
import { iconForFeature } from "./proposta-pdf-icons.mjs";
import { balance, colors, copy, layout as L, links, photo as photoTokens, typography as T, watermark } from "./proposta-pdf-tokens.mjs";

/**
 * PDF "Proposta de Valores" (A4) — versão para o cliente da apresentação de valores do
 * empreendimento. SOMENTE DESENHA: todos os números vêm de `buildPresentationModel`
 * (presentation-model.mjs); aqui só há formatação e layout. Nenhuma conta financeira.
 *
 * Arquitetura (dados → modelo → layout → renderização):
 *   - dados/cálculo ........ motor (calculator.ts) + `buildPresentationModel` (fonte única)
 *   - tokens de design ..... `proposta-pdf-tokens.mjs` (cores, gradiente, tipografia, espaços,
 *                            cartões, sombra, foto, marca d'água, links)
 *   - primitivas de desenho  `proposta-pdf-kit.mjs` (gradiente, sombra, foto com máscara, link)
 *   - ícones ............... `proposta-pdf-icons.mjs` (uma família outline em vetor)
 *   - composição ........... este arquivo (o que vai onde, quebra de linha e de página)
 *
 * Direção visual v4 (2026-10-02): reconstrução da referência aprovada pelo dono — fundo que
 * nasce azul-marinho no topo e clareia até o branco, logo centralizada, foto real do
 * empreendimento dissolvendo no fundo, quatro indicadores no mesmo cartão (Ato inicial primeiro),
 * blocos "Sua entrada" / "Suas parcelas" / "Descontos e benefícios" / "Vantagens", marca d'água
 * com o símbolo oficial e links clicáveis no rodapé. Tudo é texto e vetor nativos.
 */

const W = 595.28;
const H = 841.89;
const M = L.margin;
const CW = W - M * 2;
const BOTTOM = H - L.bottom;

export function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(value) || 0)
    .replace(/ /g, " "); // NBSP do Intl -> espaço comum (mesmo texto que o PDF desenha)
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

// Espaço "colado": "R$ 972,22" e "36x de" nunca quebram no meio de uma linha.
const GLUE = "\u0001";
const protect = (s) => String(s).replace(/R\$ /g, `R$${GLUE}`).replace(/(\d+x) de /g, `$1${GLUE}de${GLUE}`);
const unprotect = (s) => String(s).split(GLUE).join(" ");

// Largura real do texto desenhado: o pdf-lib mede COM kerning, mas o PDF desenha SEM,
// então a soma por caractere é a medida fiel. `spacing` = espaçamento entre letras.
const wid = (font, s, size, spacing = 0) => {
  let sum = 0;
  let n = 0;
  for (const ch of String(s)) {
    sum += font.widthOfTextAtSize(ch, size);
    n += 1;
  }
  return sum + spacing * n;
};

const isPng = (b) => b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b) => b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export async function gerarPropostaValoresPdf(args) {
  let out = await renderProposta(args, 0);
  if (out.pageCount === 1 && out.leftover > balance.minLeftover) {
    out = await renderProposta(args, Math.min(balance.maxSpread, (out.leftover - balance.keep) / balance.weight));
  }
  return out;
}

async function renderProposta({ model, clienteNome, dataTexto, empreendimento = {}, logoBytes = null, imagemBytes = null }, extra = 0) {
  const pdf = await PDFDocument.create();
  const empNome = empreendimento.nome || model.empreendimentoNome || "Empreendimento";
  pdf.setTitle(`Proposta de Valores - ${empreendimento.nome || model.empreendimentoNome || ""}`.trim());
  pdf.setLanguage("pt-BR");
  pdf.setAuthor("Matheus Machado Imóveis");
  pdf.setCreator("Matheus Machado Imóveis");
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifB = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const kit = createKit(pdf, H);

  let logo = null;
  if (logoBytes) {
    try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; }
  }
  let heroPhoto = null;
  if (imagemBytes && imagemBytes.length && imagemBytes.length <= photoTokens.maxBytes) {
    try {
      if (isJpg(imagemBytes)) heroPhoto = await pdf.embedJpg(imagemBytes);
      else if (isPng(imagemBytes)) heroPhoto = await pdf.embedPng(imagemBytes);
    } catch { heroPhoto = null; }
  }

  const boxes = []; // {page, x, y(top), w, h, kind}
  const texts = []; // {page, text, size}
  const pages = [];
  let page = null;
  let y = 0;

  const encodable = new Map();
  function safe(value, font) {
    let out = "";
    for (const ch of String(value ?? "").replace(/\s+/g, " ")) {
      const key = `${font.name}${ch}`;
      if (!encodable.has(key)) {
        let ok = true;
        try { font.encodeText(ch); } catch { ok = false; }
        encodable.set(key, ok);
      }
      out += encodable.get(key) ? ch : "?";
    }
    return out;
  }

  let curIdx = -1;
  const pageIndex = () => curIdx;
  const mark = (x, top, w, h, kind) => boxes.push({ page: pageIndex(), x, y: top, w, h, kind });

  function text(value, x, top, size, font, colorHex, align = "left", opts = {}) {
    const content = safe(value, font);
    const spacing = Math.min(opts.spacing || 0, size * 0.08);
    const width = wid(font, content, size, spacing);
    let drawX = x;
    if (align === "right") drawX = x - width;
    if (align === "center") drawX = x - width / 2;
    kit.spacedText(page, content, drawX, H - top - size * 0.82, { size, font, colorHex, spacing, opacity: opts.opacity ?? 1 });
    mark(drawX, top, width, size, "text");
    texts.push({ page: pageIndex(), text: content, size });
    return width;
  }

  // Quebra de linha SEM cortar: valores ("R$ 972,22", "36x de R$ 972,22") ficam inteiros.
  function wrap(value, font, size, maxWidth, spacing = 0) {
    const words = protect(safe(value, font)).split(" ").filter(Boolean).map(unprotect);
    const lines = [];
    let line = "";
    const push = () => { if (line) lines.push(line); line = ""; };
    for (const word of words) {
      let piece = word;
      while (wid(font, piece, size, spacing) > maxWidth) {
        let cut = piece.length - 1;
        while (cut > 1 && wid(font, piece.slice(0, cut), size, spacing) > maxWidth) cut -= 1;
        push();
        lines.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      const candidate = line ? `${line} ${piece}` : piece;
      if (wid(font, candidate, size, spacing) <= maxWidth) line = candidate;
      else { push(); line = piece; }
    }
    push();
    return lines.length ? lines : [""];
  }

  /** Maior tamanho (entre `size` e `min`) em que o texto cabe em uma linha. */
  function fitSize(font, value, maxWidth, size, min) {
    let s = size;
    const content = safe(value, font);
    while (s > min && wid(font, content, s) > maxWidth) s -= 0.25;
    return s;
  }

  function rule(x, top, w, colorHex = colors.line, thickness = 0.6) {
    page.drawRectangle({ x, y: H - top - thickness, width: w, height: thickness, color: kit.color(colorHex) });
  }

  function icon(name, x, top, size, colorHex = colors.icon, stroke = 1.2) {
    kit.icon(page, name, x, top, size, colorHex, stroke);
    mark(x, top, size, size, "icon");
  }

  function drawCard(x, top, w, h, radius = L.block.radius) {
    kit.card(page, x, top, w, h, radius, { fill: colors.card, border: colors.cardBorder, shadowColor: colors.shadow });
    mark(x, top, w, h, "card");
  }

  // ---- Dados de exibição (nenhuma conta: tudo já vem do modelo) ------------------
  const m = model;
  const cliente = clienteNome || "Cliente";
  const parcelado = m.saldoParcelado > 0 || Boolean(m.parcelamento);
  const parcelasTexto = m.parcelamento ? `${m.parcelamento.parcelas}x de ${formatBRL(m.parcelamento.valorParcela)}` : "";
  const first = m.primeiraParcelaFinanciamento;
  const last = m.ultimaParcelaFinanciamento;
  const zona = String(empreendimento.zona || "").trim();
  const beneficioRows = m.temDescontosOuBeneficios
    ? [
        ...m.descontos.map((d) => ({ icon: "tag", label: d.label, valor: d.valor })),
        ...(m.subsidioMcmv > 0 ? [{ icon: "homeCheck", label: "Subsídio Minha Casa Minha Vida", valor: m.subsidioMcmv }] : []),
        ...(m.casaPaulista > 0 ? [{ icon: "flag", label: "Casa Paulista", valor: m.casaPaulista }] : []),
        ...(m.documentacaoGratuita.aplica ? [{ icon: "doc", label: "Documentação gratuita", valor: m.documentacaoGratuita.valor }] : [])
      ]
    : [];
  const vantagens = (() => {
    const seen = new Set();
    const items = [];
    const add = (labelText) => {
      const key = String(labelText).toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return;
      if (m.documentacaoGratuita.aplica && /document/i.test(key)) return; // já em "Descontos e benefícios"
      seen.add(key);
      items.push(labelText);
    };
    m.beneficios.forEach((b) => add(b.valor > 0 ? `${b.label}: ${formatBRL(b.valor)}` : b.label));
    m.diferenciais.forEach(add);
    return items;
  })();

  // ======================================================================================
  // Cabeçalho, fundo e páginas
  // ======================================================================================
  function drawWatermark() {
    if (!logo) return;
    const w = watermark.width;
    const h = (logo.height / logo.width) * w;
    const x = W - w + watermark.bleedX * w;
    const top = H - h + watermark.bleedY * h;
    // silhueta do símbolo oficial em uma cor; se o PNG não for do formato esperado, usa o próprio PNG
    if (!logoBytes || !kit.tintedSymbol(page, logoBytes, { x, top, w, h }, watermark.color, watermark.opacity)) {
      page.drawImage(logo, { x, y: H - top - h, width: w, height: h, opacity: watermark.opacity });
    }
    mark(x, top, w, h, "watermark");
  }

  function drawHeader(compact) {
    const cx = W / 2;
    if (!compact) {
      let top = L.hero.logoTop;
      if (logo) {
        const lh = L.hero.logoHeight;
        const lw = (logo.width / logo.height) * lh;
        page.drawImage(logo, { x: cx - lw / 2, y: H - top - lh, width: lw, height: lh });
        mark(cx - lw / 2, top, lw, lh, "logo");
        top += lh + L.hero.wordmarkGap;
      }
      text("MATHEUS MACHADO", cx + T.headerBrand.spacing / 2, top, T.headerBrand.size, sansB, colors.onDark, "center", { spacing: T.headerBrand.spacing });
      text("CORRETOR DE IMÓVEIS", cx + T.headerRole.spacing / 2, top + T.headerBrand.size + 4, T.headerRole.size, sansB, colors.onDarkSoft, "center", { spacing: T.headerRole.spacing });
      text("PROPOSTA DE VALORES", W - M, 34, T.headerDoc.size, sansB, colors.onDark, "right", { spacing: T.headerDoc.spacing });
      if (dataTexto) text(`Emitida em ${dataTexto}`, W - M, 47, T.headerDate.size, sans, colors.onDarkSoft, "right");
    } else {
      const top = L.continuationLogoTop;
      const lh = L.continuationLogoHeight;
      const brand = "MATHEUS MACHADO";
      const brandW = wid(sansB, brand, 10, 0.8);
      let startX = cx - brandW / 2;
      if (logo) {
        const lw = (logo.width / logo.height) * lh;
        startX = cx - (lw + 8 + brandW) / 2;
        page.drawImage(logo, { x: startX, y: H - top - lh, width: lw, height: lh });
        mark(startX, top, lw, lh, "logo");
        startX += lw + 8;
      }
      text(brand, startX, top + (lh - 10) / 2, 10, sansB, colors.onDark, "left", { spacing: 0.8 });
      text("PROPOSTA DE VALORES", W - M, top + 2, T.headerDoc.size, sansB, colors.onDark, "right", { spacing: T.headerDoc.spacing });
      if (dataTexto) text(`Emitida em ${dataTexto}`, W - M, top + 15, T.headerDate.size, sans, colors.onDarkSoft, "right");
    }
  }

  function newPage(isFirst = false) {
    page = pdf.addPage([W, H]);
    pages.push(page);
    curIdx = pages.length - 1;
    if (isFirst) {
      kit.verticalGradient(page, colors.gradient, 0, H, { x: 0, top: 0, w: W, h: H });
      mark(0, 0, W, H, "bg");
    } else {
      kit.verticalGradient(page, colors.gradientContinuation, 0, L.continuationHeight, { x: 0, top: 0, w: W, h: L.continuationHeight });
      mark(0, 0, W, L.continuationHeight, "bg");
    }
    drawWatermark();
    return page;
  }

  function newContinuationPage() {
    newPage(false);
    drawHeader(true);
    y = L.continuationHeight - 14;
  }

  function ensure(h) {
    if (y + h > BOTTOM) newContinuationPage();
  }

  // ======================================================================================
  // PÁGINA 1 — hero
  // ======================================================================================
  newPage(true);
  const textColW = (heroPhoto ? L.hero.textColumn : L.hero.textColumnNoPhoto) * W - M;
  // medição do hero (o desenho só começa depois que a altura é conhecida)
  let nameSize = T.heroName.size;
  const cap = T.heroName.maxLines;
  while (nameSize > T.heroName.min && wrap(cliente, serif, nameSize, textColW).length > cap) nameSize -= 1;
  const nameLines = wrap(cliente, serif, nameSize, textColW);
  const projectLines = wrap(empNome, sansB, T.heroProject.size, textColW);
  const builderLines = empreendimento.construtora ? wrap(empreendimento.construtora, sans, T.heroBuilder.size, textColW) : [];
  const zoneText = zona ? `${zona} · ${copy.city}` : "";
  let hy = L.hero.textTop + 17;
  const nameTop = hy;
  hy += nameLines.length * nameSize * T.heroName.leading + 11;
  const projectTop = hy;
  hy += projectLines.length * T.heroProject.size * T.heroProject.leading + 2;
  const builderTop = hy;
  hy += builderLines.length * (T.heroBuilder.size + 3) + 6;
  const zoneTop = hy;
  if (zoneText) hy += T.heroZone.size + 4;
  const heroH = Math.max(L.hero.minHeight, hy + L.hero.paddingBottom) + extra * 1.5;

  if (heroPhoto) {
    const photoX = W * L.hero.photoLeft;
    kit.fadedPhoto(page, heroPhoto, { x: photoX, top: 0, w: W - photoX, h: heroH + 6 });
    mark(photoX, 0, W - photoX, heroH + 6, "photo");
  } else if (logo) {
    // sem foto: o símbolo oficial ocupa discretamente o lado direito do hero
    const sw = watermark.hero.width;
    const sh = (logo.height / logo.width) * sw;
    const sx = W - M - sw;
    const st = L.hero.textTop + (heroH - L.hero.textTop - sh) / 2 - 6;
    if (!logoBytes || !kit.tintedSymbol(page, logoBytes, { x: sx, top: st, w: sw, h: sh }, watermark.hero.color, watermark.hero.opacity)) {
      page.drawImage(logo, { x: sx, y: H - st - sh, width: sw, height: sh, opacity: watermark.hero.opacity });
    }
    mark(sx, st, sw, sh, "watermark");
  }
  drawHeader(false);
  text("PROPOSTA PERSONALIZADA PARA", M, L.hero.textTop, T.eyebrow.size, sansB, colors.onDarkEyebrow, "left", { spacing: T.eyebrow.spacing });
  nameLines.forEach((line, i) => text(line, M, nameTop + i * nameSize * T.heroName.leading, nameSize, serif, colors.onDark));
  projectLines.forEach((line, i) => text(line, M, projectTop + i * T.heroProject.size * T.heroProject.leading, T.heroProject.size, sansB, colors.onDark));
  builderLines.forEach((line, i) => text(line, M, builderTop + i * (T.heroBuilder.size + 3), T.heroBuilder.size, sans, colors.onDarkSoft));
  if (zoneText) {
    icon("pin", M, zoneTop - 0.5, 12, colors.onDarkEyebrow, 1.1);
    text(zoneText, M + 17, zoneTop, T.heroZone.size, sans, colors.onDark);
  }
  y = heroH + L.cards.top + extra * 0.6;

  // ======================================================================================
  // Linha de indicadores — mesma linguagem visual nos quatro cartões
  // ======================================================================================
  const incluiPartes = [
    ...(m.descontos.length ? ["descontos"] : []),
    ...(m.subsidioMcmv > 0 ? ["subsídio"] : []),
    ...(m.casaPaulista > 0 ? ["Casa Paulista"] : []),
    ...(m.documentacaoGratuita.aplica ? ["documentação gratuita"] : [])
  ];
  const incluiTexto = incluiPartes.length
    ? `Inclui ${incluiPartes.length > 1 ? `${incluiPartes.slice(0, -1).join(", ")} e ${incluiPartes[incluiPartes.length - 1]}` : incluiPartes[0]}.`
    : "";
  const indicadores = [
    {
      icon: "coins",
      label: "ATO INICIAL",
      value: formatBRL(m.atoInicial),
      first: true,
      notes: [m.entradaTotalmenteParcelada ? "Entrada 100% parcelada, sem pagamento inicial." : m.entradaTotal <= 0 ? "Sem valor de entrada." : m.atoInicial > 0 ? "Pagamento inicial da entrada." : ""]
    },
    { icon: "home", label: "VALOR DO IMÓVEL", value: formatBRL(m.valorImovel), notes: [] },
    {
      icon: "bank",
      label: "FINANCIAMENTO",
      value: formatBRL(m.financiamentoAprovado),
      notes: [first > 0 ? `1ª parcela: ${formatBRL(first)}` : "", last > 0 ? `Última parcela: ${formatBRL(last)}` : ""]
    },
    ...(beneficioRows.length ? [{ icon: "gift", label: "DESCONTOS E BENEFÍCIOS", value: formatBRL(m.totalDescontosEBeneficios), notes: [incluiTexto] }] : [])
  ];
  {
    const n = indicadores.length;
    const gap = L.cards.gap;
    const cw = (CW - gap * (n - 1)) / n;
    const pad = L.cards.padding;
    const innerW = cw - pad * 2;
    const labelX = pad + L.cards.iconSize + 6;
    const prepared = indicadores.map((c) => {
      const font = serifB;
      const base = c.first ? T.cardValueFirst : T.cardValue;
      const size = fitSize(font, c.value, innerW, base.size, base.min);
      const labelLines = wrap(c.label, sansB, T.cardLabel.size, innerW - (L.cards.iconSize + 6), T.cardLabel.spacing);
      const noteLines = c.notes.filter(Boolean).flatMap((note) => wrap(note, sans, T.cardNote.size, innerW));
      return { ...c, size, labelLines, noteLines };
    });
    const labelBlock = Math.max(...prepared.map((c) => c.labelLines.length)) * (T.cardLabel.size + 2.4);
    const contentH = pad + Math.max(L.cards.iconSize, labelBlock) + 8 + 19 + 4 + Math.max(...prepared.map((c) => c.noteLines.length)) * T.cardNote.leading + pad - 2;
    const ch = Math.max(L.cards.height, contentH);
    prepared.forEach((c, i) => {
      const x = M + i * (cw + gap);
      drawCard(x, y, cw, ch, L.cards.radius);
      icon(c.icon, x + pad, y + pad, L.cards.iconSize, colors.icon, 1.15);
      const lh = T.cardLabel.size + 2.4;
      const labelTop = y + pad + (L.cards.iconSize - c.labelLines.length * lh + 2.4) / 2;
      c.labelLines.forEach((line, li) => text(line, x + labelX, labelTop + li * lh, T.cardLabel.size, sansB, colors.brand, "left", { spacing: T.cardLabel.spacing }));
      const vTop = y + pad + Math.max(L.cards.iconSize, labelBlock) + 8;
      text(c.value, x + pad, vTop, c.size, serifB, colors.ink);
      c.noteLines.forEach((line, li) => text(line, x + pad, vTop + 19 + 4 + li * T.cardNote.leading, T.cardNote.size, sans, colors.muted));
    });
    y += ch + L.gap + 2 + extra;
  }

  // ======================================================================================
  // "Sua entrada" | "Suas parcelas" (blocos paralelos, mesma altura)
  // ======================================================================================
  const HEAD = 38;
  function blockHeader(x, top, title, w, continued = false) {
    text(title.toUpperCase(), x + L.block.padding, top + L.block.padding, T.blockTitle.size, sansB, colors.brand, "left", { spacing: T.blockTitle.spacing });
    if (continued) text("continuação", x + w - L.block.padding, top + L.block.padding, T.continued.size, sans, colors.muted, "right");
    rule(x + L.block.padding, top + L.block.padding + 14, L.block.ruleWidth, colors.brand, 1.3);
  }

  const entradaRows = [{ label: "Entrada total", valor: formatBRL(m.entradaTotal), strong: true }];
  if (parcelado) {
    entradaRows.push({ label: m.parcelamento ? "Valor parcelado" : "Saldo parcelado", valor: formatBRL(m.saldoParcelado) });
    if (m.parcelamento) entradaRows.push({ label: "Parcelamento", valor: parcelasTexto });
  }
  m.outrosBlocos.forEach((block) => entradaRows.push({ label: block.label, valor: `${block.parcelas}x de ${formatBRL(block.valorParcela)}` }));

  const parcelasItems = [];
  if (m.parcelamento) parcelasItems.push({ icon: "calendar", label: "Entrada parcelada", value: parcelasTexto, note: `Total parcelado: ${formatBRL(m.saldoParcelado)}` });
  else if (m.saldoParcelado > 0) parcelasItems.push({ icon: "calendar", label: "Saldo parcelado", value: formatBRL(m.saldoParcelado), note: "" });
  if (first > 0 && last > 0) parcelasItems.push({ icon: "bars", label: "Parcelas do financiamento", value: `${formatBRL(first)} a ${formatBRL(last)}`, note: "da 1ª à última parcela" });
  else if (first > 0) parcelasItems.push({ icon: "bars", label: "Parcelas do financiamento", value: formatBRL(first), note: "1ª parcela" });
  else if (last > 0) parcelasItems.push({ icon: "bars", label: "Parcelas do financiamento", value: formatBRL(last), note: "última parcela" });

  {
    const twoCols = parcelasItems.length > 0;
    const gap = L.gap;
    const bw = twoCols ? (CW - gap) / 2 : CW;
    const pad = L.block.padding;
    // --- Sua entrada: linhas de rótulo e valor
    const rowFont = (r) => (r.strong ? sansB : sans);
    const valueColW = Math.max(...entradaRows.map((r) => wid(sansB, safe(r.valor, sansB), T.rowValue.size))) + 10;
    const rowsLayout = entradaRows.map((r) => {
      const lines = wrap(r.label, rowFont(r), T.row.size, bw - pad * 2 - valueColW);
      return { ...r, lines, h: T.row.rowHeight + (lines.length - 1) * (T.row.size + 3) };
    });
    const leftH = HEAD + rowsLayout.reduce((s, r) => s + r.h, 0) + pad - 4;
    const rowsH = rowsLayout.reduce((s, r) => s + r.h, 0);
    // --- Suas parcelas
    const ICON_D = 28;
    const textX = pad + ICON_D + 10;
    const parcelasLayout = parcelasItems.map((it) => {
      const maxW = bw - pad - textX;
      const size = fitSize(serifB, it.value, maxW, T.bigValue.size, T.bigValue.min);
      const valueLines = wid(serifB, safe(it.value, serifB), size) <= maxW ? [safe(it.value, serifB)] : wrap(it.value, serifB, size, maxW);
      const noteLines = it.note ? wrap(it.note, sans, T.bigNote.size, maxW) : [];
      const h = 13 + valueLines.length * (size + 3) + noteLines.length * 11 + 14;
      return { ...it, size, valueLines, noteLines, h };
    });
    const rightH = twoCols ? HEAD - 4 + parcelasLayout.reduce((s, it) => s + it.h, 0) + pad - 6 : 0;
    const bh = Math.max(leftH, rightH);
    ensure(bh + 4);
    // desenho
    drawCard(M, y, bw, bh);
    blockHeader(M, y, "Sua entrada", bw);
    // as linhas ocupam a altura do bloco par (sem ficar um vazio embaixo)
    const stretch = Math.min(1.5, Math.max(1, (bh - HEAD - pad + 4) / rowsH));
    let ry = y + HEAD;
    rowsLayout.forEach((rawRow, i) => {
      const r = { ...rawRow, h: rawRow.h * stretch };
      r.lines.forEach((line, li) => text(line, M + pad, ry + (r.h - rawRow.h) / 2 + li * (T.row.size + 3), T.row.size, rowFont(r), colors.ink));
      text(r.valor, M + bw - pad, ry + (r.h - rawRow.h) / 2, T.rowValue.size, sansB, colors.ink, "right");
      if (i < rowsLayout.length - 1) rule(M + pad, ry + r.h - 5, bw - pad * 2);
      ry += r.h;
    });
    if (twoCols) {
      const rx = M + bw + gap;
      drawCard(rx, y, bw, bh);
      blockHeader(rx, y, "Suas parcelas", bw);
      let py = y + HEAD - 6;
      parcelasLayout.forEach((it, i) => {
        // ícone dentro de um círculo outline
        const cxp = rx + pad + ICON_D / 2;
        const cyp = py + ICON_D / 2 + 4;
        kit.roundedRect(page, rx + pad, py + 4, ICON_D, ICON_D, ICON_D / 2, { fill: colors.pill, border: colors.cardBorder, borderWidth: 0.6 });
        icon(it.icon, cxp - 8, cyp - 8, 16, colors.icon, 1.2);
        const tx = rx + textX;
        text(it.label, tx, py + 4, T.bigLabel.size, sans, colors.muted);
        it.valueLines.forEach((line, li) => text(line, tx, py + 17 + li * (it.size + 3), it.size, serifB, colors.ink));
        it.noteLines.forEach((line, li) => text(line, tx, py + 17 + it.valueLines.length * (it.size + 3) + 1 + li * 11, T.bigNote.size, sans, colors.muted));
        if (i < parcelasLayout.length - 1) rule(rx + pad, py + it.h - 3, bw - pad * 2);
        py += it.h;
      });
    }
    y += bh + L.gap + extra;
  }

  // ======================================================================================
  // "Descontos e benefícios" | "Vantagens do empreendimento" (com continuação, sem cortes)
  // ======================================================================================
  {
    const gap = L.gap;
    const pad = L.block.padding;
    const sizeV = T.list.size;
    const lead = 22; // coluna do ícone nas listas

    const benefitItems = (cardW) => {
      const valueW = Math.max(...beneficioRows.map((r) => wid(sansB, safe(formatBRL(r.valor), sansB), T.rowValue.size))) + 10;
      return beneficioRows.map((r) => {
        const lines = wrap(r.label, sans, T.row.size, cardW - pad * 2 - lead - valueW);
        const h = Math.max(T.row.rowHeight + 2, lines.length * (T.row.size + 3) + 11);
        return {
          h,
          draw: (x, top, last) => {
            icon(r.icon, x + pad, top + 1.5, 14, colors.icon, 1.1);
            lines.forEach((line, li) => text(line, x + pad + lead, top + 3 + li * (T.row.size + 3), T.row.size, sans, colors.ink));
            text(formatBRL(r.valor), x + cardW - pad, top + 3, T.rowValue.size, sansB, colors.ink, "right");
            if (!last) rule(x + pad, top + h - 3, cardW - pad * 2);
          }
        };
      });
    };
    const TOTAL_H = 38;
    const drawTotal = (x, top, cardW) => {
      kit.roundedRect(page, x + pad - 4, top + 3, cardW - pad * 2 + 8, 28, 7, { fill: colors.pill });
      mark(x + pad - 4, top + 3, cardW - pad * 2 + 8, 28, "pill");
      text("Total de descontos e benefícios", x + pad + 2, top + 11, T.total.size, sansB, colors.ink);
      text(formatBRL(m.totalDescontosEBeneficios), x + cardW - pad - 2, top + 11, T.total.size, sansB, colors.ink, "right");
    };
    const featureItems = (cardW, columns) => {
      const colW = (cardW - pad * 2 - (columns - 1) * 14) / columns;
      const mk = (label) => {
        const lines = wrap(label, sans, sizeV, colW - lead);
        return { label, lines, h: lines.length * T.list.leading + 10 };
      };
      const items = vantagens.map(mk);
      const rows = [];
      for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
      return rows.map((row) => ({
        h: Math.max(...row.map((it) => it.h)),
        draw: (x, top) => {
          row.forEach((it, ci) => {
            const ix = x + pad + ci * (colW + 14);
            icon(iconForFeature(it.label), ix, top + 0.5, 12.5, colors.icon, 1.1);
            it.lines.forEach((line, li) => text(line, ix + lead, top + li * T.list.leading + 1, sizeV, sans, colors.ink));
          });
        }
      }));
    };

    // quantos itens (a partir de `start`) cabem em `room` pt, deixando `tail` para o total
    const fitCount = (items, start, room, tail) => {
      let acc = 0;
      let end = start;
      while (end < items.length && acc + items[end].h <= room) { acc += items[end].h; end += 1; }
      if (end === items.length && tail && acc + tail > room) {
        while (end > start + 1 && acc + tail > room) { end -= 1; acc -= items[end].h; }
      }
      return end;
    };

    let bi = 0;
    let vi = 0;
    let bStarted = false;
    let vStarted = false;
    let freshPage = false;
    const bAll = beneficioRows.length;
    const vAll = vantagens.length;
    const stacked = bAll > 0 && vAll > L.stackAbove;
    let guard = 0;
    while ((bi < bAll || vi < vAll) && guard < 60) {
      guard += 1;
      const hasB = bi < bAll;
      const hasV = vi < vAll && !(stacked && hasB); // empilhado: primeiro os descontos, depois as vantagens
      const both = hasB && hasV;
      const bw = both ? (CW - gap) * L.benefitsShare : CW;
      const vw = both ? CW - gap - bw : CW;
      const bItems = hasB ? benefitItems(bw) : [];
      const vCols = !both && vAll - vi >= L.block.minTwoColumnList ? 2 : 1;
      const vItems = hasV ? featureItems(vw, vCols) : [];
      // `vi` conta vantagens; `vItems` é por linha. Reconstrói com offset por linhas já desenhadas.
      const room = BOTTOM - y - HEAD - pad + 4;
      // os descontos/benefícios ficam inteiros (com o total) quando cabem em uma página
      const bFull = bItems.slice(bi).reduce((s, it) => s + it.h, 0) + TOTAL_H;
      if (hasB && !bStarted && !freshPage && bFull > room && bFull <= BOTTOM - L.continuationHeight - HEAD - pad) { newContinuationPage(); freshPage = true; continue; }
      const bEnd = hasB ? fitCount(bItems, bi, room, TOTAL_H) : bi;
      const vStartRow = Math.floor(vi / vCols);
      const vEndRow = hasV ? fitCount(vItems, vStartRow, room, 0) : vStartRow;
      const drewB = bEnd - bi;
      const drewV = vEndRow - vStartRow;
      const minNeeded = (hasB ? Math.min(2, bAll - bi) : 0) + (hasV ? Math.min(2, Math.ceil((vAll - vi) / vCols)) : 0);
      if ((hasB && drewB < Math.min(2, bAll - bi)) || (hasV && drewV < Math.min(2, vItems.length - vStartRow))) {
        if (!freshPage) { newContinuationPage(); freshPage = true; continue; }
      }
      if (minNeeded === 0) break;
      const bUsed = bItems.slice(bi, Math.max(bEnd, bi + 1)).reduce((s, it) => s + it.h, 0) + (bEnd >= bAll && hasB ? TOTAL_H : 0);
      const vUsed = vItems.slice(vStartRow, Math.max(vEndRow, vStartRow + 1)).reduce((s, it) => s + it.h, 0);
      const chB = HEAD + bUsed + pad - 4;
      const chV = HEAD + vUsed + pad - 4;
      const shared = both && !bStarted && !vStarted && Math.min(chB, chV) / Math.max(chB, chV) >= L.equalHeightRatio;
      const heightB = shared ? Math.max(chB, chV) : chB;
      const heightV = shared ? Math.max(chB, chV) : chV;
      const ch = Math.max(hasB ? heightB : 0, hasV ? heightV : 0);
      let x = M;
      if (hasB) {
        drawCard(x, y, bw, heightB);
        blockHeader(x, y, "Descontos e benefícios", bw, bStarted);
        let by = y + HEAD;
        const stop = Math.max(bEnd, bi + 1);
        for (let i = bi; i < stop; i += 1) {
          bItems[i].draw(x, by, i === stop - 1 && stop >= bAll);
          by += bItems[i].h;
        }
        if (stop >= bAll) drawTotal(x, by, bw);
        x += bw + gap;
      }
      if (hasV) {
        drawCard(x, y, vw, heightV);
        blockHeader(x, y, "Vantagens do empreendimento", vw, vStarted);
        let vy = y + HEAD;
        const stopRow = Math.max(vEndRow, vStartRow + 1);
        for (let i = vStartRow; i < stopRow; i += 1) {
          vItems[i].draw(x, vy);
          vy += vItems[i].h;
        }
        vi = Math.min(vAll, stopRow * vCols);
      }
      if (hasB) bi = Math.max(bEnd, bi + 1);
      y += ch + gap;
      if (hasB) bStarted = true;
      if (hasV) vStarted = true;
      freshPage = false;
      if ((hasB && bi < bAll) || (hasV && vi < vAll)) { newContinuationPage(); freshPage = true; }
    }
  }

  // ======================================================================================
  // Rodapé (todas as páginas): aviso, links clicáveis e paginação
  // ======================================================================================
  const total = pages.length;
  pages.forEach((p, index) => {
    page = p;
    curIdx = index; // os boxes do rodapé vão para a página certa
    rule(M, L.footerTop, CW, colors.line, 0.6);
    const noteLines = wrap(copy.disclaimer, sans, T.footerNote.size, CW);
    noteLines.forEach((line, i) => text(line, M, L.footerTop + 8 + i * 9, T.footerNote.size, sans, colors.muted));
    const rowTop = L.footerTop + 8 + noteLines.length * 9 + 8;
    let fx = M;
    const item = (iconName, entry) => {
      icon(iconName, fx, rowTop - 1.5, 11, colors.brand, 1.05);
      const tw = text(entry.text, fx + 16, rowTop, T.footerLink.size, sans, colors.brand);
      kit.link(page, fx, rowTop - 5, 16 + tw, T.footerLink.size + 10, entry.url);
      mark(fx, rowTop - 3, 16 + tw, T.footerLink.size + 6, "link");
      fx += 16 + tw + 18;
    };
    item("globe", links.site);
    item("instagram", links.instagram);
    text(`${index + 1}/${total}`, W - M, rowTop, T.pageNumber.size, sans, colors.muted, "right");
  });
  // sem object streams: os dicionários ficam legíveis (auditoria/testes) e leitores simples abrem sem surpresa
  const leftover = BOTTOM - y;
  const bytes = await pdf.save({ useObjectStreams: false });
  return {
    bytes,
    boxes,
    texts,
    pageCount: pdf.getPageCount(),
    leftover,
    page: { width: W, height: H, margin: M, top: 0, bottom: BOTTOM }
  };
}
