import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { STRATEGY_NAME_CAPS, describeChoices, formatDuration, formatRoundedYears, yearsLessText, balanceChartPaths, strategyHeadline } from "./payment-strategy-core.mjs";
import { formatBRL } from "./simulation-presentation-format.mjs";

// PDF "Minha estratégia de pagamento" (A4, uma página) da apresentação da simulação (PRES-24). SOMENTE DESENHA: todos os
// números vêm do motor `payment-strategy-core.mjs` (`compareStrategy`) sobre a base da simulação. Mesmo padrão visual da
// "Proposta de Valores" (faixa azul-marinho com o símbolo oficial atual, `public/assets/matheus-machado-symbol.png`).
// Sem aviso de "simulação ilustrativa" (pedido explícito do dono). O PDF da simulação NÃO é tocado.

const W = 595.28;
const H = 841.89;
const M = 42;
const CW = W - M * 2;
const HEADER_H = 74;

const NAVY = rgb(0.051, 0.231, 0.4); // #0D3B66
const BRAND = rgb(0.09, 0.412, 0.82); // #1769D1
const PANEL = rgb(0.957, 0.976, 1); // #F4F9FF
const LINE = rgb(0.898, 0.918, 0.945); // #E5EAF1
const MUTED = rgb(0.4, 0.45, 0.52);
const WHITE = rgb(1, 1, 1);
const ON_NAVY_SOFT = rgb(0.8, 0.86, 0.94);
const SUCCESS = rgb(0.027, 0.463, 0.278); // #067647
const SUCCESS_SOFT = rgb(0.906, 0.969, 0.937);
const DANGER_LINE = rgb(0.706, 0.137, 0.094); // #B42318 — "Sem amortização" vermelho no gráfico (igual à tela, 2026-10-18)
const DANGER_SOFT = rgb(0.992, 0.925, 0.922); // #FDECEB — pílula "35 anos" (igual à tela, 2026-10-19)

const SYSTEM_LABEL = { price: "Tabela Price", sac: "SAC" };

export function strategyPdfFileName(firstName = "") {
  const slug = String(firstName || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 30);
  return `estrategia-com-amortizacao${slug ? `-${slug}` : ""}.pdf`;
}

/**
 * @param {{ base:object, choices:object, comparison:object, firstName?:string, dateText?:string, logoBytes?:Uint8Array|null }} input
 * @returns {Promise<Uint8Array>}
 */
