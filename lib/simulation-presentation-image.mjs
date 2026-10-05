// Renderização (next/og, sem dependência nova) das duas imagens PNG da apresentação interativa:
//   - resumo da simulação ("Baixar apresentação")        → renderSummaryImage(dto)
//   - lista de documentos ("Baixar imagem da lista")     → renderDocumentsImage(dto)
// Identidade do PDF da simulação: degradê azul claro, cartão branco, bloco azul #0757B8, faixa de rodapé
// (public/assets/simulation-footer-strip.png) e a logo oficial da Caixa (a MESMA do formulário público) no rodapé, direto
// sobre o fundo (sem pílula branca). A lista de documentos segue a imagem de referência do dono (round 3).
// Sem JSX (createElement) para rodar também no `node --test`. A fonte padrão do next/og (Geist) só tem peso regular:
// o "negrito" é feito com sombra de texto sem desfoque (ver `bold`).
import { readFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { ImageResponse } from "next/og.js";
import {
  DOCUMENTS_LAYOUT,
  SUMMARY_IMAGE_SIZE,
  buildSummaryImageModel,
  documentsFileName,
  documentsImageSize,
  documentsTextWidth,
  getDocumentItems,
  imageResponseHeaders,
  summaryFileName
} from "./simulation-presentation-image-core.mjs";
import { BRAND_CRECI, BRAND_NAME, BRAND_ROLE } from "./simulation-presentation-documents.mjs";

const h = React.createElement;
const BLUE = "#0757B8";
const NAVY = "#072D65";
const DISCLAIMER = "Simulação estimada — valores finais dependem da análise de crédito do banco e confirmação da incorporadora.";

// ---------- assets (lidos uma vez; caminhos literais para o rastreio de arquivos da Vercel) ----------
let assetsPromise = null;
function toDataUri(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
export function loadImageAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      readFile(path.join(process.cwd(), "public", "assets", "caixa-logo-transparent.png")),
      readFile(path.join(process.cwd(), "public", "assets", "matheus-machado-symbol.png")),
      readFile(path.join(process.cwd(), "public", "assets", "simulation-financing-icon.png")),
      readFile(path.join(process.cwd(), "public", "assets", "simulation-subsidy-icon.png")),
      readFile(path.join(process.cwd(), "public", "assets", "simulation-footer-strip.png"))
    ])
      .then(([caixa, symbol, financing, subsidy, strip]) => ({
        caixa: toDataUri(caixa),
        symbol: toDataUri(symbol),
        financing: toDataUri(financing),
        subsidy: toDataUri(subsidy),
        strip: toDataUri(strip)
      }))
      .catch((error) => {
        assetsPromise = null;
        throw error;
      });
  }
  return assetsPromise;
}

// ---------- blocos ----------
// O Satori (next/og) quebra com valor de estilo undefined/null: sempre limpar.
function clean(style) {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined && value !== null));
}

function box(style, ...children) {
  return h("div", { style: clean({ display: "flex", ...style }) }, ...children.filter((child) => child !== null && child !== undefined));
}

/** Texto; `bold` engrossa com sombra sem desfoque (a fonte embutida só tem peso regular). */
function text(value, { size = 32, color = NAVY, bold = false, boldness = 1, align = "left", spacing = 0, upper = false, maxWidth, lineHeight = 1.2, style = {} } = {}) {
  const grow = Math.max(0.5, size * 0.022) * boldness;
  return h(
    "div",
    {
      style: clean({
        display: "flex",
        fontSize: size,
        color,
        textAlign: align,
        letterSpacing: spacing,
        textTransform: upper ? "uppercase" : "none",
        lineHeight,
        maxWidth,
        ...(bold ? { textShadow: `${grow}px 0 0 ${color}, -${grow}px 0 0 ${color}` } : {}),
        ...style
      })
    },
    value
  );
}

function fittedSize(value, { width, max, min }) {
  const size = Math.floor(width / (String(value).length * 0.6));
  return Math.max(min, Math.min(max, size));
}

