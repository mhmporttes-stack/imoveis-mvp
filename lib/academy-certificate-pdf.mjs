import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// PDF do certificado (F5): A4 paisagem, só dados do snapshot do certificado (nunca da trilha atual). Fontes padrão do PDF
// (WinAnsi cobre português); caracteres fora dela são trocados por "?" para o PDF nunca falhar.
const NAVY = rgb(0.012, 0.114, 0.227);
const BLUE = rgb(0.212, 0.451, 0.761);
const GRAY = rgb(0.235, 0.306, 0.4);

const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" }); } catch { return ""; } };
const safe = (font, text) => {
  let out = "";
  for (const ch of String(text ?? "")) { try { font.encodeText(ch); out += ch; } catch { out += "?"; } }
  return out;
};

export async function buildCertificatePdf(cert) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificado ${cert.code}`);
  doc.setAuthor("Matheus Machado Imóveis");
  doc.setSubject("Certificado de conclusão — Academia Matheus Machado");
  const page = doc.addPage([842, 595]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifB = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansB = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const center = (text, y, font, size, color = NAVY) => {
    const t = safe(font, text);
    page.drawText(t, { x: (width - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
  };

  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: NAVY, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: BLUE, borderWidth: 1 });
  try {
    const logo = await doc.embedPng(await readFile(path.join(process.cwd(), "public", "icons", "icon-192-mm.png")));
    page.drawImage(logo, { x: width / 2 - 28, y: height - 112, width: 56, height: 56 });
  } catch { /* sem logo: segue sem imagem */ }

  center("ACADEMIA MATHEUS MACHADO", height - 140, sansB, 13, BLUE);
  center("Certificado de conclusão", height - 190, serif, 38);
  center("Certificamos que", height - 240, sans, 14, GRAY);
  const holder = safe(serifB, cert.holderName || "Aluno");
  const holderSize = serifB.widthOfTextAtSize(holder, 40) > width - 140 ? 28 : 40;
  center(holder, height - 292, serifB, holderSize);
  page.drawLine({ start: { x: 180, y: height - 304 }, end: { x: width - 180, y: height - 304 }, thickness: 1, color: BLUE });
  center(`concluiu a ${cert.trackTitle || "formação"} da Academia Matheus Machado`, height - 336, serif, 18);
  const parts = [];
  if (cert.lessonsTotal) parts.push(`${cert.lessonsTotal} aulas`);
  if (cert.finalScore != null) parts.push(`nota da prova final: ${String(cert.finalScore).replace(".", ",")}%`);
  if (cert.completedAt) parts.push(`concluída em ${fmtDate(cert.completedAt)}`);
  if (parts.length) center(parts.join("  ·  "), height - 364, sans, 13, GRAY);

  center(`Código do certificado: ${cert.code}`, 96, sansB, 13);
  center(`Emitido em ${fmtDate(cert.issuedAt)} · Matheus Machado Imóveis`, 76, sans, 10.5, GRAY);
  if (cert.revoked) {
    page.drawText("REVOGADO", { x: 250, y: 250, size: 96, font: sansB, color: rgb(0.64, 0.23, 0.17), rotate: { type: "degrees", angle: 22 }, opacity: 0.35 });
  }
  return Buffer.from(await doc.save());
}
