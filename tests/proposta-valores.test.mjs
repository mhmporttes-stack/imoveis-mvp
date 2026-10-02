import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { simularEntrada } from "../lib/simulacao-entrada/calculator.ts";
import { CASA_PAULISTA_VALOR, valorCasaPaulista } from "../lib/simulacao-entrada/casa-paulista.mjs";
import {
  aplicarParcelasManuais,
  buildPresentationModel,
  montarClienteEntrada
} from "../lib/simulacao-entrada/presentation-model.mjs";
import { formatBRL, gerarPropostaValoresPdf, sanitizeFileName } from "../lib/simulacao-entrada/proposta-pdf.mjs";

// Fixtures fictícias (nenhum dado real).
function regras(overrides = {}) {
  return {
    id: "emp-teste",
    nome: "Residencial Teste",
    valorImovel: 200000,
    descontos: [],
    beneficiosInformativos: [],
    aceitaCasaPaulista: true,
    regraEntrada: {
      tipo: "ato_mais_parcelas",
      limiteParcelavel: 60000,
      limites: { numeroMaximoParcelas: 36, parcelaMaxima: { tipo: "valor_fixo", valor: 2000 } },
      numeroParcelasQuandoExcedeLimite: 60
    },
    ...overrides
  };
}
const cliente = montarClienteEntrada({ rendaTotal: 4000, financiamentoAprovado: 150000, subsidioMcmv: 20000 });

function modelo(r, c = cliente, extra = {}) {
  const resultado = simularEntrada(c, r, extra.ajustes || {});
  return { resultado, model: buildPresentationModel(resultado, extra) };
}

test("Casa Paulista: constante única e valor fixo por empreendimento", () => {
  assert.equal(CASA_PAULISTA_VALOR, 10000);
  assert.equal(valorCasaPaulista(true), 10000);
  assert.equal(valorCasaPaulista(false), 0);
});

test("empreendimento que aceita: R$ 10.000 e abate a entrada (200k/150k/20k/10k = 20k)", () => {
  const { resultado } = modelo(regras());
  assert.equal(resultado.casaPaulista, 10000);
  assert.equal(resultado.totalCoberto, 180000);
  assert.equal(resultado.entradaTotal, 20000);
});

test("empreendimento que não aceita: Casa Paulista = 0 e resultado inalterado (entrada 30k)", () => {
  const { resultado } = modelo(regras({ aceitaCasaPaulista: false }));
  assert.equal(resultado.casaPaulista, 0);
  assert.equal(resultado.entradaTotal, 30000);
});

test("valor enviado pelo cliente é ignorado (sem campo editável)", () => {
  const { resultado } = modelo(regras(), { ...cliente, casaPaulista: 99999 });
  assert.equal(resultado.casaPaulista, 10000);
  assert.equal("casaPaulista" in montarClienteEntrada({ casaPaulista: 5 }), false);
});

test("gerador e apresentação usam a mesma montagem de cliente (snapshots consistentes)", () => {
  const a = simularEntrada(montarClienteEntrada({ rendaTotal: 4000, financiamentoAprovado: 150000, subsidioMcmv: 20000 }), regras());
  const b = simularEntrada(cliente, regras());
  assert.deepEqual(a, b);
  assert.equal(a.casaPaulista, 10000);
});

test("modelo: entrada, ato inicial, saldo parcelado e parcelamento", () => {
  const { resultado, model } = modelo(regras());
  assert.equal(model.valorImovel, 200000);
  assert.equal(model.casaPaulista, 10000);
  assert.equal(model.subsidioMcmv, 20000);
  assert.equal(model.entradaTotal, 20000);
  assert.equal(model.atoInicial, 0);
  assert.equal(model.entradaTotalmenteParcelada, true);
  assert.ok(Math.abs(model.saldoParcelado - 20000) < 0.01);
  assert.equal(model.parcelamento.parcelas, resultado.detalhePagamento.blocos[0].parcelas);
  assert.equal(model.totalDescontosEBeneficios, 30000);
});

test("modelo: ato desejado > 0 não é 100% parcelado", () => {
  const { model } = modelo(regras(), cliente, { ajustes: { atoDesejado: 5000 } });
  assert.equal(model.atoInicial, 5000);
  assert.equal(model.entradaTotalmenteParcelada, false);
});

