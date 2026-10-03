import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { simularEntrada } from "../lib/simulacao-entrada/calculator.ts";
import { CASA_PAULISTA_VALOR, valorCasaPaulista } from "../lib/simulacao-entrada/casa-paulista.mjs";
import {
  DOCUMENTACAO_GRATUITA_PERCENTUAL,
  aplicarParcelasManuais,
  buildPresentationModel,
  formatZona,
  montarClienteEntrada
} from "../lib/simulacao-entrada/presentation-model.mjs";
import { ICONS } from "../lib/simulacao-entrada/proposta-pdf-icons.mjs";
import { carregarImagemPrincipal, loadPhotoBytes, photoSource } from "../lib/simulacao-entrada/proposta-imagem.mjs";
import * as tokens from "../lib/simulacao-entrada/proposta-pdf-tokens.mjs";
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
  // Decoração de sangria (fundo, foto, marca d'água) ocupa a página inteira de propósito.
  const BLEED = new Set(["bg", "photo", "watermark"]);
  const FOOTER = new Set(["text", "icon", "link"]);
  for (const box of out.boxes) {
    if (BLEED.has(box.kind)) continue;
    assert.ok(box.x >= margin - 0.6, `x à esquerda da margem: ${JSON.stringify(box)}`);
    assert.ok(box.x + box.w <= width - margin + 0.6, `x além da margem direita: ${JSON.stringify(box)}`);
    assert.ok(box.y >= 0, `acima da página: ${JSON.stringify(box)}`);
    if (box.y < 90 && (box.kind === "text" || box.kind === "logo")) continue; // cabeçalho
    if (!(FOOTER.has(box.kind) && box.y > bottom)) {
      assert.ok(box.y + box.h <= bottom + 0.6, `invade o rodapé: ${JSON.stringify(box)}`);
    }
  }
}

const base = {
  clienteNome: "João Antônio da Conceição Ñandú Souza",
  dataTexto: "02/10/2026",
  empreendimento: { nome: "Residencial Teste", construtora: "Construtora Exemplo", zona: "Zona Norte", localizacao: "Rua das Flores, 100 - Marília/SP" },
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

test("logo: PDF traz o símbolo oficial CENTRALIZADO no cabeçalho, com a razão de aspecto do asset", async () => {
  const png = fs.readFileSync(new URL(`../${LOGO_ASSET}`, import.meta.url));
  const assetRatio = png.readUInt32BE(16) / png.readUInt32BE(20);
  const { model } = modelo(regras());
  const out = await gerarPropostaValoresPdf({ ...base, logoBytes: png, model });
  assert.ok(Buffer.from(out.bytes).includes(Buffer.from("/Subtype /Image")), "imagem embutida no PDF");
  const logo = out.boxes.find((b) => b.kind === "logo" && b.page === 0);
  assert.ok(logo);
  assert.ok(Math.abs(logo.w / logo.h - assetRatio) < 0.001, "proporção preservada");
  assert.ok(Math.abs(logo.x + logo.w / 2 - out.page.width / 2) < 0.5, "logo centralizada na página");
  assert.ok(logo.y >= 0 && logo.y + logo.h < 90, "logo no cabeçalho");
  const { all } = await extractText(out.bytes);
  assert.ok(all.includes("MATHEUS MACHADO") && all.includes("CORRETOR DE IMÓVEIS"), "marca continua como texto contínuo (pesquisável)");
  const logos = out.boxes.filter((b) => b.kind === "logo");
  assert.equal(logos.length, out.pageCount, "logo em todas as páginas");
});

// ---- Direção visual v4 (referência aprovada reconstruída; tokens, links, foto, zona) -------------

const photoPng = fs.readFileSync(new URL("../public/assets/og-matheus-machado-v2.png", import.meta.url));
const SITE_URL = "https://www.matheusmachadoimoveis.com.br/";
const INSTAGRAM_URL = "https://www.instagram.com/mhm.machado/";
const compact = (s) => s.replace(/\s+/g, " ").replace(/ ([.,;:])/g, "$1");

async function pdfLinks(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const result = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const annotations = await (await doc.getPage(i)).getAnnotations();
    for (const a of annotations) if (a.subtype === "Link" && a.url) result.push({ page: i - 1, url: new URL(a.url).href, rect: a.rect });
  }
  return result;
}