export async function generatePaymentStrategyPdf({ base, choices, comparison, firstName = "", dateText = "", logoBytes = null }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Minha estratégia com amortização");
  pdf.setAuthor("Matheus Machado Corretor de Imóveis");
  pdf.setCreator("Matheus Machado Corretor de Imóveis");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  if (logoBytes) {
    try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; }
  }
  const page = pdf.addPage([W, H]);

  const safe = (value, font) => {
    let out = "";
    for (const ch of String(value ?? "").replace(/\s+/g, " ")) {
      try { font.encodeText(ch); out += ch; } catch { out += "?"; }
    }
    return out;
  };
  // `top` = distância do topo da página até o topo do texto
  const text = (value, x, top, size, font, color, align = "left") => {
    const content = safe(value, font);
    const width = font.widthOfTextAtSize(content, size);
    const drawX = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    page.drawText(content, { x: drawX, y: H - top - size * 0.82, size, font, color });
    return width;
  };
  const box = (x, top, w, h, color, border) => page.drawRectangle({ x, y: H - top - h, width: w, height: h, color, borderColor: border, borderWidth: border ? 1 : 0 });

  // Cabeçalho (mesma assinatura da Proposta de Valores)
  page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: NAVY });
  page.drawRectangle({ x: 0, y: H - HEADER_H - 2, width: W, height: 2, color: BRAND });
  let textX = M;
  if (logo) {
    const hh = 36;
    const w = (logo.width / logo.height) * hh;
    page.drawImage(logo, { x: M, y: H - (HEADER_H - hh) / 2 - hh, width: w, height: hh });
    textX = M + w + 12;
  }
  text("MATHEUS MACHADO", textX, 21, 13, bold, WHITE);
  text("CORRETOR DE IMÓVEIS", textX, 38, 8, bold, ON_NAVY_SOFT);
  text(STRATEGY_NAME_CAPS, W - M, 23, 9, bold, WHITE, "right");
  text(dateText, W - M, 38, 9, regular, ON_NAVY_SOFT, "right");

  let y = 100;
  text(firstName ? `${firstName}, esta é a sua estratégia com amortização` : "Sua estratégia com amortização", M, y, 18, bold, NAVY);
  y += 30;

  // Números da simulação
  box(M, y, CW, 58, PANEL, LINE);
  const cells = [
    ["Valor financiado", formatBRL(base.financiamento)],
    // taxa deduzida da parcela (sem taxa gravada) não é impressa como a taxa do contrato
    base.taxaEstimada ? null : ["Taxa de juros", `${String(base.taxaAnual).replace(".", ",")}% ao ano`],
    ["Prazo", `${base.prazoMeses} meses`],
    ["Sistema", SYSTEM_LABEL[base.sistema] || ""],
    [base.sistema === "sac" ? "Primeira parcela" : "Parcela", base.parcela > 0 ? formatBRL(base.parcela) : "-"]
  ].filter(Boolean);
  const cellW = CW / cells.length;
  cells.forEach(([label, value], index) => {
    const x = M + 12 + index * cellW;
    text(label.toUpperCase(), x, y + 14, 7, bold, MUTED);
    text(value, x, y + 30, 10.5, bold, NAVY);
  });
  y += 76;

  // O que foi incluído
  text("O QUE ENTRA NA SUA ESTRATÉGIA", M, y, 9, bold, BRAND);
  y += 16;
  const lines = describeChoices(choices, formatBRL, base); // só as opções permitidas para o cliente (PRES-24, 2026-10-18)
  for (const line of lines.length ? lines : ["Nenhum valor extra incluído."]) {
    page.drawCircle({ x: M + 4, y: H - y - 4.5, size: 2.2, color: BRAND });
    text(line, M + 14, y, 10.5, regular, NAVY);
    y += 17;
  }
  y += 4;
  text("Cada valor extra é usado para abater o saldo devedor e reduzir o prazo do financiamento.", M, y, 9, regular, MUTED);
  y += 26;

  // Lado a lado
  const colW = (CW - 14) / 2;
  const column = (x, title, months, interest, accent) => {
    box(x, y, colW, 110, accent ? SUCCESS_SOFT : PANEL, accent ? SUCCESS : LINE);
    text(title.toUpperCase(), x + 14, y + 14, 8.5, bold, accent ? SUCCESS : MUTED);
    text(formatDuration(months), x + 14, y + 32, 17, bold, NAVY);
    text(`${months} parcelas`, x + 14, y + 56, 10.5, regular, NAVY);
    text("Juros pagos", x + 14, y + 76, 8.5, regular, MUTED);
    text(formatBRL(interest), x + 14, y + 88, 12, bold, NAVY);
  };
  column(M, "Sem amortização", comparison.sem.months, comparison.sem.totalInterest, false);
  column(M + colW + 14, "Com amortização", comparison.com.months, comparison.com.totalInterest, true);
  y += 124;

  // Destaque
  box(M, y, CW, 50, NAVY);
  if (comparison.economiaJuros > 0) {
    text(`${formatBRL(comparison.economiaJuros)} a menos de juros`, W / 2, y + 12, 17, bold, WHITE, "center");
    // "Com R$ 100/mês + R$ 1.000/ano você quita seu imóvel em X e economiza R$ Y de juros." (encolhe a fonte se não couber)
    const headline = strategyHeadline(comparison, choices, base, formatBRL) || `${formatDuration(comparison.mesesAMenos)} a menos de financiamento`;
    let size = 10;
    while (size > 6.5 && regular.widthOfTextAtSize(safe(headline, regular), size) > CW - 24) size -= 0.5;
    text(headline, W / 2, y + 33, size, regular, ON_NAVY_SOFT, "center");
  } else {
    text("Ligue uma opção para ver quanto você economiza", W / 2, y + 19, 12, bold, WHITE, "center");
  }
  y += 70;

  // Gráfico "quanto do financiamento você já quitou" (ajustes do dono, 2026-10-19 — igual à tela): as duas linhas iguais (sólidas,
  // mesma espessura), vermelho sem amortização e verde com amortização, SUBINDO de R$ 0 até o financiado; anos no fim de cada
  // linha e "N anos a menos" na faixa verde. Só desenho: o caminho vem de balanceChartPaths (saldo) espelhado na vertical.
  text("QUANTO DO FINANCIAMENTO VOCÊ JÁ QUITOU", M, y, 9, bold, BRAND);
  y += 34; // título + linha dos anos acima das pontas
  const chartW = CW - 50;
  const chartH = 150;
  const chartX = M + 46;
  page.drawLine({ start: { x: chartX, y: H - y - chartH }, end: { x: chartX + chartW, y: H - y - chartH }, thickness: 0.8, color: LINE });
  page.drawLine({ start: { x: chartX, y: H - y }, end: { x: chartX + chartW, y: H - y }, thickness: 0.5, color: LINE });
  page.drawLine({ start: { x: chartX, y: H - y }, end: { x: chartX, y: H - y - chartH }, thickness: 0.8, color: LINE });
  text(formatBRL(base.financiamento).replace(/,\d\d$/, ""), chartX - 6, y - 3, 7, regular, MUTED, "right");
  text("R$ 0", chartX - 6, y + chartH - 6, 7, regular, MUTED, "right");
  const paths = balanceChartPaths(comparison, { width: chartW, height: chartH });
  // saldo → valor quitado: espelha o y (0 = topo = tudo quitado)
  const points = (path) => [...String(path || "").matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), chartH - Number(m[2])]);
  const toPath = (list) => list.map(([px, py], index) => `${index ? "L" : "M"}${px} ${py}`).join(" ");
  const semPts = points(paths.sem);
  const withCom = comparison.com.months < comparison.sem.months;
  const comPts = withCom ? points(paths.com) : [];
  const comEnd = comPts[comPts.length - 1];
  const semEnd = semPts[semPts.length - 1];
  // drawSvgPath usa o eixo y para baixo a partir do ponto (x, y) informado
  if (withCom && comEnd) {
    const band = `${toPath(semPts)} L${comEnd[0]} 0 ${toPath([...comPts].reverse()).replace(/^M/, "L")} Z`;
    page.drawSvgPath(band, { x: chartX, y: H - y, color: SUCCESS, opacity: 0.16, borderWidth: 0 });
  }
  page.drawSvgPath(toPath(semPts), { x: chartX, y: H - y, borderColor: DANGER_LINE, borderWidth: 2.2 });
  if (withCom) page.drawSvgPath(toPath(comPts), { x: chartX, y: H - y, borderColor: SUCCESS, borderWidth: 2.2 });
  const dot = (point, color) => page.drawCircle({ x: chartX + point[0], y: H - y - point[1], size: 3.6, color, borderColor: WHITE, borderWidth: 1.2 });
  // pontas (dono, 2026-10-19): só os anos arredondados ("11 anos"), pequenos, numa pílula clara na cor da linha
  const PILL_SIZE = 8;
  const pill = (label, cx, color, fill, align) => {
    const h = 13;
    const w = bold.widthOfTextAtSize(safe(label, bold), PILL_SIZE) + 14;
    const left = align === "right" ? cx - w : cx;
    const top = y - 19;
    page.drawRectangle({ x: left + h / 2, y: H - top - h, width: w - h, height: h, color: fill, borderWidth: 0 });
    page.drawCircle({ x: left + h / 2, y: H - top - h / 2, size: h / 2, color: fill });
    page.drawCircle({ x: left + w - h / 2, y: H - top - h / 2, size: h / 2, color: fill });
    text(label, left + w / 2, top + 2.9, PILL_SIZE, bold, color, "center");
    return w;
  };
  const semLabel = formatRoundedYears(comparison.sem.months);
  let semPillW = 0;
  if (semEnd) {
    dot(semEnd, DANGER_LINE);
    semPillW = pill(semLabel, chartX + semEnd[0] + 4, DANGER_LINE, DANGER_SOFT, "right");
  }
  if (withCom && comEnd) {
    dot(comEnd, SUCCESS);
    const label = formatRoundedYears(comparison.com.months);
    const labelW = bold.widthOfTextAtSize(safe(label, bold), PILL_SIZE) + 14;
    // centrada na ponta verde, sem invadir a pílula vermelha do fim
    const labelX = Math.max(chartX, Math.min(chartX + comEnd[0] - labelW / 2, chartX + chartW + 4 - semPillW - labelW - 16));
    pill(label, labelX, SUCCESS, SUCCESS_SOFT, "left");
    // "N anos a menos" (só anos inteiros; 0 → sem texto): na faixa verde, entre a ponta verde e onde a linha vermelha passa
    // por baixo do texto; se não couber, ao lado da linha verde (à esquerda dela, no espaço livre), sem cruzar nenhuma linha
    const gapText = yearsLessText(comparison.sem.months, comparison.com.months);
    if (gapText) drawGap(gapText);
  }
  function drawGap(gapText) {
    const textBottom = 30; // o texto ocupa ~12–28 pt abaixo do topo do gráfico
    const redX = (semPts.find(([, py]) => py <= textBottom + 4) || semEnd)[0];
    const room = redX - comEnd[0] - 12;
    let size = 13;
    while (size > 9.5 && bold.widthOfTextAtSize(safe(gapText, bold), size) > room) size -= 0.5;
    if (bold.widthOfTextAtSize(safe(gapText, bold), size) <= room) text(gapText, chartX + (comEnd[0] + redX) / 2, y + 12, size, bold, SUCCESS, "center");
    else {
      const greenX = (comPts.find(([, py]) => py <= textBottom + 4) || comEnd)[0];
      text(gapText, chartX + greenX - 10, y + 12, 11, bold, SUCCESS, "right");
    }
  }
  const years = Math.ceil(comparison.sem.months / 12);
  text("hoje", chartX, y + chartH + 6, 7.5, regular, MUTED);
  text(`${years} ${years === 1 ? "ano" : "anos"}`, chartX + chartW, y + chartH + 6, 7.5, regular, MUTED, "right");
  y += chartH + 24;
  page.drawLine({ start: { x: M, y: H - y - 4 }, end: { x: M + 18, y: H - y - 4 }, thickness: 2.2, color: DANGER_LINE });
  text("Sem amortização", M + 24, y, 8.5, regular, MUTED);
  page.drawLine({ start: { x: M + 120, y: H - y - 4 }, end: { x: M + 138, y: H - y - 4 }, thickness: 2.2, color: SUCCESS });
  text("Com amortização", M + 144, y, 8.5, regular, MUTED);
  if (withCom && comparison.economiaJuros > 0) {
    box(M + 240, y - 1, 16, 8, rgb(0.83, 0.92, 0.87));
    text("Área verde = juros que você deixa de pagar", M + 262, y, 8.5, regular, MUTED);
  }

  // Rodapé
  page.drawLine({ start: { x: M, y: 56 }, end: { x: W - M, y: 56 }, thickness: 0.8, color: LINE });
  text("Matheus Machado Corretor de Imóveis · matheusmachadoimoveis.com.br", W / 2, H - 46, 8.5, regular, MUTED, "center");
  return pdf.save();
}