test("modelo: benefícios condicionais e documentação gratuita (comportamento preservado: 5%)", () => {
  const vazio = modelo(regras({ aceitaCasaPaulista: false }), montarClienteEntrada({ financiamentoAprovado: 190000 })).model;
  assert.equal(vazio.temDescontosOuBeneficios, false);
  assert.equal(vazio.documentacaoGratuita.aplica, false);
  const comDoc = modelo(regras({ beneficiosInformativos: [{ tipo: "documentacao_gratuita", label: "Documentação gratuita", valor: 11500 }] })).model;
  assert.equal(comDoc.documentacaoGratuita.aplica, true);
  assert.equal(comDoc.documentacaoGratuita.valor, 10000);
  assert.equal(comDoc.beneficios.length, 0);
  const viaFeature = modelo(regras(), cliente, { propertyFeatures: [{ text: "Documentação grátis" }, "Piscina"] }).model;
  assert.equal(viaFeature.documentacaoGratuita.aplica, true);
  assert.deepEqual(viaFeature.diferenciais, ["Documentação grátis", "Piscina"]);
});

test("aplicarParcelasManuais não muta as regras originais", () => {
  const r = regras();
  const novo = aplicarParcelasManuais(r, 12);
  assert.equal(novo.regraEntrada.limites.numeroParcelasPreferido, 12);
  assert.equal(r.regraEntrada.limites.numeroParcelasPreferido, undefined);
});

// ---- PDF -------------------------------------------------------------------

const logoPath = new URL("../public/assets/matheus-machado-symbol.png", import.meta.url);
const logoBytes = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

async function extractText(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" ").replace(/\s+/g, " "));
  }
  return { pages, all: pages.join(" "), numPages: doc.numPages };
}

function assertInsideA4(out) {
  const { width, height, margin, bottom } = out.page;
  assert.ok(Math.abs(width - 595.28) < 0.01 && Math.abs(height - 841.89) < 0.01);
  for (const box of out.boxes) {
    if (box.kind === "band") continue;
    assert.ok(box.x >= margin - 0.6 || box.kind === "band", `x à esquerda da margem: ${JSON.stringify(box)}`);
    assert.ok(box.x + box.w <= width - margin + 0.6, `x além da margem direita: ${JSON.stringify(box)}`);
    assert.ok(box.y >= 0, `acima da página: ${JSON.stringify(box)}`);
    if (box.kind === "band") continue; // faixa do cabeçalho (sangra a página de propósito)
    if (box.kind !== "logo" && box.y < 90) continue; // cabeçalho
    if (!(box.kind === "text" && box.y > bottom)) {
      assert.ok(box.y + box.h <= bottom + 0.6, `invade o rodapé: ${JSON.stringify(box)}`);
    }
  }
}

const base = {
  clienteNome: "João Antônio da Conceição Ñandú Souza",
  dataTexto: "02/10/2026",
  empreendimento: { nome: "Residencial Teste", construtora: "Construtora Exemplo", localizacao: "Rua das Flores, 100 - Marília/SP" },
  logoBytes
};

test("PDF real: valores desenhados = valores do modelo (tela e PDF, mesma fonte)", async () => {
  const { model } = modelo(regras({ beneficiosInformativos: [{ tipo: "documentacao_gratuita", label: "Documentação gratuita", valor: 11500 }] }),
    cliente, { financingInstallments: { first: 650.5, last: 710.25 }, propertyFeatures: ["Entrada parcelada", "Isenção de IPTU"] });
  const out = await gerarPropostaValoresPdf({ ...base, model });
  assert.equal(Buffer.from(out.bytes).subarray(0, 5).toString(), "%PDF-");
  const { all } = await extractText(out.bytes);
  const esperado = [
    model.valorImovel, model.financiamentoAprovado, model.subsidioMcmv, model.casaPaulista,
    model.documentacaoGratuita.valor, model.totalDescontosEBeneficios, model.entradaTotal, model.atoInicial,
    model.saldoParcelado, model.parcelamento.valorParcela, model.primeiraParcelaFinanciamento, model.ultimaParcelaFinanciamento
  ].map(formatBRL);
  for (const valor of esperado) assert.ok(all.includes(valor), `valor ausente no PDF: ${valor}`);
  assert.ok(all.includes("Casa Paulista"));
  assert.ok(all.includes(formatBRL(10000)));
  assert.ok(all.includes("R$ 0,00"), "ato inicial R$ 0,00 em destaque");
  assert.ok(all.includes("Entrada 100% parcelada, sem pagamento inicial"));
  assert.ok(all.includes(`${model.parcelamento.parcelas}x de ${formatBRL(model.parcelamento.valorParcela)}`));
  assert.ok(all.includes("João Antônio da Conceição Ñandú Souza"));
  assert.ok(all.includes("02/10/2026"));
  assert.ok(all.includes("Isenção de IPTU"));
  assert.equal(out.texts.some((t) => t.text === formatBRL(model.entradaTotal)), true);
  assertInsideA4(out);
});

