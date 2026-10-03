import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * PDF "Proposta de Valores" (A4) — versão para o cliente da apresentação de valores do
 * empreendimento. SOMENTE DESENHA: todos os números vêm de `buildPresentationModel`
 * (presentation-model.mjs); aqui só há formatação e layout. Nenhuma conta financeira.
 *
 * Direção visual v3 ("Carta", 2026-10-02): a proposta é contada como uma carta de corretor —
 * o nome do cliente em serifa, quatro frases curtas com um único destaque cada (ato inicial →
 * entrada → financiamento → descontos) e, logo abaixo, uma ficha de valores que é a ÚNICA fonte
 * do detalhamento. Sem cartões, sem números grandes: a hierarquia vem de escala tipográfica,
 * peso, ordem e espaço em branco. Pensada para o celular (zoom) e para impressão (preto e branco).
 * Paleta e logo da marca (azul-marinho profundo e azul do símbolo, medidos na logo oficial).
 */

const W = 595.28;
const H = 841.89;
const M = 56;
const CW = W - M * 2;
const BAND_H = 50;
const TOP = BAND_H + 38;
const BOTTOM = H - 62;

// Paleta âncora (valores medidos nos arquivos oficiais da logo).
const DEEP = rgb(0.012, 0.114, 0.227); // #031D3A
const BLUE = rgb(0.212, 0.451, 0.761); // #3673C2 (4,8:1 sobre branco)
const ON_DEEP = rgb(0.78, 0.851, 0.933); // #C7D9EE
const INK = rgb(0.043, 0.122, 0.208); // #0B1F35
const MUTED = rgb(0.337, 0.4, 0.475); // #566679 (≥ 5:1 sobre branco)
const LINE = rgb(0.847, 0.878, 0.918); // #D8E0EA
const WHITE = rgb(1, 1, 1);

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

// Largura real do texto desenhado: o pdf-lib mede COM kerning, mas o PDF desenha SEM (a menos que
// se emita ajuste por par), então a soma por caractere é a medida fiel.
const wid = (font, s, size) => {
  let sum = 0;
  for (const ch of String(s)) sum += font.widthOfTextAtSize(ch, size);
  return sum;
};