function typical(overrides = {}, extra = {}) {
  const { model } = modelo(
    regras({ beneficiosInformativos: [{ tipo: "documentacao_gratuita", label: "Documentação gratuita", valor: 11500 }] }),
    cliente,
    { financingInstallments: { first: 650.5, last: 710.25 }, propertyFeatures: ["Entrada 100% parcelada", "Isenção de IPTU", "Portaria e área de lazer completa"], ...extra }
  );
  return { ...base, model, ...overrides };
}

test("PDF v4: os quatro indicadores seguem a ordem aprovada e o Ato inicial não se repete em \"Sua entrada\"", async () => {
  const out = await gerarPropostaValoresPdf(typical());
  const p0 = out.texts.filter((t) => t.page === 0).map((t) => t.text);
  const order = ["ATO INICIAL", "VALOR DO IMÓVEL", "FINANCIAMENTO", "DESCONTOS E", "SUA ENTRADA", "SUAS PARCELAS"];
  const idx = order.map((label) => p0.findIndex((t) => t.startsWith(label)));
  idx.forEach((i, k) => assert.ok(i >= 0, `faltou ${order[k]}`));
  for (let k = 1; k < idx.length; k += 1) assert.ok(idx[k] > idx[k - 1], `${order[k]} deve vir depois de ${order[k - 1]}`);
  assert.equal(p0.filter((t) => /^ato inicial$/i.test(t)).length, 1, "Ato inicial aparece uma única vez (no resumo superior)");
  // linhas de "Sua entrada": entrada total, valor parcelado, parcelamento — sem ato inicial
  const iEntrada = p0.indexOf("SUA ENTRADA");
  const iParcelas = p0.indexOf("SUAS PARCELAS");
  const bloco = p0.slice(iEntrada, iParcelas);
  assert.ok(bloco.includes("Entrada total") && bloco.includes("Valor parcelado") && bloco.includes("Parcelamento"));
  assert.equal(bloco.some((t) => /ato inicial/i.test(t)), false);
});

test("PDF v4: sem \"Fale com seu corretor\", sem endereço e sem ícone de porcentagem", async () => {
  const out = await gerarPropostaValoresPdf(typical());
  const { all } = await extractText(out.bytes);
  assert.equal(/fale com|pr[óo]ximo passo|seu corretor/i.test(all), false, "chamada ao corretor removida");
  assert.equal(all.includes("Rua das Flores"), false, "endereço completo não aparece");
  assert.equal(/percent/i.test(Object.keys(ICONS).join(" ")), false, "a família de ícones não tem porcentagem");
  const gen = fs.readFileSync(new URL("../lib/simulacao-entrada/proposta-pdf.mjs", import.meta.url), "utf8");
  assert.ok(gen.includes('icon: "gift"'), "descontos e benefícios usam o ícone de presente");
});

test("PDF v4: zona do cadastro (pin + \"Zona X · Marília/SP\"); sem zona nada é inventado", async () => {
  const comZona = await gerarPropostaValoresPdf(typical({ empreendimento: { ...base.empreendimento, zona: "Zona Sul" } }));
  assert.ok((await extractText(comZona.bytes)).all.includes("Zona Sul · Marília/SP"));
  assert.ok(comZona.boxes.some((b) => b.page === 0 && b.kind === "icon" && b.y < 400), "ícone de localização no hero");
  const semZona = await gerarPropostaValoresPdf(typical({ empreendimento: { nome: "Residencial Teste", construtora: "Construtora Exemplo", localizacao: "Rua das Flores, 100 - Marília/SP" } }));
  const { all } = await extractText(semZona.bytes);
  assert.equal(all.includes("Marília/SP"), false, "sem zona cadastrada não se deduz do endereço");
  assert.equal(all.includes("Rua das Flores"), false);
  assert.equal(formatZona("norte"), "Zona Norte");
  assert.equal(formatZona("Sul"), "Zona Sul");
  assert.equal(formatZona("LESTE"), "Zona Leste");
  assert.equal(formatZona("Oeste"), "Zona Oeste");
  assert.equal(formatZona("centro"), "Centro");
  assert.equal(formatZona(""), "");
  assert.equal(formatZona("Rua das Flores, 100"), "", "valor desconhecido não vira zona");
});

