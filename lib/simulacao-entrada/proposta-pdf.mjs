import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * PDF "Proposta de Valores" (A4) — versão para o cliente da apresentação de valores do
 * empreendimento. SOMENTE DESENHA: todos os números vêm de `buildPresentationModel`
 * (presentation-model.mjs); aqui só há formatação e layout. Nenhuma conta financeira.
 *
 * Direção visual (2026-10-02, Diretor de Design): a página 1 conta a proposta em 10 segundos —
 * o que o comprador precisa para começar (ATO INICIAL), quanto paga de parcela e quanto há em
 * descontos e benefícios — e a página 2 reúne cada valor por assunto e as vantagens do
 * empreendimento. Sem cartões: hierarquia por escala, espaço e réguas. Paleta e logo da marca
 * (azul-marinho profundo e azul do símbolo, medidos na logo oficial).
 */

const W = 595.28;
const H = 841.89;
const M = 42;
const CW = W - M * 2;
const BAND_H = 58; // faixa fina das demais páginas
const TOP = BAND_H + 26;
const BOTTOM = H - 62;

// Paleta âncora (valores medidos nos arquivos oficiais da logo).
const DEEP = rgb(0.012, 0.114, 0.227); // #031D3A — "palco" da logo
const BLUE = rgb(0.212, 0.451, 0.761); // #3673C2 — azul do símbolo (4,8:1 sobre branco)
const BLUE_LIGHT = rgb(0.553, 0.702, 0.91); // #8DB3E8 — destaque sobre o marinho
const ON_DEEP = rgb(0.78, 0.851, 0.933); // #C7D9EE — texto secundário sobre o marinho
const DEEP_LINE = rgb(0.157, 0.271, 0.404); // #284567 — régua sobre o marinho
const INK = rgb(0.043, 0.122, 0.208); // #0B1F35 — texto principal
const MUTED = rgb(0.337, 0.4, 0.475); // #566679 — texto de apoio (≥ 5:1 sobre branco)
const LINE = rgb(0.847, 0.878, 0.918); // #D8E0EA — réguas finas
const TINT = rgb(0.918, 0.945, 0.98); // #EAF1FA — faixa de próximo passo
const WHITE = rgb(1, 1, 1);

const LABEL_SIZE = 9; // rótulos em caixa alta
const CAPTION_SIZE = 10; // legendas de apoio

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

/**
 * Composição em até duas passadas: se a página 1 sobra muito espaço (proposta sem benefícios nem
 * vantagens), a segunda passada distribui parte dessa folga como ar no palco marinho — assim a
 * capa nunca fica com um "buraco" embaixo. Só espaçamento; nenhum dado muda.
 */
export async function gerarPropostaValoresPdf(args) {
  const first = await renderProposta(args, 0);
  const result = first.slack > 110 ? await renderProposta(args, Math.min(first.slack - 56, 130)) : first;
  const { slack, ...out } = result;
  return out;
}