test("PDF: benefícios só quando se aplicam (sem Casa Paulista/descontos/benefícios)", async () => {
  const { model } = modelo(regras({ aceitaCasaPaulista: false }), montarClienteEntrada({ financiamentoAprovado: 150000, subsidioMcmv: 20000 }));
  const out = await gerarPropostaValoresPdf({ ...base, model });
  const { all } = await extractText(out.bytes);
  assert.equal(all.includes("Casa Paulista"), false);
  assert.equal(all.includes("Documentação gratuita"), false);
  assert.equal(all.includes("Benefícios do empreendimento"), false);
  assert.ok(all.includes("Subsídio Minha Casa Minha Vida"));
  assertInsideA4(out);
});

test("PDF: entrada de R$ 11.000 100% parcelada destaca ato inicial R$ 0,00", async () => {
  const { model } = modelo(regras({ valorImovel: 190000 }), montarClienteEntrada({ rendaTotal: 4000, financiamentoAprovado: 169000, subsidioMcmv: 0 }));
  assert.equal(model.entradaTotal, 11000);
  assert.equal(model.atoInicial, 0);
  const out = await gerarPropostaValoresPdf({ ...base, model });
  const { all } = await extractText(out.bytes);
  assert.ok(all.includes("R$ 11.000,00") && all.includes("R$ 0,00") && all.includes("ATO INICIAL"));
  const ato = out.boxes.find((b) => b.kind === "text" && out.texts.some((t) => t.text === "R$ 0,00"));
  assert.ok(ato);
});

test("PDF: nomes longos, acentos e muitos benefícios quebram linha/página sem cortes", async () => {
  const longo = "Maria Aparecida de Nazaré Conceição dos Santos Albuquerque Figueiredo Vasconcelos Pereira de Oliveira Júnior";
  const emp = "Residencial Parque das Águas Cristalinas e Jardins Suspensos do Alto da Boa Vista Etapa Três Ampliação";
  const feats = Array.from({ length: 40 }, (_, i) => `Diferencial exclusivo número ${i + 1} do empreendimento com texto relativamente longo`);
  const { model } = modelo(regras({
    descontos: [{ tipo: "desconto", label: "Desconto promocional de lançamento válido somente para a primeira etapa de vendas", valor: 5000 }]
  }), cliente, { propertyFeatures: feats });
  const out = await gerarPropostaValoresPdf({
    ...base, clienteNome: longo + " " + "X".repeat(60), model,
    empreendimento: { nome: emp, construtora: "Construtora Exemplo de Incorporações e Empreendimentos Imobiliários Ltda", localizacao: "Avenida Brigadeiro Faria Lima, 1000 - Bairro Jardim Paulista - São Paulo/SP - 01452-000" }
  });
  assert.ok(out.pageCount >= 2, "quebra de página");
  assertInsideA4(out);
  const { numPages } = await extractText(out.bytes);
  assert.equal(numPages, out.pageCount);
});

test("PDF: arquivo leve e nome do arquivo sanitizado", async () => {
  const { model } = modelo(regras());
  const out = await gerarPropostaValoresPdf({ ...base, model });
  assert.ok(out.bytes.length < 300 * 1024, `PDF pesado: ${out.bytes.length}`);
  assert.equal(sanitizeFileName("João Antônio / Ñandú: Exemplo"), "joao-antonio-nandu-exemplo");
});

// ---- Regressões estáticas --------------------------------------------------

test("componentes não duplicam o valor/zero do Casa Paulista e o PDF antigo segue disponível", () => {
  const pres = fs.readFileSync(new URL("../components/EmpreendimentoPresentation.jsx", import.meta.url), "utf8");
  const gen = fs.readFileSync(new URL("../components/SimulationGenerator.jsx", import.meta.url), "utf8");
  assert.equal(/casaPaulista\s*:\s*\d/.test(pres), false);
  assert.equal(/casaPaulista\s*:\s*\d/.test(gen), false);
  assert.equal(/10000/.test(pres), false);
  assert.ok(gen.includes("createSimulationPdfUrl") && gen.includes("buildPdfFromJpegs") && gen.includes("Baixar PDF"));
  assert.ok(pres.includes("buildPresentationModel"));
});

// ---- Logo oficial (asset único) -----------------------------------------------

const LOGO_ASSET = "public/assets/matheus-machado-symbol.png";