test("PDF v4: links reais (annotations /URI) para o site e o Instagram, sobre o texto, em todas as páginas", async () => {
  const feats = Array.from({ length: 30 }, (_, i) => `Diferencial exclusivo número ${i + 1} do empreendimento com texto relativamente longo`);
  const out = await gerarPropostaValoresPdf(typical({}, { propertyFeatures: feats }));
  assert.ok(out.pageCount >= 2);
  const links = await pdfLinks(out.bytes);
  for (let page = 0; page < out.pageCount; page += 1) {
    const urls = links.filter((l) => l.page === page).map((l) => l.url);
    assert.ok(urls.includes(SITE_URL), `site clicável na página ${page + 1}`);
    assert.ok(urls.includes(INSTAGRAM_URL), `Instagram clicável na página ${page + 1}`);
  }
  // a área clicável cobre o texto visível do rodapé
  const siteBox = out.boxes.find((b) => b.page === 0 && b.kind === "link" && b.x < 120);
  assert.ok(siteBox);
  const siteLink = links.find((l) => l.page === 0 && l.url === SITE_URL);
  assert.ok(siteLink.rect[0] <= siteBox.x + 1 && siteLink.rect[2] >= siteBox.x + siteBox.w - 1);
  const { all } = await extractText(out.bytes);
  assert.ok(all.includes("www.matheusmachadoimoveis.com.br") && all.includes("@mhm.machado"));
});

test("PDF v4: tudo é texto e vetor (fundo em degradê nativo; só logo/foto são imagens)", async () => {
  const sem = await gerarPropostaValoresPdf(typical());
  const bytesSem = Buffer.from(sem.bytes).toString("latin1");
  assert.ok(bytesSem.includes("/ShadingType 2"), "gradiente nativo (shading axial)");
  const imagensSem = (bytesSem.match(/\/Subtype \/Image/g) || []).length;
  assert.ok(imagensSem >= 1 && imagensSem <= 8, "sem foto: só o símbolo oficial (cabeçalho, marca d agua e hero, com transparência) é imagem");
  const com = await gerarPropostaValoresPdf(typical({ imagemBytes: photoPng }));
  const bytesCom = Buffer.from(com.bytes).toString("latin1");
  const imagensCom = (bytesCom.match(/\/Subtype \/Image/g) || []).length;
  assert.ok(imagensCom >= 3 && imagensCom <= 8, "com foto: símbolo, marca d'água e foto");
  assert.ok(bytesCom.includes("/SMask") && bytesCom.includes("/Luminosity"), "dissolução da foto por máscara vetorial");
  assert.ok(com.boxes.some((b) => b.kind === "photo" && b.page === 0));
  const { all } = await extractText(com.bytes);
  assert.ok(all.includes("João Antônio da Conceição Ñandú Souza") && all.includes(formatBRL(250000 * 0 + 200000)), "nome e valores continuam texto selecionável");
  assert.ok(com.bytes.length < 600 * 1024 && sem.bytes.length < 200 * 1024, "arquivo continua leve");
});

test("PDF v4: sem imagem o layout segue completo (uma página, tudo dentro das margens); com imagem idem", async () => {
  for (const imagemBytes of [null, photoPng, Buffer.from("isto não é uma imagem")]) {
    const out = await gerarPropostaValoresPdf(typical({ imagemBytes }));
    assert.equal(out.pageCount, 1);
    assertInsideA4(out);
    const drawn = out.texts.map((x) => x.text);
    for (const t of ["ATO INICIAL", "VALOR DO IMÓVEL", "FINANCIAMENTO", "SUA ENTRADA", "SUAS PARCELAS", "VANTAGENS DO EMPREENDIMENTO"]) assert.ok(drawn.some((x) => x.startsWith(t)), `faltou ${t}`);
  }
  const corrompida = await gerarPropostaValoresPdf(typical({ imagemBytes: Buffer.from("isto não é uma imagem") }));
  assert.equal(corrompida.boxes.some((b) => b.kind === "photo"), false, "imagem inválida é ignorada sem derrubar o PDF");
});