export async function gerarPropostaValoresPdf({ model, clienteNome, dataTexto, empreendimento = {}, logoBytes = null }) {
  const pdf = await PDFDocument.create();
  const empNome = empreendimento.nome || model.empreendimentoNome || "Empreendimento";
  pdf.setTitle(`Proposta de Valores - ${empreendimento.nome || model.empreendimentoNome || ""}`.trim());
  pdf.setAuthor("Matheus Machado Imóveis");
  pdf.setCreator("Matheus Machado Imóveis");
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifB = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifI = await pdf.embedFont(StandardFonts.TimesRomanItalic);
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

  function text(value, x, top, size, font, color, align = "left") {
    const content = safe(value, font);
    const width = wid(font, content, size);
    let drawX = x;
    if (align === "right") drawX = x - width;
    if (align === "center") drawX = x - width / 2;
    page.drawText(content, { x: drawX, y: H - top - size * 0.82, size, font, color });
    boxes.push({ page: pages.length - 1, x: drawX, y: top, w: width, h: size, kind: "text" });
    texts.push({ page: pages.length - 1, text: content, size });
    return width;
  }

  // Quebra de linha SEM cortar: valores ("R$ 972,22", "36x de R$ 972,22") ficam inteiros.
  function wrap(value, font, size, maxWidth) {
    const words = protect(safe(value, font)).split(" ").filter(Boolean).map(unprotect);
    const lines = [];
    let line = "";
    const push = () => { if (line) lines.push(line); line = ""; };
    for (const word of words) {
      let piece = word;
      // palavra maior que a linha: quebra por caractere
      while (wid(font, piece, size) > maxWidth) {
        let cut = piece.length - 1;
        while (cut > 1 && wid(font, piece.slice(0, cut), size) > maxWidth) cut -= 1;
        push();
        lines.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      const candidate = line ? `${line} ${piece}` : piece;
      if (wid(font, candidate, size) <= maxWidth) line = candidate;
      else { push(); line = piece; }
    }
    push();
    return lines.length ? lines : [""];
  }

  function rect(x, top, w, h, color, kind = "rect") {
    page.drawRectangle({ x, y: H - top - h, width: w, height: h, color });
    boxes.push({ page: pages.length - 1, x, y: top, w, h, kind });
  }

  function rule(x, top, w, color = LINE, thickness = 0.6) {
    page.drawRectangle({ x, y: H - top - thickness, width: w, height: thickness, color });
  }

  // Marca de "ok" em traço vetorial (sem fonte de ícones).
  function check(x, top, size, color) {
    const p1 = { x, y: H - top - size * 0.55 };
    const p2 = { x: x + size * 0.36, y: H - top - size * 0.9 };
    const p3 = { x: x + size, y: H - top - size * 0.1 };
    page.drawLine({ start: p1, end: p2, thickness: size * 0.18, color });
    page.drawLine({ start: p2, end: p3, thickness: size * 0.18, color });
  }

  function label(value, x, top, color = BLUE, size = 8.5) {
    return text(String(value).toUpperCase(), x, top, size, sansB, color);
  }

  function newPage() {
    page = pdf.addPage([W, H]);
    pages.push(page);
    rect(0, 0, W, BAND_H, DEEP, "band");
    rect(0, BAND_H, W, 1.5, BLUE, "band");
    const logoH = 24;
    const top = (BAND_H - logoH) / 2;
    let textX = M;
    if (logo) {
      const w = (logo.width / logo.height) * logoH;
      page.drawImage(logo, { x: M, y: H - top - logoH, width: w, height: logoH });
      boxes.push({ page: pages.length - 1, x: M, y: top, w, h: logoH, kind: "logo" });
      textX = M + w + 10;
    }
    text("MATHEUS MACHADO", textX, top + 2, 11.5, sansB, WHITE);
    text("CORRETOR DE IMÓVEIS", textX, top + 16, 7.5, sansB, ON_DEEP);
    text("PROPOSTA DE VALORES", W - M, top + 2, 8.5, sansB, WHITE, "right");
    text(dataTexto ? `Emitida em ${dataTexto}` : "", W - M, top + 14.5, 8.5, sans, ON_DEEP, "right");
    y = TOP;
  }

  function ensure(h) {
    if (y + h > BOTTOM) newPage();
  }

  // ---- Dados de exibição (nenhuma conta: tudo já vem do modelo) ------------------
  const m = model;
  const cliente = clienteNome || "Cliente";
  const parcelado = m.saldoParcelado > 0 || Boolean(m.parcelamento);
  const parcelasTexto = m.parcelamento ? `${m.parcelamento.parcelas}x de ${formatBRL(m.parcelamento.valorParcela)}` : "";
  const financiamentoParcelas = (() => {
    const first = m.primeiraParcelaFinanciamento;
    const last = m.ultimaParcelaFinanciamento;
    if (first > 0 && last > 0) return { texto: `${formatBRL(first)} a ${formatBRL(last)}`, tipo: "faixa" };
    if (first > 0) return { texto: formatBRL(first), tipo: "primeira" };
    if (last > 0) return { texto: formatBRL(last), tipo: "ultima" };
    return null;
  })();
  // Descontos que abatem o preço/entrada primeiro; a documentação gratuita (benefício adicional,
  // valor próprio do modelo) vem separada, sem misturar com os abatimentos.
  const beneficioRows = m.temDescontosOuBeneficios
    ? [
        ...m.descontos.map((d) => ({ label: d.label, valor: d.valor })),
        ...(m.subsidioMcmv > 0 ? [{ label: "Subsídio Minha Casa Minha Vida", valor: m.subsidioMcmv }] : []),
        ...(m.casaPaulista > 0 ? [{ label: "Casa Paulista", valor: m.casaPaulista }] : []),
        ...(m.documentacaoGratuita.aplica ? [{ label: "Documentação gratuita (benefício adicional)", valor: m.documentacaoGratuita.valor }] : [])
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

  // ---- Texto corrido com destaques: cada linha vira poucos trechos (um por estilo) -----
  function flow(tokens, top, size, lineH, maxW) {
    const atoms = [];
    let needSpace = false;
    for (const tk of tokens) {
      if (tk.nb) {
        atoms.push({ w: safe(tk.t, tk.font), font: tk.font, bold: true, spaceBefore: needSpace });
        needSpace = false;
        continue;
      }
      const raw = protect(safe(tk.t, tk.font));
      const startsSpace = raw.startsWith(" ");
      const parts = raw.split(" ").filter(Boolean);
      parts.forEach((word, i) => atoms.push({ w: unprotect(word), font: tk.font, bold: false, spaceBefore: i === 0 ? needSpace || startsSpace : true }));
      needSpace = raw.endsWith(" ");
    }
    const lines = [[]];
    let x = 0;
    for (const atom of atoms) {
      const line = lines[lines.length - 1];
      const prev = line[line.length - 1];
      const space = atom.spaceBefore && prev ? wid(prev.font, " ", size) : 0;
      const ww = wid(atom.font, atom.w, size);
      // pontuação colada (sem espaço antes) nunca vai sozinha para a linha de baixo
      if (prev && atom.spaceBefore && x + space + ww > maxW) { lines.push([{ ...atom, spaceBefore: false }]); x = ww; continue; }
      line.push({ ...atom });
      x += space + ww;
    }
    let ly = top;
    for (const line of lines) {
      const segments = [];
      for (const atom of line) {
        const last = segments[segments.length - 1];
        if (last && !atom.bold && !last.bold && last.font === atom.font) last.t += `${atom.spaceBefore ? " " : ""}${atom.w}`;
        else segments.push({ t: atom.w, font: atom.font, spaceBefore: atom.spaceBefore, bold: atom.bold });
      }
      // Posição pelo comprimento REAL de cada trecho (o kerning do PDF encurta a string inteira
      // em relação à soma das palavras): o espaço entre trechos fica sempre correto.
      let cx = 0;
      segments.forEach((seg, i) => {
        if (i > 0 && seg.spaceBefore) cx += wid(segments[i - 1].font, " ", size);
        text(seg.t, M + cx, ly, size, seg.font, INK);
        cx += wid(seg.font, safe(seg.t, seg.font), size);
      });
      ly += lineH;
    }
    return ly;
  }

  // ======================================================================================
  // PÁGINA 1 — a carta
  // ======================================================================================
  newPage();
  label("Proposta personalizada", M, y);
  y += 20;
  let nameSize = 28;
  while (nameSize > 18 && wrap(cliente, serif, nameSize, CW).length > 2) nameSize -= 1;
  const nameLines = wrap(cliente, serif, nameSize, CW);
  nameLines.forEach((line, i) => text(line, M, y + i * nameSize * 1.14, nameSize, serif, INK));
  y += nameLines.length * nameSize * 1.14 + 8;
  const identLine = [empNome, empreendimento.construtora].filter(Boolean).join("  ·  ");
  wrap(identLine, sansB, 10.5, CW).forEach((line) => { text(line, M, y, 10.5, sansB, INK); y += 14; });
  if (empreendimento.localizacao) wrap(empreendimento.localizacao, sans, 9.5, CW).forEach((line) => { text(line, M, y, 9.5, sans, MUTED); y += 13; });
  y += 12;
  rule(M, y, 36, BLUE, 1.2);
  y += 26;

  // Quatro frases curtas, um destaque em cada (o que decide), na ordem em que o comprador pergunta.
  const LEAD = 15;
  const LEAD_LH = 22;
  const LEAD_W = CW - 24;
  const t = (s) => ({ t: s, font: serif });
  const b = (s) => ({ t: s, font: serifB, nb: true });
  const atoText = formatBRL(m.atoInicial);
  const atoTail = m.entradaTotalmenteParcelada ? ". Entrada 100% parcelada, sem pagamento inicial." : m.atoInicial > 0 ? ", o pagamento para começar." : ".";
  y = flow([t("Seu ato inicial é "), b(atoText), t(atoTail)], y, LEAD, LEAD_LH, LEAD_W) + 8;

  let entrada;
  if (m.entradaTotal <= 0) entrada = [t("Não há valor de entrada a pagar.")];
  else if (m.parcelamento && m.entradaTotalmenteParcelada) entrada = [t(`A entrada total de ${formatBRL(m.entradaTotal)} é paga em `), b(parcelasTexto), t(".")];
  else if (m.parcelamento) entrada = [t(`A entrada total é de ${formatBRL(m.entradaTotal)}, e o valor parcelado (${formatBRL(m.saldoParcelado)}) é pago em `), b(parcelasTexto), t(".")];
  else if (m.saldoParcelado > 0) entrada = [t(`A entrada total é de ${formatBRL(m.entradaTotal)}, com valor parcelado de `), b(formatBRL(m.saldoParcelado)), t(".")];
  else entrada = [t("A entrada total é de "), b(formatBRL(m.entradaTotal)), t(".")];
  y = flow(entrada, y, LEAD, LEAD_LH, LEAD_W) + 8;

  const financ = [t(`O financiamento é de ${formatBRL(m.financiamentoAprovado)}`)];
  if (financiamentoParcelas?.tipo === "faixa") financ.push(t(", com 1ª parcela de "), b(formatBRL(m.primeiraParcelaFinanciamento)), t(" e última de "), b(formatBRL(m.ultimaParcelaFinanciamento)), t("."));
  else if (financiamentoParcelas?.tipo === "primeira") financ.push(t(", com 1ª parcela de "), b(financiamentoParcelas.texto), t("."));
  else if (financiamentoParcelas?.tipo === "ultima") financ.push(t(", com última parcela de "), b(financiamentoParcelas.texto), t("."));
  else financ.push(t("."));
  y = flow(financ, y, LEAD, LEAD_LH, LEAD_W) + 8;

  if (beneficioRows.length) {
    y = flow([t("Você ainda conta com "), b(formatBRL(m.totalDescontosEBeneficios)), t(" em descontos e benefícios.")], y, LEAD, LEAD_LH, LEAD_W) + 8;
  }
  y += 14;

  // ---- Ficha de valores: a única fonte do detalhamento ----------------------------------
  const GAP = 32;
  const COL_W = (CW - GAP) / 2;
  const ROW_SIZE = 10;
  const ROW_H = 19;
  const VALUE_W = 96;
  function ledgerHeight(rows, hasTotal) {
    let h = 17;
    for (const row of rows) h += ROW_H + (wrap(row.label, row.strong ? sansB : sans, ROW_SIZE, COL_W - VALUE_W - 8).length - 1) * (ROW_SIZE + 3);
    return h + (hasTotal ? ROW_H + 2 : 0) + 12;
  }
  function ledger(x, top, title, rows, total = null) {
    let ty = top;
    label(title, x, ty);
    ty += 17;
    rows.forEach((row, i) => {
      const font = row.strong ? sansB : sans;
      const lines = wrap(row.label, font, ROW_SIZE, COL_W - VALUE_W - 8);
      lines.forEach((line, li) => text(line, x, ty + li * (ROW_SIZE + 3), ROW_SIZE, font, row.accent ? BLUE : INK));
      text(row.valor, x + COL_W, ty, ROW_SIZE, sansB, row.accent ? BLUE : INK, "right");
      const h = ROW_H + (lines.length - 1) * (ROW_SIZE + 3);
      if (i < rows.length - 1 || total) rule(x, ty + h - 4, COL_W);
      ty += h;
    });
    if (total) {
      text(total.label, x, ty + 1, ROW_SIZE + 0.5, sansB, INK);
      text(total.valor, x + COL_W, ty + 1, ROW_SIZE + 0.5, sansB, INK, "right");
      ty += ROW_H + 2;
    }
    return ty + 12;
  }

  const entradaRows = [
    { label: "Entrada total", valor: formatBRL(m.entradaTotal), strong: true },
    { label: "ATO INICIAL", valor: formatBRL(m.atoInicial), strong: true, accent: true }
  ];
  if (parcelado) {
    entradaRows.push({ label: m.parcelamento ? "Valor parcelado" : "Saldo parcelado", valor: formatBRL(m.saldoParcelado) });
    if (m.parcelamento) entradaRows.push({ label: "Parcelamento", valor: parcelasTexto });
  }
  m.outrosBlocos.forEach((block) => entradaRows.push({ label: block.label, valor: `${block.parcelas}x de ${formatBRL(block.valorParcela)}` }));
  const imovelRows = [
    { label: "Valor total do imóvel", valor: formatBRL(m.valorImovel), strong: true },
    { label: "Financiamento aprovado", valor: formatBRL(m.financiamentoAprovado), strong: true }
  ];
  if (m.primeiraParcelaFinanciamento > 0) imovelRows.push({ label: "Primeira parcela", valor: formatBRL(m.primeiraParcelaFinanciamento) });
  if (m.ultimaParcelaFinanciamento > 0) imovelRows.push({ label: "Última parcela", valor: formatBRL(m.ultimaParcelaFinanciamento) });
  const sections = [
    { title: "Sua entrada", rows: entradaRows },
    { title: "Imóvel e financiamento", rows: imovelRows },
    ...(beneficioRows.length
      ? [{ title: "Descontos e benefícios", rows: beneficioRows.map((r) => ({ label: r.label, valor: formatBRL(r.valor) })), total: { label: "Total", valor: formatBRL(m.totalDescontosEBeneficios) } }]
      : [])
  ];
  // Distribui as seções entre as duas colunas (mantendo a ordem da narrativa) no arranjo mais
  // equilibrado: testa todas as divisões e fica com a de menor altura máxima.
  const heights = sections.map((section) => ledgerHeight(section.rows, Boolean(section.total)));
  let best = null;
  for (let mask = 0; mask < 1 << sections.length; mask += 2) {
    const h = [0, 0];
    sections.forEach((_, i) => { h[(mask >> i) & 1] += heights[i]; });
    const score = Math.max(h[0], h[1]);
    if (!best || score < best.score - 0.5) best = { mask, score, h };
  }
  const colH = best.h;
  const colSections = [[], []];
  sections.forEach((section, i) => colSections[(best.mask >> i) & 1].push(section));
  ensure(Math.max(colH[0], colH[1]) + 18);
  rule(M, y, CW, INK, 0.8);
  y += 16;
  const fichaTop = y;
  colSections.forEach((list, ci) => {
    let cy = fichaTop;
    list.forEach((section) => { cy = ledger(M + ci * (COL_W + GAP), cy, section.title, section.rows, section.total || null); });
  });
  y = fichaTop + Math.max(colH[0], colH[1]) + 6;

  // ---- Próximo passo (antes das vantagens: nunca fica para depois de uma lista longa) ------
  ensure(54);
  rule(M, y, CW);
  y += 16;
  const passoLabel = "Próximo passo: ";
  text(passoLabel, M, y, 12.5, serifB, INK);
  text("fale com o seu corretor para confirmar a análise de crédito e os valores finais.", M + wid(serifB, passoLabel, 12.5), y, 12.5, serifI, INK);
  y += 30;

  // ---- Vantagens do empreendimento (nunca cortadas; continuam na página seguinte) -----------
  if (vantagens.length) {
    const gap = 26;
    const colW = (CW - gap) / 2;
    const size = 10.5;
    const lineH = 13.5;
    const prepared = vantagens.map((item) => wrap(item, sans, size, colW - 17));
    // o título nunca fica sozinho: precisa caber junto com a primeira linha de itens
    const firstRow = Math.max(prepared[0].length, prepared[1] ? prepared[1].length : 0) * lineH + 8;
    ensure(16 + 20 + firstRow);
    rule(M, y, CW);
    y += 16;
    label("Vantagens do empreendimento", M, y);
    y += 20;
    let col = 0;
    let rowTop = y;
    let rowH = 0;
    prepared.forEach((lines, i) => {
      if (col === 0) {
        const own = lines.length * lineH + 8;
        const next = prepared[i + 1] ? prepared[i + 1].length * lineH + 8 : 0;
        rowH = Math.max(own, next);
        if (rowTop + rowH > BOTTOM) {
          newPage();
          label("Vantagens do empreendimento (continuação)", M, y);
          y += 22;
          rowTop = y;
        }
      }
      const x = M + col * (colW + gap);
      check(x, rowTop + 2, 8.5, BLUE);
      lines.forEach((line, li) => text(line, x + 15, rowTop + li * lineH, size, sans, INK));
      if (col === 1 || i === prepared.length - 1) {
        rowTop += rowH;
        y = rowTop;
        col = 0;
      } else {
        col = 1;
      }
    });
  }

  // ---- Rodapé (todas as páginas) ------------------------------------------------------
  const total = pages.length;
  pages.forEach((p, index) => {
    p.drawRectangle({ x: M, y: 50, width: CW, height: 0.6, color: LINE });
    const note = "Simulação estimada. Os valores finais dependem da análise de crédito do banco e da confirmação da incorporadora.";
    wrap(note, sans, 8, CW).forEach((line, i) => {
      const top = H - 50 + 5 + i * 10;
      p.drawText(line, { x: M, y: H - top - 6.6, size: 8, font: sans, color: MUTED });
      boxes.push({ page: index, x: M, y: top, w: wid(sans, line, 8), h: 8, kind: "text" });
      texts.push({ page: index, text: line, size: 8 });
    });
    const footerText = "www.matheusmachadoimoveis.com.br  |  @mhm.machado";
    p.drawText(footerText, { x: M, y: 16, size: 8.5, font: sans, color: MUTED });
    boxes.push({ page: index, x: M, y: H - 16 - 8.5, w: wid(sans, footerText, 8.5), h: 8.5, kind: "text" });
    texts.push({ page: index, text: footerText, size: 8.5 });
    const pn = `${index + 1}/${total}`;
    const pw = wid(sans, pn, 8.5);
    p.drawText(pn, { x: W - M - pw, y: 16, size: 8.5, font: sans, color: MUTED });
    boxes.push({ page: index, x: W - M - pw, y: H - 16 - 8.5, w: pw, h: 8.5, kind: "text" });
  });

  const bytes = await pdf.save();
  return { bytes, boxes, texts, pageCount: total, page: { width: W, height: H, margin: M, top: TOP, bottom: BOTTOM } };
}