test("logo: gerador não embute logo própria; a rota usa o asset oficial único (o mesmo do PDF de documentos)", () => {
  const gen = fs.readFileSync(new URL("../lib/simulacao-entrada/proposta-pdf.mjs", import.meta.url), "utf8");
  assert.equal(/iVBOR|base64|readFile|matheus-machado/i.test(gen), false, "gerador não pode ter logo/asset embutido");
  const route = fs.readFileSync(new URL("../app/api/simulations/[id]/proposta-valores/route.js", import.meta.url), "utf8");
  assert.ok(route.includes("matheus-machado-symbol.png"));
  assert.equal(/matheus-machado-logo|logo-transparent|logo-premium/.test(route), false, "sem referência a logos antigas");
  const docs = fs.readFileSync(new URL("../lib/client-document-pdf.js", import.meta.url), "utf8");
  assert.ok(docs.includes("matheus-machado-symbol.png"), "mesmo asset do PDF oficial de documentos");
});

test("logo: PDF traz a imagem com a razão de aspecto do asset, dentro da faixa navy e das margens", async () => {
  const png = fs.readFileSync(new URL(`../${LOGO_ASSET}`, import.meta.url));
  const assetRatio = png.readUInt32BE(16) / png.readUInt32BE(20);
  const { model } = modelo(regras());
  const out = await gerarPropostaValoresPdf({ ...base, logoBytes: png, model });
  assert.ok(Buffer.from(out.bytes).includes(Buffer.from("/Subtype /Image")), "imagem embutida no PDF");
  const logo = out.boxes.find((b) => b.kind === "logo" && b.page === 0);
  const band = out.boxes.find((b) => b.kind === "band" && b.page === 0);
  assert.ok(logo && band);
  assert.ok(Math.abs(logo.w / logo.h - assetRatio) < 0.001, "proporção preservada");
  assert.ok(logo.x >= out.page.margin - 0.01 && logo.y >= band.y && logo.y + logo.h <= band.y + band.h, "logo dentro da faixa");
  // texto do cabeçalho em tons claros sobre a faixa escura
  const { all } = await extractText(out.bytes);
  assert.ok(all.includes("MATHEUS MACHADO") && all.includes("CORRETOR DE IMÓVEIS"));
  const logos = out.boxes.filter((b) => b.kind === "logo");
  assert.equal(logos.length, out.pageCount, "logo repetida em todas as páginas, sempre na faixa");
});

// ---- Direção visual v2 (página 1 conta a proposta; página 2 mostra de onde vem cada valor) -----

test("PDF v2: na página 1 o ATO INICIAL é o maior texto e os números essenciais estão todos nela", async () => {
  const { model } = modelo(regras({ beneficiosInformativos: [{ tipo: "documentacao_gratuita", label: "Documentação gratuita", valor: 11500 }] }),
    cliente, { financingInstallments: { first: 650.5, last: 710.25 }, propertyFeatures: ["Entrada parcelada", "Isenção de IPTU"] });
  const out = await gerarPropostaValoresPdf({ ...base, model });
  const p1 = out.texts.filter((t) => t.page === 0);
  const maior = p1.reduce((a, b) => (b.size > a.size ? b : a));
  assert.equal(maior.text, formatBRL(model.atoInicial), "o maior texto da capa é o ato inicial");
  const capa = p1.map((t) => t.text).join(" ");
  for (const valor of [model.valorImovel, model.financiamentoAprovado, model.entradaTotal, model.totalDescontosEBeneficios, model.primeiraParcelaFinanciamento, model.ultimaParcelaFinanciamento].map(formatBRL)) {
    assert.ok(capa.includes(valor), `capa sem ${valor}`);
  }
  assert.ok(capa.includes(`${model.parcelamento.parcelas}x de ${formatBRL(model.parcelamento.valorParcela)}`));
  assert.ok(capa.includes("PRÓXIMO PASSO"));
  assert.ok(out.pageCount >= 2);
});

test("PDF v2: ato inicial maior que zero aparece como destaque, com entrada total e mensalidade na capa", async () => {
  const { model } = modelo(regras(), cliente, { ajustes: { atoDesejado: 5000 } });
  const out = await gerarPropostaValoresPdf({ ...base, model });
  const p1 = out.texts.filter((t) => t.page === 0);
  const maior = p1.reduce((a, b) => (b.size > a.size ? b : a));
  assert.equal(maior.text, formatBRL(5000));
  const capa = p1.map((t) => t.text).join(" ");
  assert.ok(capa.includes("ENTRADA TOTAL") && capa.includes(formatBRL(model.entradaTotal)));
  assert.ok(capa.includes(`${model.parcelamento.parcelas}x de ${formatBRL(model.parcelamento.valorParcela)}`));
  assert.equal(capa.includes("Entrada 100% parcelada"), false);
});