test("PDF v4: nenhum valor em corpo grande (cartões ≤ 17pt; só o nome do cliente passa disso)", async () => {
  const out = await gerarPropostaValoresPdf(typical());
  for (const t of out.texts) {
    if (/R\$|\dx de/.test(t.text)) assert.ok(t.size <= 17.01, `valor grande demais (${t.size}pt): ${t.text}`);
  }
  assert.ok(Math.max(...out.texts.map((t) => t.size)) <= 27.01);
});

test("PDF v4: variantes dos indicadores seguem os dados (ato > 0, sem entrada, sem parcelas, sem benefícios)", async () => {
  const comAto = await gerarPropostaValoresPdf(typical({}, { ajustes: { atoDesejado: 5000 } }));
  const t1 = compact((await extractText(comAto.bytes)).all);
  assert.ok(t1.includes("R$ 5.000,00") && t1.includes("Pagamento inicial da entrada."));
  assert.equal(t1.includes("Entrada 100% parcelada, sem pagamento inicial"), false);

  const semEntrada = modelo(regras({ valorImovel: 150000 }), montarClienteEntrada({ rendaTotal: 4000, financiamentoAprovado: 150000, subsidioMcmv: 0 }));
  assert.equal(semEntrada.model.entradaTotal, 0);
  const t2 = compact((await extractText((await gerarPropostaValoresPdf({ ...base, model: semEntrada.model })).bytes)).all);
  assert.ok(t2.includes("Sem valor de entrada."));
  assert.equal(t2.includes("SUAS PARCELAS") && /Entrada parcelada/.test(t2), false, "sem entrada não há bloco de entrada parcelada");

  const semParcelasFin = modelo(regras(), cliente, { financingInstallments: { first: 0, last: 0 } });
  const t3 = (await extractText((await gerarPropostaValoresPdf({ ...base, model: semParcelasFin.model })).bytes)).all;
  assert.equal(/1ª parcela:|Última parcela:|Parcelas do financiamento/.test(t3), false, "sem parcelas de financiamento nada é inventado");

  const semBeneficios = modelo(regras({ aceitaCasaPaulista: false }), montarClienteEntrada({ financiamentoAprovado: 150000, subsidioMcmv: 0 }));
  const t4 = (await extractText((await gerarPropostaValoresPdf({ ...base, model: semBeneficios.model })).bytes)).all;
  assert.equal(/DESCONTOS E BENEF|Total de descontos/.test(t4), false, "sem benefícios não há cartão nem bloco de descontos");
});