function logoFooter(assets) {
  // Direto sobre o degradê azul claro (contraste suficiente), sem pílula/caixa/borda. Proporção original 780x196.
  return h("img", { src: assets.caixa, width: 420, height: 106, style: { width: 420, height: 106 } });
}

function brandHeader(assets) {
  return box(
    { alignItems: "center", backgroundColor: "#071B31", borderRadius: 999, padding: "14px 40px 14px 28px" },
    h("img", { src: assets.symbol, width: 72, height: 57, style: { width: 72, height: 57, marginRight: 20 } }),
    box(
      { flexDirection: "column" },
      text(BRAND_NAME, { size: 29, color: "#FFFFFF", bold: true, spacing: 4 }),
      text(BRAND_ROLE, { size: 17, color: "#9CC3F5", spacing: 4.5, style: { marginTop: 4 } })
    )
  );
}

function pageFrame(assets, children) {
  return box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "56px 60px 50px",
      backgroundImage: "linear-gradient(155deg, #DDF1FF 0%, #36A5FF 100%)"
    },
    ...children
  );
}

// ---------- imagem 1: resumo da simulação ----------
function summaryTree(model, assets) {
  const blocks = [];
  // Com muitos blocos opcionais (taxa, diferença de subsídio, imóvel) a faixa de rodapé do PDF sai para caber tudo.
  const optionalBlocks = [model.difference, model.propertyNames.length, model.installments?.interest].filter(Boolean).length;
  const showStrip = optionalBlocks <= 1;

  blocks.push(
    box(
      { flexDirection: "column", alignItems: "center", width: "100%" },
      brandHeader(assets),
      text("SIMULAÇÃO HABITACIONAL", { size: 56, color: BLUE, bold: true, spacing: 2, align: "center", style: { marginTop: 30 } }),
      model.subtitle ? text(model.subtitle, { size: 38, color: NAVY, align: "center", style: { marginTop: 6 } }) : null
    )
  );

  if (model.power) {
    const dual = model.formation?.mode === "soma";
    const size = fittedSize(model.power.value, { width: 840, max: 112, min: 60 });
    blocks.push(
      box(
        { flexDirection: "column", alignItems: "center", width: "100%", backgroundColor: "#FFFFFF", borderRadius: 48, padding: "38px 40px 34px", boxShadow: "0 18px 40px rgba(13,59,102,0.16)" },
        text(model.power.label, { size: 34, color: BLUE, bold: true, spacing: 1.5, align: "center" }),
        text(model.power.value, { size, color: NAVY, bold: true, align: "center", style: { marginTop: 12 } }),
        model.formation ? text(model.formation.caption, { size: 29, color: NAVY, align: "center", style: { marginTop: 8 } }) : null,
        dual
          ? box(
              { width: "100%", marginTop: 26, paddingTop: 26, borderTop: "2px solid #B8D2F0", justifyContent: "space-around" },
              box(
                { flexDirection: "column", alignItems: "center", width: "50%" },
                h("img", { src: assets.financing, width: 84, height: 84, style: { width: 84, height: 84 } }),
                text("FINANCIAMENTO", { size: 26, color: BLUE, bold: true, style: { marginTop: 10 } }),
                text(model.formation.financing, { size: fittedSize(model.formation.financing, { width: 400, max: 40, min: 28 }), color: NAVY, bold: true, style: { marginTop: 6 } })
              ),
              box(
                { flexDirection: "column", alignItems: "center", width: "50%", borderLeft: "3px solid #D8E6F6" },
                h("img", { src: assets.subsidy, width: 84, height: 84, style: { width: 84, height: 84 } }),
                text("SUBSÍDIO", { size: 26, color: BLUE, bold: true, style: { marginTop: 10 } }),
                text(model.formation.subsidy, { size: fittedSize(model.formation.subsidy, { width: 400, max: 40, min: 28 }), color: NAVY, bold: true, style: { marginTop: 6 } })
              )
            )
          : null
      )
    );
  }

  if (model.installments && (model.installments.first || model.installments.last)) {
    const { first, last, interest } = model.installments;
    const cells = [];
    if (first) cells.push(["PRIMEIRA PARCELA", first]);
    if (last) cells.push(["ÚLTIMA PARCELA", last]);
    blocks.push(
      box(
        { flexDirection: "column", alignItems: "center", width: "100%", backgroundColor: BLUE, borderRadius: 44, padding: "32px 30px 30px" },
        box(
          { width: "100%", justifyContent: "space-around" },
          ...cells.map(([label, value], index) =>
            box(
              { flexDirection: "column", alignItems: "center", width: cells.length === 2 ? "50%" : "100%", borderLeft: index === 1 ? "3px solid #8CC4FF" : undefined },
              text(label, { size: 27, color: "#FFFFFF", bold: true }),
              text(value, { size: fittedSize(value, { width: 400, max: 54, min: 32 }), color: "#FFFFFF", bold: true, style: { marginTop: 10 } })
            )
          )
        ),
        interest ? text(`Taxa de juros: ${interest}`, { size: 32, color: "#FFFFFF", bold: true, align: "center", style: { marginTop: 22, paddingTop: 20, borderTop: "3px solid #8CC4FF", width: "100%", justifyContent: "center" } }) : null
      )
    );
  }

  if (model.difference) {
    blocks.push(
      box(
        { flexDirection: "column", width: "100%", backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 34, padding: "20px 36px" },
        text("DIFERENÇA ENTRE IMÓVEL NOVO E USADO", { size: 25, color: BLUE, bold: true, spacing: 1 }),
        text(`Subsídio no imóvel novo: ${model.difference.novo}`, { size: 28, color: NAVY, style: { marginTop: 8 } }),
        text(`Subsídio no imóvel usado: ${model.difference.usado}`, { size: 28, color: NAVY, style: { marginTop: 4 } }),
        text(`Diferença de subsídio: ${model.difference.difference}`, { size: 30, color: NAVY, bold: true, style: { marginTop: 8 } })
      )
    );
  }

  if (model.propertyNames.length) {
    blocks.push(
      box(
        { flexDirection: "column", width: "100%", backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 34, padding: "20px 36px" },
        text(model.propertyLabel, { size: 25, color: BLUE, bold: true, spacing: 1 }),
        ...model.propertyNames.map((name) => text(name, { size: model.propertyNames.length > 1 ? 30 : 36, color: NAVY, bold: true, style: { marginTop: 6, lineClamp: 1 } })),
        model.propertyMore ? text(`e mais ${model.propertyMore}`, { size: 25, color: NAVY, style: { marginTop: 6 } }) : null
      )
    );
  }

  blocks.push(
    box(
      { flexDirection: "column", alignItems: "center", width: "100%" },
      text(DISCLAIMER, { size: 22, color: NAVY, align: "center", style: { justifyContent: "center", maxWidth: 900 } }),
      model.dateLabel ? text(`Simulação realizada em ${model.dateLabel}`, { size: 23, color: NAVY, align: "center", style: { marginTop: 6 } }) : null,
      text("WWW.MATHEUSMACHADOIMOVEIS.COM.BR", { size: 27, color: BLUE, bold: true, spacing: 3, style: { marginTop: 16 } }),
      showStrip ? h("img", { src: assets.strip, width: 760, height: 150, style: { width: 760, height: 150, marginTop: 16 } }) : null,
      box({ marginTop: 18 }, logoFooter(assets))
    )
  );

  return pageFrame(assets, blocks.map((block) => block));
}