async function renderProposta({ model, clienteNome, dataTexto, empreendimento = {}, logoBytes = null }, heroExtra = 0) {
  let page1Slack = 0;
  const pdf = await PDFDocument.create();
  const empNome = empreendimento.nome || model.empreendimentoNome || "Empreendimento";
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
  const texts = []; // {page, text, size}
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

  function text(value, x, top, size, font, color, align = "left") {
    const content = safe(value, font);
    const width = font.widthOfTextAtSize(content, size);
    let drawX = x;
    if (align === "right") drawX = x - width;
    if (align === "center") drawX = x - width / 2;
    page.drawText(content, { x: drawX, y: H - top - size * 0.82, size, font, color });
    boxes.push({ page: pages.length - 1, x: drawX, y: top, w: width, h: size, kind: "text" });
    texts.push({ page: pages.length - 1, text: content, size });
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

  // Quebra em até `max` linhas; se ainda sobrar texto, a última termina em reticências.
  function wrapMax(value, font, size, maxWidth, max) {
    const lines = wrap(value, font, size, maxWidth);
    if (lines.length <= max) return lines;
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1].replace(/\s*\S*$/, "")}…`;
    return kept;
  }

  function paragraph(value, x, top, size, font, color, maxWidth, lineHeight = size * 1.28, align = "left") {
    const lines = wrap(value, font, size, maxWidth);
    lines.forEach((line, i) => text(line, align === "center" ? x + maxWidth / 2 : x, top + i * lineHeight, size, font, color, align));
    return lines.length * lineHeight;
  }

  // Maior tamanho (≤ max) em que o texto cabe numa linha.
  function fitSize(value, font, max, maxWidth, min = 10) {
    let size = max;
    while (size > min && font.widthOfTextAtSize(safe(value, font), size) > maxWidth) size -= 1;
    return size;
  }

  function rect(x, top, w, h, color, kind = "rect") {
    page.drawRectangle({ x, y: H - top - h, width: w, height: h, color });
    boxes.push({ page: pages.length - 1, x, y: top, w, h, kind });
  }

  function rule(x, top, w, color = LINE, thickness = 0.7) {
    page.drawRectangle({ x, y: H - top - thickness, width: w, height: thickness, color });
  }

  function vrule(x, top, h, color = LINE, thickness = 0.7) {
    page.drawRectangle({ x, y: H - top - h, width: thickness, height: h, color });
  }

  // Marca de "ok" em traço vetorial (sem fonte de ícones).
  function check(x, top, size, color) {
    const p1 = { x, y: H - top - size * 0.55 };
    const p2 = { x: x + size * 0.36, y: H - top - size * 0.9 };
    const p3 = { x: x + size, y: H - top - size * 0.1 };
    page.drawLine({ start: p1, end: p2, thickness: size * 0.2, color });
    page.drawLine({ start: p2, end: p3, thickness: size * 0.2, color });
  }

  function label(value, x, top, color = BLUE, align = "left") {
    return text(String(value).toUpperCase(), x, top, LABEL_SIZE, bold, color, align);
  }

  function ellipsize(value, font, size, maxWidth) {
    let s = safe(value, font);
    if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
    return `${s.trimEnd()}…`;
  }

  // Marca nas faixas (cabeçalho): símbolo oficial (proporção original) + nome.
  function brandRow(top, logoH) {
    let textX = M;
    if (logo) {
      const w = (logo.width / logo.height) * logoH;
      page.drawImage(logo, { x: M, y: H - top - logoH, width: w, height: logoH });
      boxes.push({ page: pages.length - 1, x: M, y: top, w, h: logoH, kind: "logo" });
      textX = M + w + 12;
    }
    const mid = top + logoH / 2;
    text("MATHEUS MACHADO", textX, mid - 12, 13, bold, WHITE);
    text("CORRETOR DE IMÓVEIS", textX, mid + 4, 8, bold, ON_DEEP);
    text("PROPOSTA DE VALORES", W - M, mid - 12, 9, bold, WHITE, "right");
    text(dataTexto ? `Emitida em ${dataTexto}` : "", W - M, mid + 3, 9, regular, ON_DEEP, "right");
  }

  function newPage() {
    page = pdf.addPage([W, H]);
    pages.push(page);
    rect(0, 0, W, BAND_H, DEEP, "band");
    rect(0, BAND_H, W, 2, BLUE, "band");
    brandRow((BAND_H - 30) / 2, 30);
    y = TOP;
  }

  function ensure(h) {
    if (y + h > BOTTOM) newPage();
  }

  // ---- Dados de exibição (nenhuma conta: tudo já vem do modelo) ------------------
  const clienteTexto = clienteNome || "Cliente";
  const parcelado = model.saldoParcelado > 0 || Boolean(model.parcelamento);
  const parcelasTexto = model.parcelamento ? `${model.parcelamento.parcelas}x de ${formatBRL(model.parcelamento.valorParcela)}` : "";
  // Descontos que abatem o preço/entrada vêm primeiro; a documentação gratuita (benefício
  // adicional, valor próprio do modelo) vem separada, sem misturar com os abatimentos.
  const abatimentos = model.temDescontosOuBeneficios
    ? [
        ...model.descontos.map((d) => ({ label: d.label, valor: d.valor })),
        ...(model.subsidioMcmv > 0 ? [{ label: "Subsídio Minha Casa Minha Vida", valor: model.subsidioMcmv }] : []),
        ...(model.casaPaulista > 0 ? [{ label: "Casa Paulista", valor: model.casaPaulista }] : [])
      ]
    : [];
  const beneficioRows = [
    ...abatimentos,
    ...(model.temDescontosOuBeneficios && model.documentacaoGratuita.aplica
      ? [{ label: "Documentação gratuita", valor: model.documentacaoGratuita.valor, adicional: true }]
      : [])
  ];

  const vantagens = (() => {
    const seen = new Set();
    const items = [];
    const add = (labelText) => {
      const key = String(labelText).toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return;
      if (model.documentacaoGratuita.aplica && /document/i.test(key)) return; // já em "Descontos e benefícios"
      seen.add(key);
      items.push(labelText);
    };
    model.beneficios.forEach((b) => add(b.valor > 0 ? `${b.label}: ${formatBRL(b.valor)}` : b.label));
    model.diferenciais.forEach(add);
    return items;
  })();

  // ======================================================================================
  // PÁGINA 1 — a proposta em 10 segundos
  // ======================================================================================
  // Medidas do bloco de identificação (decide a altura do palco marinho).
  let nameSize = 28;
  while (nameSize > 16 && wrap(clienteTexto, bold, nameSize, CW).length > 2) nameSize -= 2;
  const nameLines = wrap(clienteTexto, bold, nameSize, CW);
  const nameH = nameLines.length * nameSize * 1.18;
  const builder = empreendimento.construtora || "";
  const empLines = wrap(empNome, bold, 14, CW);
  const empH = empLines.length * 18;
  const locLines = empreendimento.localizacao ? wrap(empreendimento.localizacao, regular, 10, CW) : [];
  const locH = locLines.length * 13;
  const atoText = formatBRL(model.atoInicial);
  const atoSize = fitSize(atoText, bold, 86, CW - 6, 40);
  const statusLine = model.entradaTotalmenteParcelada ? "Entrada 100% parcelada, sem pagamento inicial" : "";
  const trio = [
    { k: "Valor do imóvel", v: formatBRL(model.valorImovel) },
    { k: "Financiamento aprovado", v: formatBRL(model.financiamentoAprovado) },
    { k: "Entrada total", v: formatBRL(model.entradaTotal) }
  ];

  const heroTop = 90 + heroExtra * 0.3;
  const heroHeight =
    heroTop + 14 + nameH + 12 + (builder ? 13 : 0) + empH + locH + 16 + heroExtra * 0.45 +
    14 + 15 + atoSize + 12 + (statusLine ? 24 : 0) + 10 + heroExtra * 0.25 + 15 + 15 + 20 + 12;

  page = pdf.addPage([W, H]);
  pages.push(page);
  rect(0, 0, W, heroHeight, DEEP, "band");
  rect(0, heroHeight, W, 3, BLUE, "band");
  brandRow(26, 36);

  let hy = heroTop;
  label("Proposta personalizada para", M, hy, BLUE_LIGHT);
  hy += 14;
  nameLines.forEach((line, i) => text(line, M, hy + i * nameSize * 1.18, nameSize, bold, WHITE));
  hy += nameH + 12;
  if (builder) { label(builder, M, hy, BLUE_LIGHT); hy += 13; }
  empLines.forEach((line, i) => text(line, M, hy + i * 18, 14, bold, WHITE));
  hy += empH;
  locLines.forEach((line, i) => text(line, M, hy + 2 + i * 13, 10, regular, ON_DEEP));
  hy += locH + 16 + heroExtra * 0.45;

  rect(M, hy, 36, 2, BLUE_LIGHT, "rect");
  hy += 14;
  const atoLabelW = label("Ato inicial", M, hy, BLUE_LIGHT);
  text("· pagamento para começar", M + atoLabelW + 8, hy, LABEL_SIZE, regular, ON_DEEP);
  hy += 15;
  text(atoText, M, hy, atoSize, bold, WHITE);
  hy += atoSize + 12;
  if (statusLine) {
    check(M, hy + 2, 11, BLUE_LIGHT);
    text(statusLine, M + 19, hy, 14.5, bold, WHITE);
    hy += 24;
  }
  hy += 10 + heroExtra * 0.25;
  rule(M, hy, CW, DEEP_LINE);
  hy += 15;
  const trioW = CW / 3;
  trio.forEach((cell, i) => {
    const x = M + i * trioW;
    label(cell.k, x, hy, BLUE_LIGHT);
    text(cell.v, x, hy + 15, fitSize(cell.v, bold, 16, trioW - 14, 11), bold, WHITE);
  });

  y = heroHeight + 3 + 24;

  // ---- Suas parcelas -------------------------------------------------------------
  {
    const cols = [];
    if (model.parcelamento) {
      cols.push({ k: "Entrada parcelada", v: parcelasTexto, cap: `Total parcelado: ${formatBRL(model.saldoParcelado)}`, max: 28 });
    } else if (model.saldoParcelado > 0) {
      cols.push({ k: "Saldo parcelado", v: formatBRL(model.saldoParcelado), cap: "", max: 28 });
    }
    if (model.primeiraParcelaFinanciamento > 0) {
      const first = formatBRL(model.primeiraParcelaFinanciamento);
      cols.push(model.ultimaParcelaFinanciamento > 0
        ? { k: "Parcelas do financiamento", v: `${first} a ${formatBRL(model.ultimaParcelaFinanciamento)}`, cap: "da 1ª à última parcela", max: 19 }
        : { k: "Parcela do financiamento", v: first, cap: "1ª parcela", max: 19 });
    } else if (model.ultimaParcelaFinanciamento > 0) {
      cols.push({ k: "Parcela do financiamento", v: formatBRL(model.ultimaParcelaFinanciamento), cap: "última parcela", max: 19 });
    }
    if (cols.length) {
      ensure(98);
      label("Suas parcelas", M, y, BLUE);
      y += 20;
      const top = y;
      const widths = cols.length === 2 ? [CW * 0.54 - 18, CW * 0.46 - 18] : [CW];
      const xs = cols.length === 2 ? [M, M + CW * 0.54 + 18] : [M];
      cols.forEach((col, i) => {
        label(col.k, xs[i], top, MUTED);
        text(col.v, xs[i], top + 15, fitSize(col.v, bold, col.max, widths[i], 13), bold, INK);
        if (col.cap) text(col.cap, xs[i], top + 15 + col.max + 6, CAPTION_SIZE, regular, MUTED);
      });
      if (cols.length === 2) vrule(M + CW * 0.54, top, 58);
      y = top + 58 + 12;
    }
  }

  // ---- Descontos e benefícios ------------------------------------------------------
  if (beneficioRows.length) {
    const leftW = 215;
    const listX = M + leftW + 24;
    const listW = CW - leftW - 24 - 15;
    // Até 2 linhas por item e no máximo 5 linhas ao todo; o que não couber vai para a página 2.
    const prepared = [];
    let used = 0;
    for (const row of beneficioRows) {
      const lines = wrapMax(row.adicional ? `${row.label} (adicional)` : row.label, regular, 10.5, listW, 2);
      if (prepared.length && used + lines.length > 5) break;
      prepared.push(lines);
      used += lines.length;
    }
    const extra = beneficioRows.length - prepared.length;
    const listH = used * 13 + (prepared.length - 1) * 4 + (extra > 0 ? 17 : 0);
    const blockH = Math.max(listH, 52) + 16;
    ensure(blockH + 18);
    rule(M, y, CW);
    y += 12;
    const top = y;
    label("Descontos e benefícios", M, top, BLUE);
    const total = formatBRL(model.totalDescontosEBeneficios);
    text(total, M, top + 15, fitSize(total, bold, 20, leftW, 14), bold, INK);
    text(model.documentacaoGratuita.aplica ? "inclui benefício adicional · página 2" : "detalhados na página 2", M, top + 15 + 20 + 6, CAPTION_SIZE, regular, MUTED);
    vrule(M + leftW + 6, top, Math.max(listH, 52));
    let ry = top;
    prepared.forEach((lines) => {
      check(listX, ry + 1.5, 8.5, BLUE);
      lines.forEach((line, li) => text(line, listX + 15, ry + li * 13, 10.5, regular, INK));
      ry += lines.length * 13 + 4;
    });
    if (extra > 0) text(`e mais ${extra} ${extra === 1 ? "item" : "itens"} na página 2`, listX + 15, ry, CAPTION_SIZE, regular, MUTED);
    y = top + Math.max(listH, 52) + 12;
  }

  // ---- Vantagens do empreendimento (prévia: só itens que cabem inteiros numa linha) ----
  let vantagensNaCapa = 0;
  if (vantagens.length) {
    const ctaReserve = 38 + 14 + 4;
    const gap = 22;
    const colW = (CW - gap) / 2;
    const fits = [];
    for (const item of vantagens.slice(0, 4)) {
      if (regular.widthOfTextAtSize(safe(item, regular), 10.5) > colW - 15) break;
      fits.push(item);
    }
    const rowsV = Math.ceil(fits.length / 2);
    const moreNote = vantagens.length > fits.length;
    const blockH = 16 + 18 + rowsV * 18 + 8;
    if (fits.length && pages.length === 1 && y + blockH + ctaReserve <= BOTTOM) {
      rule(M, y, CW);
      y += 16;
      label("Vantagens do empreendimento", M, y, BLUE);
      if (moreNote) text(`+${vantagens.length - fits.length} na página 2`, W - M, y, CAPTION_SIZE, regular, MUTED, "right");
      y += 18;
      fits.forEach((item, i) => {
        const x = M + (i % 2) * (colW + gap);
        const ty = y + Math.floor(i / 2) * 18;
        check(x, ty + 2, 8.5, BLUE);
        text(safe(item, regular), x + 15, ty, 10.5, regular, INK);
      });
      y += rowsV * 18 + 8;
      vantagensNaCapa = fits.length;
    }
  }

  // ---- Próximo passo (ancorado no fim da página 1 quando há espaço) -------------------
  {
    const ctaLines = wrap("Fale com o seu corretor para confirmar a análise de crédito e os valores finais.", bold, 11, CW - 40);
    const ctaH = 38 + ctaLines.length * 14;
    const anchor = BOTTOM - ctaH - 4;
    // Ancora no pé da página quando o vazio é pequeno; com muito vazio, segue o conteúdo e a
    // 2ª passada devolve a folga ao palco marinho (sem "buraco" embaixo).
    if (y < anchor && pages.length === 1) {
      page1Slack = anchor - y;
      y = page1Slack <= 120 ? anchor : y + 8;
    }
    ensure(ctaH + 4);
    rect(M, y, CW, ctaH, TINT, "rect");
    rect(M, y, 3, ctaH, BLUE, "rect");
    label("Próximo passo", M + 20, y + 14, BLUE);
    ctaLines.forEach((line, i) => text(line, M + 20, y + 29 + i * 14, 11, bold, INK));
    y += ctaH + 4;
  }

  // ======================================================================================
  // PÁGINA 2 — os valores, por assunto
  // ======================================================================================
  newPage();
  text("Os detalhes da sua proposta", M, y, 22, bold, INK);
  y += 30;
  text("Os valores desta proposta, organizados por assunto.", M, y, 10.5, regular, MUTED);
  y += 30;

  const LABEL_W = 146;
  const rowsX = M + LABEL_W;
  const rowsW = CW - LABEL_W;
  function section(title, rows, { totalRow = null } = {}) {
    const rowH = 21;
    const labelW = rowsW - 130;
    // Rótulo completo (até 2 linhas): num documento ao cliente, descrição de desconto não pode ser cortada.
    const prepared = rows.map((row) => {
      const lines = wrapMax(row.label, row.strong ? bold : regular, 10.5, labelW, 2);
      return { ...row, lines, h: rowH + (lines.length - 1) * 13 };
    });
    const h = prepared.reduce((sum, row) => sum + row.h, 0) + (totalRow ? rowH + 4 : 0) + 18;
    ensure(h);
    rule(M, y, CW, INK, 0.9);
    label(title, M, y + 9, BLUE);
    let ry = y + 8;
    prepared.forEach((row, i) => {
      row.lines.forEach((line, li) => text(line, rowsX, ry + li * 13, 10.5, row.strong ? bold : regular, row.accent ? BLUE : INK));
      text(row.valor, W - M, ry, 10.5, bold, row.accent ? BLUE : INK, "right");
      if (row.note) text(row.note, rowsX, ry + 13 * row.lines.length, 9, regular, MUTED);
      if (i < prepared.length - 1 || totalRow) rule(rowsX, ry + 16 + (row.lines.length - 1) * 13, rowsW);
      ry += row.h;
    });
    if (totalRow) {
      text(totalRow.label, rowsX, ry + 4, 11, bold, INK);
      text(totalRow.valor, W - M, ry + 3, 12, bold, INK, "right");
      ry += rowH + 4;
    }
    y = ry + 10;
  }

  section("Imóvel", [{ label: "Valor total do imóvel", valor: formatBRL(model.valorImovel), strong: true }]);
  if (beneficioRows.length) {
    section(
      "Descontos e benefícios",
      beneficioRows.map((r) => ({ label: r.adicional ? `${r.label} (benefício adicional)` : r.label, valor: formatBRL(r.valor) })),
      { totalRow: { label: "Total de descontos e benefícios", valor: formatBRL(model.totalDescontosEBeneficios) } }
    );
  }
  {
    const rows = [{ label: "Financiamento aprovado", valor: formatBRL(model.financiamentoAprovado), strong: true }];
    if (model.primeiraParcelaFinanciamento > 0) rows.push({ label: "Primeira parcela", valor: formatBRL(model.primeiraParcelaFinanciamento) });
    if (model.ultimaParcelaFinanciamento > 0) rows.push({ label: "Última parcela", valor: formatBRL(model.ultimaParcelaFinanciamento) });
    section("Financiamento", rows);
  }
  {
    const rows = [
      { label: "Entrada total", valor: formatBRL(model.entradaTotal), strong: true },
      { label: "Ato inicial", valor: formatBRL(model.atoInicial), strong: true, accent: true }
    ];
    if (parcelado) {
      rows.push({ label: model.parcelamento ? "Valor parcelado" : "Saldo parcelado", valor: formatBRL(model.saldoParcelado) });
      if (model.parcelamento) rows.push({ label: "Parcelamento", valor: parcelasTexto });
    }
    model.outrosBlocos.forEach((block) => rows.push({ label: block.label, valor: `${block.parcelas}x de ${formatBRL(block.valorParcela)}` }));
    section("Sua entrada", rows);
  }

  // ---- Vantagens do empreendimento (o que não coube na capa; tudo aparece em alguma página) ------
  {
    const items = vantagens.slice(vantagensNaCapa);
    if (items.length) {
      const gap = 24;
      const colW = (CW - gap) / 2;
      const size = 11.5;
      const lineH = 15;
      const heading = vantagensNaCapa > 0 ? "Mais vantagens do empreendimento" : "Vantagens do empreendimento";
      const prepared = items.map((item) => wrapMax(item, regular, size, colW - 20, 3));
      ensure(40 + 34);
      rule(M, y, CW, INK, 0.9);
      y += 16;
      text(heading, M, y, 16, bold, INK);
      y += 32;
      let col = 0;
      let rowTop = y;
      let rowHeight = 0;
      prepared.forEach((lines, i) => {
        if (col === 0) {
          // altura da linha de itens = maior das duas colunas
          const own = lines.length * lineH + 11;
          const next = prepared[i + 1] ? prepared[i + 1].length * lineH + 11 : 0;
          rowHeight = Math.max(own, next);
          if (rowTop + rowHeight > BOTTOM) {
            newPage();
            text(`${heading} (continuação)`, M, y, 13, bold, INK);
            y += 28;
            rowTop = y;
          }
        }
        const x = M + col * (colW + gap);
        check(x, rowTop + 2.5, 9.5, BLUE);
        lines.forEach((line, li) => text(line, x + 18, rowTop + li * lineH, size, regular, INK));
        if (col === 1 || i === prepared.length - 1) {
          rowTop += rowHeight;
          y = rowTop;
          col = 0;
        } else {
          col = 1;
        }
      });
      y += 8;
    }
  }

  // ---- Rodapé (todas as páginas) ------------------------------------------------------
  const total = pages.length;
  pages.forEach((p, index) => {
    const idx = index;
    p.drawRectangle({ x: M, y: 52, width: CW, height: 0.8, color: LINE });
    const note = "Simulação estimada. Os valores finais dependem da análise de crédito do banco e da confirmação da incorporadora.";
    const noteLines = wrap(note, regular, 8, CW);
    noteLines.forEach((line, i) => {
      const top = H - 52 + 5 + i * 10;
      p.drawText(line, { x: M, y: H - top - 6.6, size: 8, font: regular, color: MUTED });
      boxes.push({ page: idx, x: M, y: top, w: regular.widthOfTextAtSize(line, 8), h: 8, kind: "text" });
      texts.push({ page: idx, text: line, size: 8 });
    });
    const footerText = "www.matheusmachadoimoveis.com.br  |  @mhm.machado";
    const fw = regular.widthOfTextAtSize(footerText, 9);
    p.drawText(footerText, { x: M, y: 14, size: 9, font: regular, color: MUTED });
    boxes.push({ page: idx, x: M, y: H - 14 - 9, w: fw, h: 9, kind: "text" });
    texts.push({ page: idx, text: footerText, size: 9 });
    const pn = `${index + 1}/${total}`;
    const pw = regular.widthOfTextAtSize(pn, 9);
    p.drawText(pn, { x: W - M - pw, y: 14, size: 9, font: regular, color: MUTED });
    boxes.push({ page: idx, x: W - M - pw, y: H - 14 - 9, w: pw, h: 9, kind: "text" });
  });

  const bytes = await pdf.save();
  return { bytes, boxes, texts, pageCount: total, page: { width: W, height: H, margin: M, top: TOP, bottom: BOTTOM }, slack: page1Slack };
}