test("PDF v4: dados extremos — nada se sobrepõe, nada é cortado e a identidade se repete nas páginas extras", async () => {
  const longo = "Maria Aparecida de Nazaré Conceição dos Santos Albuquerque Figueiredo Vasconcelos Pereira de Oliveira Júnior";
  const feats = Array.from({ length: 30 }, (_, i) => `Diferencial exclusivo número ${i + 1} do empreendimento com texto relativamente longo`);
  const { model } = modelo(
    regras({ descontos: [{ tipo: "desconto", label: "Desconto promocional de lançamento válido somente para a primeira etapa de vendas", valor: 5000 }] }),
    cliente,
    { propertyFeatures: feats, financingInstallments: { first: 1498.32, last: 842.17 } }
  );
  const out = await gerarPropostaValoresPdf({
    ...base,
    model,
    clienteNome: longo,
    imagemBytes: photoPng,
    empreendimento: { nome: "Residencial Parque das Águas Cristalinas e Jardins Suspensos do Alto da Boa Vista Etapa Três Ampliação", construtora: "Construtora Exemplo de Incorporações e Empreendimentos Imobiliários Ltda", zona: "Zona Oeste" }
  });
  assert.ok(out.pageCount >= 2);
  assertInsideA4(out);
  const { all, numPages } = await extractText(out.bytes);
  assert.equal(numPages, out.pageCount);
  assert.equal(all.includes("…") || all.includes("..."), false, "nenhum texto cortado com reticências");
  for (const f of feats) assert.ok(all.includes(f), `vantagem cortada: ${f}`);
  assert.ok(all.includes("Desconto promocional de lançamento válido somente para a primeira etapa de vendas"));
  // dinheiro nunca quebra no meio e nenhum caractere é trocado por "?"
  assert.equal(out.texts.some((t) => t.text.includes("?")), false);
  for (const t of out.texts) {
    assert.equal(/R\$$/.test(t.text.trim()), false, `linha termina em "R$": ${t.text}`);
    assert.equal(/\d+x$/.test(t.text.trim()), false, `linha termina em "36x": ${t.text}`);
  }
  // identidade nas páginas extras: logo, título do documento, continuação e rodapé com links
  const vistos = new Set(out.texts.filter((x) => x.page === 0).map((x) => x.text));
  for (let i = 1; i < out.pageCount; i += 1) {
    const doPage = out.texts.filter((t) => t.page === i).map((t) => t.text);
    assert.ok(out.boxes.some((b) => b.page === i && b.kind === "logo"), `logo na página ${i + 1}`);
    assert.ok(doPage.includes("PROPOSTA DE VALORES"));
    const titulos = doPage.filter((x) => x === "VANTAGENS DO EMPREENDIMENTO" || x === "DESCONTOS E BENEFÍCIOS");
    assert.ok(titulos.length > 0, `página ${i + 1} traz o título da seção que continua`);
    for (const titulo of titulos) {
      if (vistos.has(titulo)) assert.ok(doPage.includes("continuação"), `página ${i + 1} sinaliza continuação de ${titulo}`);
      vistos.add(titulo);
    }
    assert.ok(doPage.includes(`${i + 1}/${out.pageCount}`));
  }
  // nenhum texto invade outro (caixas de texto da mesma página não se interceptam)
  for (let page = 0; page < out.pageCount; page += 1) {
    const list = out.boxes.filter((b) => b.page === page && b.kind === "text");
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const A = list[a];
        const B = list[b];
        const w = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const h = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        assert.equal(w > 1 && h > 2.5, false, `textos sobrepostos na página ${page + 1}: ${JSON.stringify(A)} × ${JSON.stringify(B)}`);
      }
    }
  }
});

test("PDF v4: título de seção nunca fica sozinho no fim da página (nem sem itens)", async () => {
  const feats = Array.from({ length: 24 }, (_, i) => `Diferencial exclusivo número ${i + 1} do empreendimento com texto relativamente longo`);
  const { model } = modelo(regras({ descontos: [{ tipo: "desconto", label: "Desconto promocional de lançamento válido somente para a primeira etapa de vendas", valor: 5000 }] }), cliente, { propertyFeatures: feats });
  const out = await gerarPropostaValoresPdf({ ...base, clienteNome: "Maria Aparecida de Nazaré Conceição dos Santos Albuquerque Figueiredo Vasconcelos Pereira", model });
  for (let i = 0; i < out.pageCount; i += 1) {
    const doPage = out.texts.filter((t) => t.page === i).map((t) => t.text);
    for (const title of ["VANTAGENS DO EMPREENDIMENTO", "DESCONTOS E BENEFÍCIOS"]) {
      const k = doPage.findIndex((t) => t === title);
      if (k >= 0) assert.ok(doPage[k + 1] && !doPage[k + 1].startsWith("Simulação estimada") && doPage[k + 1] !== "continuação" || doPage[k + 2], `página ${i + 1}: "${title}" sem itens`);
    }
  }
});