// ---------- imagem 2: lista de documentos ----------
// Layout da imagem de referência do dono: faixa superior azul-marinho com a logo ATUAL (símbolo "M"), MATHEUS MACHADO e
// CORRETOR DE IMÓVEIS • CRECI; corpo branco com os itens (caixa azul de marcar desenhada em SVG, título em negrito e descrição
// menor). SEM faixa de rodapé (decisão do dono: nada de WhatsApp/Instagram/contato na imagem). A altura acompanha a lista.
const DOC_NAVY = "#06235A";
const DOC_BLUE = "#1769D1";
const DOC_INK = "#0B1F3F";

function checkBox() {
  const size = DOCUMENTS_LAYOUT.checkSize;
  return h(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", style: { width: size, height: size, flexShrink: 0 } },
    h("rect", { x: 2.2, y: 4.2, width: 16.6, height: 16.6, rx: 3.4, fill: "none", stroke: DOC_BLUE, strokeWidth: 1.9 }),
    h("path", { d: "M6.4 12.6 L10.6 16.8 L21 4.6", fill: "none", stroke: DOC_BLUE, strokeWidth: 2.3, strokeLinecap: "round", strokeLinejoin: "round" })
  );
}

function documentRow(item) {
  const l = DOCUMENTS_LAYOUT;
  return box(
    { alignItems: "flex-start", width: "100%" },
    box({ marginTop: 2, marginRight: l.checkGap }, checkBox()),
    box(
      { flexDirection: "column", width: documentsTextWidth(), paddingTop: l.textOffset },
      text(item.title, { size: l.titleSize, color: DOC_INK, bold: true, boldness: 1.7, lineHeight: l.titleLine }),
      item.description ? text(item.description, { size: l.descSize, color: "#1B2F52", upper: true, lineHeight: l.descLine, style: { marginTop: l.descGap } }) : null,
      ...item.lines.map((line) =>
        box(
          { alignItems: "flex-start", marginTop: l.bulletGap },
          box({ width: 10, height: 10, borderRadius: 999, backgroundColor: DOC_INK, marginTop: 11, marginRight: 26, flexShrink: 0 }),
          text(line, { size: l.descSize, color: "#1B2F52", upper: true, lineHeight: l.descLine, style: { flex: 1 } })
        )
      )
    )
  );
}