test("PDF v2: a capa ancora o preço (imóvel, financiamento e entrada) logo abaixo do ato inicial", async () => {
  const { model } = modelo(regras());
  const out = await gerarPropostaValoresPdf({ ...base, model });
  const capa = out.texts.filter((t) => t.page === 0);
  const idx = (texto) => capa.findIndex((t) => t.text === texto);
  const ato = idx(formatBRL(model.atoInicial));
  for (const [rotulo, valor] of [["VALOR DO IMÓVEL", model.valorImovel], ["FINANCIAMENTO APROVADO", model.financiamentoAprovado], ["ENTRADA TOTAL", model.entradaTotal]]) {
    assert.ok(idx(rotulo) > ato, `${rotulo} depois do ato inicial`);
    assert.ok(idx(formatBRL(valor)) > ato, `${formatBRL(valor)} depois do ato inicial`);
  }
});

test("PDF v2: documentação gratuita aparece como benefício adicional, sem misturar com os abatimentos", async () => {
  const { model } = modelo(regras({ beneficiosInformativos: [{ tipo: "documentacao_gratuita", label: "Documentação gratuita", valor: 11500 }] }));
  const out = await gerarPropostaValoresPdf({ ...base, model });
  const { pages } = await extractText(out.bytes);
  assert.ok(pages[1].includes("Documentação gratuita (benefício adicional)"));
  assert.ok(pages[1].indexOf("Casa Paulista") < pages[1].indexOf("Documentação gratuita"), "abatimentos antes do benefício adicional");
  assert.ok(pages[1].includes(formatBRL(model.totalDescontosEBeneficios)), "total do modelo exibido sem recalcular");
});

test("PDF v2: proposta enxuta (sem benefícios nem vantagens) ancora o próximo passo no pé da capa, sem buraco", async () => {
  const { model } = modelo(regras({ aceitaCasaPaulista: false }), montarClienteEntrada({ rendaTotal: 4000, financiamentoAprovado: 150000, subsidioMcmv: 0 }));
  const out = await gerarPropostaValoresPdf({ ...base, model });
  const cta = out.boxes.find((b) => b.page === 0 && b.kind === "text" && out.texts.some((t) => t.page === 0 && t.text === "PRÓXIMO PASSO"));
  const passo = out.texts.findIndex((t) => t.page === 0 && t.text === "PRÓXIMO PASSO");
  assert.ok(passo >= 0 && cta);
  const faixa = out.boxes.filter((b) => b.page === 0 && b.kind === "rect" && b.w > 400 && b.h >= 48 && b.h <= 66).at(-1);
  assert.ok(faixa && faixa.y > 600, "faixa do próximo passo no terço final da página");
  const { all } = await extractText(out.bytes);
  assert.equal(all.includes("VANTAGENS DO EMPREENDIMENTO"), false);
  assert.equal(all.includes("Benefícios do empreendimento"), false);
});

test("PDF v2: descrição longa de desconto não é cortada nos detalhes", async () => {
  const longo = "Desconto promocional de lançamento válido somente para a primeira etapa de vendas";
  const { model } = modelo(regras({ descontos: [{ tipo: "desconto", label: longo, valor: 5000 }] }));
  const out = await gerarPropostaValoresPdf({ ...base, model });
  const { pages } = await extractText(out.bytes);
  assert.ok(pages[1].includes(longo), "texto completo na página de detalhes");
  assertInsideA4(out);
});

test("PDF v2: cada página tem faixa e logo; benefícios longos continuam em páginas seguintes", async () => {
  const feats = Array.from({ length: 30 }, (_, i) => `Vantagem ${i + 1} do empreendimento`);
  const { model } = modelo(regras(), cliente, { propertyFeatures: feats });
  const out = await gerarPropostaValoresPdf({ ...base, model });
  assert.ok(out.pageCount >= 3);
  for (let i = 0; i < out.pageCount; i += 1) {
    assert.ok(out.boxes.some((b) => b.page === i && b.kind === "logo"), `logo na página ${i + 1}`);
    assert.ok(out.boxes.some((b) => b.page === i && b.kind === "band"), `faixa na página ${i + 1}`);
  }
  const { all } = await extractText(out.bytes);
  for (const f of feats) assert.ok(all.includes(f), `vantagem ausente: ${f}`);
  assertInsideA4(out);
});