test("PDF v4: documentação gratuita continua como linha própria do bloco de descontos (regra 5% preservada, pendente de validação)", async () => {
  const out = await gerarPropostaValoresPdf(typical({}, {}));
  const t = out.texts.filter((x) => x.page === 0).map((x) => x.text);
  const iDoc = t.indexOf("Documentação gratuita");
  assert.ok(iDoc > t.indexOf("Casa Paulista"), "documentação gratuita vem depois dos descontos/subsídio/Casa Paulista");
  assert.ok(out.texts.some((x) => x.text === formatBRL(200000 * DOCUMENTACAO_GRATUITA_PERCENTUAL)), "valor exibido = modelo (5% do valor do imóvel)");
  const model = typical().model;
  assert.ok(out.texts.some((x) => x.text === formatBRL(model.totalDescontosEBeneficios)));
});

// ---- Tokens, arquitetura e camada de imagem ------------------------------------------

test("tokens: o gerador não tem cores nem estilos soltos (tudo vem de proposta-pdf-tokens.mjs)", () => {
  const gen = fs.readFileSync(new URL("../lib/simulacao-entrada/proposta-pdf.mjs", import.meta.url), "utf8");
  assert.equal(/#[0-9a-fA-F]{6}\b/.test(gen), false, "cor hexadecimal solta no gerador");
  assert.equal(/\brgb\(/.test(gen), false, "rgb() solto no gerador");
  assert.ok(gen.includes("proposta-pdf-tokens.mjs"));
  for (const key of ["colors", "typography", "layout", "shadow", "watermark", "photo", "links"]) assert.ok(typeof tokens[key] === "object", `token ausente: ${key}`);
  assert.ok(tokens.colors.gradient.length >= 4 && tokens.colors.gradient[0][0] === 0 && tokens.colors.gradient.at(-1)[1].toUpperCase() === "#FFFFFF", "gradiente do azul ao branco");
  assert.ok(tokens.links.site.url.startsWith("https://") && tokens.links.instagram.url.startsWith("https://"));
});

test("arquitetura: o PDF só apresenta — nenhum cálculo no gerador, kit e ícones", () => {
  for (const file of ["proposta-pdf.mjs", "proposta-pdf-kit.mjs", "proposta-pdf-icons.mjs", "proposta-pdf-tokens.mjs"]) {
    const src = fs.readFileSync(new URL(`../lib/simulacao-entrada/${file}`, import.meta.url), "utf8");
    assert.equal(/^import .*(calculator|presentation-model)|simularEntrada|valorImovels*[-*/]|DOCUMENTACAO_GRATUITA_PERCENTUAL/m.test(src), false, `${file} não pode calcular valores`);
  }
});

test("imagem: só JPEG/PNG de fonte confiável; data URI válido funciona; host desconhecido e formatos estranhos viram null", async () => {
  const png = photoPng;
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  assert.ok((await loadPhotoBytes(dataUri)).length === png.length);
  assert.equal(await loadPhotoBytes("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), null, "SVG não é aceito");
  assert.equal(await loadPhotoBytes("http://exemplo.com/a.jpg"), null, "http simples não é aceito");
  assert.equal(await loadPhotoBytes("https://host-desconhecido.example/a.jpg"), null, "host fora da lista não é consultado");
  assert.equal(await loadPhotoBytes(""), null);
  assert.equal(photoSource({ data: " https://x/y.jpg " }), "https://x/y.jpg");
  assert.equal(photoSource("  /a.png "), "/a.png");
  const viaCadastro = await carregarImagemPrincipal({ photos: [{ data: "data:image/webp;base64,AAAA" }, { data: dataUri }] });
  assert.ok(viaCadastro && viaCadastro.length === png.length, "pula formato não suportado e usa a próxima foto cadastrada");
  assert.equal(await carregarImagemPrincipal({ photos: [] }), null);
  assert.equal(await carregarImagemPrincipal({}), null);
});

test("rota: usa zona do cadastro (formatZona) e a foto principal, sem passar endereço ao PDF", () => {
  const route = fs.readFileSync(new URL("../app/api/simulations/[id]/proposta-valores/route.js", import.meta.url), "utf8");
  assert.ok(route.includes("formatZona(property.region)") && route.includes("carregarImagemPrincipal(property"));
  assert.equal(/localizacao/.test(route), false, "o endereço não vai mais para o PDF");
});
