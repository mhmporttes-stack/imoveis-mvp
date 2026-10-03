import { deflateSync, inflateSync } from "node:zlib";
import {
  PDFDict,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFString,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setCharacterSpacing
} from "pdf-lib";
import { ICONS } from "./proposta-pdf-icons.mjs";
import { photo as photoTokens, rgbOf, shadow as shadowTokens } from "./proposta-pdf-tokens.mjs";

/**
 * Primitivas de DESENHO do PDF (renderização). Não conhecem dado financeiro nem layout da
 * proposta: recebem coordenadas já resolvidas ("top" = distância do topo da página, em pt) e
 * desenham vetor nativo — gradiente (shading axial), cartão com sombra em camadas, ícone
 * outline, foto com máscara de transição (soft mask), marca d'água e link clicável (annotation).
 */
export function createKit(pdf, H) {
  const color = (hexValue) => {
    const [r, g, b] = rgbOf(hexValue);
    return rgb(r, g, b);
  };
  let uid = 0;
  const nextName = (prefix) => `${prefix}${(uid += 1)}`;

  function resources(page) {
    return page.node.normalizedEntries().Resources;
  }

  function addShading(page, name, ref) {
    const res = resources(page);
    let dict = res.lookup(PDFName.of("Shading"));
    if (!(dict instanceof PDFDict)) {
      dict = pdf.context.obj({});
      res.set(PDFName.of("Shading"), dict);
    }
    dict.set(PDFName.of(name), ref);
  }

  /** Gradiente vertical contínuo (nativo): stops = [[posição 0..1, "#hex"], ...] entre `topY` e `bottomY` (de cima). */
  function verticalGradient(page, stops, fromTop, toTop, clipBox) {
    const cols = stops.map(([, c]) => rgbOf(c));
    const functions = [];
    for (let i = 0; i < stops.length - 1; i += 1) {
      functions.push({ FunctionType: 2, Domain: [0, 1], C0: cols[i], C1: cols[i + 1], N: 1 });
    }
    const bounds = stops.slice(1, -1).map(([pos]) => pos);
    const shading = pdf.context.obj({
      ShadingType: 2,
      ColorSpace: "DeviceRGB",
      Coords: [0, H - fromTop, 0, H - toTop],
      Extend: [true, true],
      Function: { FunctionType: 3, Domain: [0, 1], Functions: functions, Bounds: bounds, Encode: functions.flatMap(() => [0, 1]) }
    });
    const name = nextName("Sh");
    const shadingRef = pdf.context.register(shading);
    addShading(page, name, shadingRef);
    page.pushOperators(
      pushGraphicsState(),
      rectangle(clipBox.x, H - clipBox.top - clipBox.h, clipBox.w, clipBox.h),
      clip(),
      endPath(),
      PDFOperator.of("sh", [PDFName.of(name)]),
      popGraphicsState()
    );
  }

  /** Retângulo arredondado como SVG path em coordenadas "de cima" (y para baixo). */
  function roundedPath(x, top, w, h, r) {
    const k = Math.min(r, w / 2, h / 2);
    const c = k * 0.5523;
    const x2 = x + w;
    const y2 = top + h;
    return [
      `M${x + k} ${top}`,
      `L${x2 - k} ${top}`,
      `C${x2 - k + c} ${top} ${x2} ${top + k - c} ${x2} ${top + k}`,
      `L${x2} ${y2 - k}`,
      `C${x2} ${y2 - k + c} ${x2 - k + c} ${y2} ${x2 - k} ${y2}`,
      `L${x + k} ${y2}`,
      `C${x + k - c} ${y2} ${x} ${y2 - k + c} ${x} ${y2 - k}`,
      `L${x} ${top + k}`,
      `C${x} ${top + k - c} ${x + k - c} ${top} ${x + k} ${top}`,
      "Z"
    ].join(" ");
  }

  function roundedRect(page, x, top, w, h, r, { fill, fillOpacity = 1, border, borderWidth = 0.6, borderOpacity = 1 } = {}) {
    page.drawSvgPath(roundedPath(x, top, w, h, r), {
      x: 0,
      y: H,
      ...(fill ? { color: color(fill), opacity: fillOpacity } : {}),
      ...(border ? { borderColor: color(border), borderWidth, borderOpacity } : {})
    });
  }

  /** Cartão: sombra suave em camadas vetoriais + fundo + borda finíssima. */
  function card(page, x, top, w, h, r, { fill, border, shadowColor, borderWidth = 0.6 }) {
    const { layers, spread, offsetY, peakOpacity } = shadowTokens;
    for (let i = layers; i >= 1; i -= 1) {
      const grow = (spread * i) / layers;
      // camadas empilhadas: a borda externa recebe 1 camada, perto do cartão somam todas (= pico)
      const opacity = peakOpacity / layers;
      roundedRect(page, x - grow, top - grow + offsetY, w + grow * 2, h + grow * 2, r + grow, { fill: shadowColor, fillOpacity: opacity });
    }
    roundedRect(page, x, top, w, h, r, { fill, border, borderWidth });
  }

  /** Ícone outline em grade 24×24 escalado para `size` pt, traço `stroke` (em pt finais). */
  function icon(page, name, x, top, size, colorHex, stroke = 1.25) {
    const scale = size / 24;
    for (const d of ICONS[name] || ICONS.check) {
      page.drawSvgPath(d, {
        x,
        y: H - top,
        scale,
        borderColor: color(colorHex),
        borderWidth: stroke / scale,
        borderLineCap: 1,
        borderLineJoin: 1
      });
    }
  }

  /** Texto com espaçamento entre letras (continua sendo texto selecionável). */
  function spacedText(page, value, x, y, { size, font, colorHex, spacing = 0, opacity = 1 }) {
    if (spacing) page.pushOperators(setCharacterSpacing(spacing));
    page.drawText(value, { x, y, size, font, color: color(colorHex), ...(opacity < 1 ? { opacity } : {}) });
    if (spacing) page.pushOperators(setCharacterSpacing(0));
  }

  /** Link clicável real (annotation /Link com ação /URI). */
  function link(page, x, top, w, h, url) {
    const annot = pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, H - top - h, x + w, H - top],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) }
    });
    page.node.addAnnot(pdf.context.register(annot));
  }

  const smooth = (v) => {
    const t = Math.min(1, Math.max(0, v));
    return t * t * (3 - 2 * t);
  };

  /** Máscara de luminosidade em degradê (vetor, curva smoothstep em trechos): 0 = some, 1 = aparece. */
  function gradientMask(coords, bbox) {
    const steps = 12;
    const functions = [];
    for (let i = 0; i < steps; i += 1) {
      functions.push({ FunctionType: 2, Domain: [0, 1], C0: [smooth(i / steps)], C1: [smooth((i + 1) / steps)], N: 1 });
    }
    const shading = pdf.context.register(
      pdf.context.obj({
        ShadingType: 2,
        ColorSpace: "DeviceGray",
        Coords: coords,
        Extend: [true, true],
        Function: { FunctionType: 3, Domain: [0, 1], Functions: functions, Bounds: Array.from({ length: steps - 1 }, (_, i) => (i + 1) / steps), Encode: functions.flatMap(() => [0, 1]) }
      })
    );
    const form = pdf.context.register(
      pdf.context.stream("/Sh0 sh", { Type: "XObject", Subtype: "Form", BBox: bbox, Group: { S: "Transparency", CS: "DeviceGray" }, Resources: { Shading: { Sh0: shading } } })
    );
    return form;
  }

  /** ExtGState com a máscara de luminosidade (e, se quiser, opacidade constante). */
  function maskState(form, extra = {}) {
    return pdf.context.register(pdf.context.obj({ Type: "ExtGState", SMask: { Type: "Mask", S: "Luminosity", G: form }, ...extra }));
  }

  /**
   * Foto "cover" dentro da caixa que se dissolve no fundo à esquerda e embaixo.
   *
   * Duas máscaras de luminosidade VETORIAIS (degradês, sem imagem de máscara) aninhadas: a foto (com
   * o véu azul) vive num grupo de transparência; o grupo recebe a máscara horizontal e o resultado é
   * desenhado com a máscara vertical — o resultado é o produto das duas, sem camadas empilhadas nem emendas, e some
   * na cor real do fundo (a página já está pintada embaixo).
   */
  function fadedPhoto(page, image, box) {
    const { fadeLeft, fadeBottom, tint, topScrim } = photoTokens;
    const bottom = H - box.top - box.h;
    const bbox = [box.x, bottom, box.x + box.w, bottom + box.h];
    const maskH = maskState(gradientMask([box.x, 0, box.x + box.w * fadeLeft, 0], bbox));
    const maskV = maskState(gradientMask([0, bottom, 0, bottom + box.h * fadeBottom], bbox));
    // véu extra no topo: azul-marinho forte onde ficam logo/data, some em direção ao meio da foto
    const scrimGs = maskState(gradientMask([0, bottom + box.h * (1 - topScrim.height), 0, bottom + box.h], bbox), { ca: topScrim.opacity, CA: topScrim.opacity });
    const scale = Math.max(box.w / image.width, box.h / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    const ix = box.x + (box.w - dw) / 2;
    const iy = bottom + (box.h - dh) / 2;
    const [tr, tg, tb] = rgbOf(tint.color);
    const tintGs = pdf.context.register(pdf.context.obj({ Type: "ExtGState", ca: tint.opacity, CA: tint.opacity }));
    const photoGroup = pdf.context.register(
      pdf.context.stream(
        [
          "q",
          `${box.x} ${bottom} ${box.w} ${box.h} re W n`,
          `q ${dw} 0 0 ${dh} ${ix} ${iy} cm /Im0 Do Q`,
          "q /GsT gs",
          `${tr} ${tg} ${tb} rg`,
          `${box.x} ${bottom} ${box.w} ${box.h} re f`,
          "Q",
          "q /GsS gs",
          `${tr} ${tg} ${tb} rg`,
          `${box.x} ${bottom} ${box.w} ${box.h} re f`,
          "Q",
          "Q"
        ].join("\n"),
        { Type: "XObject", Subtype: "Form", BBox: bbox, Group: { S: "Transparency", CS: "DeviceRGB" }, Resources: { ExtGState: { GsT: tintGs, GsS: scrimGs }, XObject: { Im0: image.ref } } }
      )
    );
    const group = pdf.context.register(
      pdf.context.stream("/GsH gs /Ph Do", { Type: "XObject", Subtype: "Form", BBox: bbox, Group: { S: "Transparency", CS: "DeviceRGB" }, Resources: { ExtGState: { GsH: maskH }, XObject: { Ph: photoGroup } } })
    );
    const gName = nextName("Fg");
    const gsV = nextName("GsV");
    page.node.setXObject(PDFName.of(gName), group);
    page.node.setExtGState(PDFName.of(gsV), maskV);
    page.pushOperators(pushGraphicsState(), PDFOperator.of("gs", [PDFName.of(gsV)]), PDFOperator.of("Do", [PDFName.of(gName)]), popGraphicsState());
  }


  // ---- Marca d'água monocromática a partir do símbolo OFICIAL ---------------------------
  /** Plano alfa (8 bits) de um PNG RGBA 8-bit sem entrelaçamento; `null` se o formato for outro. */
  function pngAlpha(bytes) {
    const b = Buffer.from(bytes);
    if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) return null;
    let pos = 8;
    let width = 0;
    let height = 0;
    let ok = false;
    const idat = [];
    while (pos + 8 <= b.length) {
      const len = b.readUInt32BE(pos);
      const type = b.toString("latin1", pos + 4, pos + 8);
      const data = b.subarray(pos + 8, pos + 8 + len);
      if (type === "IHDR") {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        ok = data[8] === 8 && data[9] === 6 && data[12] === 0; // 8 bits, RGBA, sem entrelaçamento
      } else if (type === "IDAT") idat.push(data);
      else if (type === "IEND") break;
      pos += 12 + len;
    }
    if (!ok || !width || !height) return null;
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * 4;
    const alpha = new Uint8Array(width * height);
    let prev = Buffer.alloc(stride);
    for (let row = 0; row < height; row += 1) {
      const filter = raw[row * (stride + 1)];
      const line = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)));
      for (let i = 0; i < stride; i += 1) {
        const left = i >= 4 ? line[i - 4] : 0;
        const up = prev[i];
        const upLeft = i >= 4 ? prev[i - 4] : 0;
        let add = 0;
        if (filter === 1) add = left;
        else if (filter === 2) add = up;
        else if (filter === 3) add = (left + up) >> 1;
        else if (filter === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        line[i] = (line[i] + add) & 255;
      }
      for (let x = 0; x < width; x += 1) alpha[row * width + x] = line[x * 4 + 3];
      prev = line;
    }
    // marca d'água não precisa de 1000 px: reduz por média de blocos (arquivo bem menor)
    const f = Math.max(1, Math.floor(width / 400));
    if (f === 1) return { width, height, alpha };
    const w2 = Math.floor(width / f);
    const h2 = Math.floor(height / f);
    const small = new Uint8Array(w2 * h2);
    for (let y2 = 0; y2 < h2; y2 += 1) {
      for (let x2 = 0; x2 < w2; x2 += 1) {
        let sum = 0;
        for (let dy = 0; dy < f; dy += 1) for (let dx = 0; dx < f; dx += 1) sum += alpha[(y2 * f + dy) * width + x2 * f + dx];
        small[y2 * w2 + x2] = Math.round(sum / (f * f));
      }
    }
    return { width: w2, height: h2, alpha: small };
  }

  /**
   * Desenha o símbolo oficial em UMA cor (silhueta do PNG, mantendo o contorno e a transparência),
   * com opacidade baixa: o símbolo tem uma parte quase branca que sumiria sobre o fundo claro, então a
   * marca d'água usa a silhueta inteira para continuar reconhecível. Devolve false se o PNG não servir.
   */
  const tintedCache = new Map(); // mesma silhueta/cor = um único objeto no arquivo (todas as páginas reaproveitam)
  function tintedSymbol(page, pngBytes, box, colorHex, opacity) {
    const key = `${pngBytes.length}|${colorHex}`;
    let image = tintedCache.get(key);
    if (image === undefined) {
      image = tintedImage(pngBytes, colorHex);
      tintedCache.set(key, image);
    }
    if (!image) return false;
    const name = nextName("Wm");
    const gs = nextName("GsW");
    page.node.setXObject(PDFName.of(name), image);
    page.node.setExtGState(PDFName.of(gs), pdf.context.register(pdf.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity })));
    page.pushOperators(
      pushGraphicsState(),
      PDFOperator.of("gs", [PDFName.of(gs)]),
      PDFOperator.of("cm", [PDFNumber.of(box.w), PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(box.h), PDFNumber.of(box.x), PDFNumber.of(H - box.top - box.h)]),
      PDFOperator.of("Do", [PDFName.of(name)]),
      popGraphicsState()
    );
    return true;
  }

  function tintedImage(pngBytes, colorHex) {
    const plane = pngAlpha(pngBytes);
    if (!plane) return null;
    const [r, g, b] = rgbOf(colorHex);
    const rgb = Buffer.alloc(plane.width * plane.height * 3);
    for (let i = 0; i < plane.width * plane.height; i += 1) {
      rgb[i * 3] = Math.round(r * 255);
      rgb[i * 3 + 1] = Math.round(g * 255);
      rgb[i * 3 + 2] = Math.round(b * 255);
    }
    const mask = pdf.context.register(
      pdf.context.stream(deflateSync(Buffer.from(plane.alpha)), { Type: "XObject", Subtype: "Image", Width: plane.width, Height: plane.height, ColorSpace: "DeviceGray", BitsPerComponent: 8, Filter: "FlateDecode" })
    );
    const image = pdf.context.register(
      pdf.context.stream(deflateSync(rgb), { Type: "XObject", Subtype: "Image", Width: plane.width, Height: plane.height, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "FlateDecode", SMask: mask })
    );
    return image;
  }

  return { color, verticalGradient, roundedRect, card, icon, spacedText, link, fadedPhoto, tintedSymbol };
}
