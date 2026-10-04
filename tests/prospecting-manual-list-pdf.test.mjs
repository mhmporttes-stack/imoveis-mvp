// PDF da "Lista de Prospecção" (2026-10-04): 1 página A4, linhas legíveis, acentos, nomes longos, caracteres
// fora do WinAnsi sem quebrar, e a MESMA lista gera sempre os MESMOS bytes. Dados 100% fictícios.
import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { gerarListaProspeccaoPdf } from "../lib/prospecting-manual-list-pdf.mjs";

const NAMES = [
  "Ana Paula de Souza", "José Antônio Ferreira Nogueira Albuquerque Cavalcanti de Medeiros e Silva Júnior", "Lu",
  "Conceição Aparecida dos Santos", "Müller Oliveira", "João Pedro", "Maria Eduarda Lima", "Vinícius Gonçalves",
  "Ângela Ribeiro", "Érica Tavares", "Zélia Machado", "Thiago Álvares", "Patrícia Oliveira Martins", "Raimundo Nonato",
  "Sônia Maria da Silva Pereira", "Ítalo Campos", "Úrsula Wagner", "Bruno 😀 Henrique", "Célia Regina", "Fábio Júnior",
  "Luíza Fernandes", "Ćiro Petrović", "Débora Cristina", "Edvaldo Rocha", "Fernanda Albuquerque", "Gabriela Nunes",
  "Hélio Barbosa", "Isabela Cardoso", "Jéssica Moraes", "Kátia Brandão"
];
const items = NAMES.map((name, i) => ({ position: i + 1, name, phone: i % 7 === 3 ? "+551433334444" : `+55149${String(90000000 + i * 1234).padStart(8, "0")}` }));
const input = { numero: 12, brokerName: "Jennyfer Cristina da Silva", createdAt: "2026-10-04T15:30:00Z", items };

async function extractText(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return { pages: doc.numPages, text: content.items.map((i) => i.str).join("\n") };
}

test("1 página A4 com cabeçalho, 30 linhas numeradas 01–30, telefones formatados e rodapé", async () => {
  const { bytes, pageCount } = await gerarListaProspeccaoPdf(input);
  assert.equal(pageCount, 1);
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getPageCount(), 1);
  const { width, height } = parsed.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.01 && Math.abs(height - 841.89) < 0.01);

  const out = await extractText(bytes);
  assert.equal(out.pages, 1);
  for (const expected of ["LISTA DE PROSPECÇÃO", "Associado:", "Jennyfer Cristina da Silva", "04/10/2026", "30 contatos para prospecção", "Lista nº 12", "Matheus Machado", "Imóveis"]) {
    assert.ok(out.text.includes(expected), `falta no PDF: ${expected}`);
  }
  for (let n = 1; n <= 30; n += 1) assert.ok(out.text.includes(`${String(n).padStart(2, "0")}.`), `falta a linha ${n}`);
  assert.ok(out.text.includes("(14) 99000-0000"));
  assert.ok(out.text.includes("(14) 3333-4444"), "telefone de 8 dígitos formatado");
  for (const name of ["Ana Paula de Souza", "Conceição Aparecida dos Santos", "Ângela Ribeiro", "Kátia Brandão", "Müller Oliveira"]) assert.ok(out.text.includes(name), `nome com acento: ${name}`);
});

test("nome muito longo é truncado com reticências (sem quebrar a linha); emoji e letra fora do WinAnsi não quebram", async () => {
  const { bytes, lines } = await gerarListaProspeccaoPdf(input);
  const long = lines.find((line) => line.startsWith("José Antônio Ferreira"));
  assert.ok(long.endsWith("…"));
  assert.ok(long.length < NAMES[1].length);
  assert.ok(lines.includes("Bruno Henrique"));
  assert.ok(lines.includes("Ciro Petrovic"));
  assert.ok(bytes.length > 1000);
});

test("com menos de 30 contatos o PDF diz o número real e desenha só essas linhas", async () => {
  const { bytes, lines } = await gerarListaProspeccaoPdf({ ...input, items: items.slice(0, 7) });
  const out = await extractText(bytes);
  assert.ok(out.text.includes("7 contatos para prospecção"));
  assert.ok(!out.text.includes("30 contatos"));
  assert.ok(out.text.includes("07.") && !out.text.includes("08."));
  assert.equal(lines.filter((l) => /^\d\d\.$/.test(l)).length, 7);
  const one = await gerarListaProspeccaoPdf({ ...input, items: items.slice(0, 1) });
  assert.ok(one.lines.includes("1 contato para prospecção"));
});

test("reimpressão: a mesma lista gera os MESMOS bytes (data de geração original, nada de 'agora')", async () => {
  const first = await gerarListaProspeccaoPdf(input);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = await gerarListaProspeccaoPdf({ ...input, items: items.map((item) => ({ ...item })) });
  assert.ok(Buffer.from(first.bytes).equals(Buffer.from(second.bytes)));
  assert.ok(first.lines.includes("04/10/2026"));
});

test("lista vazia, nome do associado ausente e mais de 30 itens não quebram (corta em 30)", async () => {
  const empty = await gerarListaProspeccaoPdf({ ...input, items: [], brokerName: "" });
  assert.equal(empty.pageCount, 1);
  const many = await gerarListaProspeccaoPdf({ ...input, items: [...items, ...items] });
  assert.equal(many.lines.filter((l) => /^\d\d\.$/.test(l)).length, 30);
});