function documentsTree(items, assets, size) {
  const l = DOCUMENTS_LAYOUT;
  return box(
    { width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#FFFFFF" },
    box(
      { height: l.headerHeight, flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundImage: `linear-gradient(180deg, #0A2F78 0%, ${DOC_NAVY} 100%)` },
      h("img", { src: assets.symbol, width: 160, height: 127, style: { width: 160, height: 127 } }),
      text(BRAND_NAME, { size: 60, color: "#FFFFFF", bold: true, spacing: 11, style: { marginTop: 24 } }),
      text(`${BRAND_ROLE} • ${BRAND_CRECI}`, { size: 27, color: "#8DBBFF", spacing: 7, style: { marginTop: 14 } })
    ),
    box(
      { flexDirection: "column", padding: `${l.padTop}px ${l.padX}px ${l.padBottom}px`, height: size.height - l.headerHeight },
      ...items.map((item, index) => box({ width: "100%", marginTop: index === 0 ? 0 : l.itemGap }, documentRow(item)))
    )
  );
}

// ---------- respostas ----------
async function respond(tree, size, { fileName, download }) {
  return new ImageResponse(tree, { ...size, headers: imageResponseHeaders({ fileName, download }) });
}

/** Resumo da simulação (1080x1920) a partir do DTO público. */
export async function renderSummaryImage(dto, { download = false } = {}) {
  const assets = await loadImageAssets();
  const model = buildSummaryImageModel(dto);
  return respond(summaryTree(model, assets), SUMMARY_IMAGE_SIZE, { fileName: summaryFileName(model.firstName), download });
}

/**
 * Lista de documentos (1080 de largura; altura acompanha a lista): os itens FINAIS vêm do DTO (já personalizados no
 * servidor); a imagem nunca vê o cadastro. O primeiro nome só aparece no nome do arquivo.
 */
export async function renderDocumentsImage(dto, { download = false } = {}) {
  const assets = await loadImageAssets();
  const model = buildSummaryImageModel(dto);
  const items = getDocumentItems(dto);
  const size = documentsImageSize(items);
  return respond(documentsTree(items, assets, size), size, { fileName: documentsFileName(model.firstName), download });
}
