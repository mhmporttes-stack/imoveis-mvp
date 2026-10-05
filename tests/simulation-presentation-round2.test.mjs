// Apresentação interativa — ROUND 2: taxa de juros, cena de diferença de subsídio, VALIDAR SIMULAÇÃO, lista de documentos,
// logo da Caixa, imagens PNG e proteção do PDF.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  INTEREST_COLUMN_MISSING_WARNING,
  formatInterestRateInput,
  formatInterestRateLabel,
  isInterestColumnMissingError,
  parseInterestRateInput,
  readStoredInterestRate
} from "../lib/interest-rate.mjs";
import { PUBLIC_SCENE_FIELDS, buildPresentationScenes, buildPublicPresentation, generatePresentationToken } from "../lib/simulation-presentation-core.mjs";
import { PRESENTATION_GATED_SCENES, navigableSceneCount } from "../lib/simulation-presentation-gate.mjs";
import { formatBRL, splitBRL } from "../lib/simulation-presentation-format.mjs";
import { DOCUMENTS_SCENE_TEXT } from "../lib/simulation-presentation-documents.mjs";
import {
  buildSummaryImageModel,
  documentsFileName,
  documentsImageSize,
  getDocumentItems,
  imageResponseHeaders,
  summaryFileName,
  wantsDownload
} from "../lib/simulation-presentation-image-core.mjs";
import { renderDocumentsImage, renderSummaryImage } from "../lib/simulation-presentation-image.mjs";
import { buildAssetHrefs, createPlayerState, playerReducer, sceneMetricEvents, isAutoAdvancing, isLastScene } from "../components/presentation/player-core.mjs";
import { buildPresentationModel } from "../lib/simulacao-entrada/presentation-model.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ids = (scenes) => scenes.map((scene) => scene.id);
const norm = (text) => String(text).replace(/ /g, " ");
const DEFAULT_REASON = "Texto padrão.";

const model = (over = {}) => ({ financingValue: 190000, subsidyValue: 42000, firstInstallment: 1085.4, lastInstallment: 812.15, ...over });
const sim = (over = {}) => ({
  clientName: "Mariana Souza Lima",
  simulationDate: "2026-10-03",
  simulationModels: { novo: model(), usado: model() },
  properties: [{ customName: "Residencial Aurora", benefits: [{ text: "Varanda" }], recommendationReason: "Cabe no orçamento.", imageUrl: "" }],
  ...over
});
const scenesOf = (over) => buildPresentationScenes({ simulation: sim(over), defaultReason: DEFAULT_REASON });
const WORD = /\bnovo\b|\busado\b|imóvel novo|imóvel usado/i;

// ---------- taxa de juros: validação ----------
test("juros: campo vazio é válido (sem taxa); 5,4 e 5.4 aceitam; 0 e 30 aceitam", () => {
  for (const empty of ["", "   ", null, undefined]) assert.deepEqual(parseInterestRateInput(empty), { ok: true, value: null });
  assert.deepEqual(parseInterestRateInput("5,4"), { ok: true, value: 5.4 });
  assert.deepEqual(parseInterestRateInput("5.4"), { ok: true, value: 5.4 });
  assert.deepEqual(parseInterestRateInput("0"), { ok: true, value: 0 });
  assert.deepEqual(parseInterestRateInput("30"), { ok: true, value: 30 });
  assert.deepEqual(parseInterestRateInput("30,00"), { ok: true, value: 30 });
  assert.deepEqual(parseInterestRateInput("5,25"), { ok: true, value: 5.25 });
  assert.deepEqual(parseInterestRateInput(5.4), { ok: true, value: 5.4 });
});

test("juros: 30,01, negativo, 3 casas, texto e lixo são inválidos com mensagem clara", () => {
  for (const bad of ["30,01", "31", "100", "-1", "-0,5", "5,456", "abc", "5,4%", "5,,4", "1.000", "1e1", "5 4", "NaN", ","]) {
    const result = parseInterestRateInput(bad);
    assert.equal(result.ok, false, bad);
    assert.match(result.error, /0 a 30/);
  }
  assert.equal(parseInterestRateInput(30.01).ok, false);
  assert.equal(parseInterestRateInput(-1).ok, false);
  assert.equal(parseInterestRateInput(5.456).ok, false);
  assert.equal(parseInterestRateInput(Number.NaN).ok, false);
});

test("juros: formato pt-BR '5,4% ao ano'; zero e vazio não aparecem para o cliente", () => {
  assert.equal(formatInterestRateLabel(5.4), "5,4% ao ano");
  assert.equal(formatInterestRateLabel(5), "5% ao ano");
  assert.equal(formatInterestRateLabel(5.25), "5,25% ao ano");
  assert.equal(formatInterestRateLabel(0), "");
  assert.equal(formatInterestRateLabel(null), "");
  assert.equal(formatInterestRateInput(5.4), "5,4");
  assert.equal(formatInterestRateInput(null), "");
  assert.equal(readStoredInterestRate("5.40"), 5.4);
  assert.equal(readStoredInterestRate(null), null);
  assert.equal(readStoredInterestRate(99), null);
  assert.equal(norm(formatBRL(232000)), "R$ 232.000,00");
  assert.deepEqual(splitBRL(232000), { symbol: "R$", number: "232.000,00" });
});

// ---------- taxa de juros: cena de parcelas e DTO ----------
test("parcelas: com taxa cadastrada a cena leva interestRate; sem taxa vira null e a cena funciona", () => {
  const withRate = scenesOf({ interestRateAnnual: 5.4 }).find((scene) => scene.id === "parcelas");
  assert.equal(withRate.interestRate, 5.4);
  assert.equal(withRate.first, 1085.4);
  assert.equal(withRate.last, 812.15);
  for (const none of [null, undefined, 0, "", "lixo"]) {
    const scene = scenesOf({ interestRateAnnual: none }).find((item) => item.id === "parcelas");
    assert.equal(scene.interestRate, null, String(none));
    assert.equal(scene.first, 1085.4);
  }
});

test("DTO: a taxa entra na allowlist; nada sensível entra junto", () => {
  assert.ok(PUBLIC_SCENE_FIELDS.parcelas.includes("interestRate"));
  const dto = buildPublicPresentation({ simulation: sim({ interestRateAnnual: 5.4, clientWhatsApp: "14999887766", internalNote: "SEGREDO", registration: { cpf: "123.456.789-09", email: "a@b.com", oldestBirthDate: "1990-01-01", address: "Rua X" } }), defaultReason: DEFAULT_REASON });
  const json = JSON.stringify(dto);
  for (const forbidden of ["14999887766", "SEGREDO", "123.456.789-09", "a@b.com", "1990-01-01", "Rua X", "Souza", "wa.me", "broker", "interestRateAnnual"]) assert.ok(!json.includes(forbidden), forbidden);
  for (const scene of dto.scenes) {
    const allowed = PUBLIC_SCENE_FIELDS[scene.id];
    assert.ok(allowed, scene.id);
    for (const key of Object.keys(scene)) assert.ok(allowed.includes(key), `${scene.id}.${key}`);
  }
});

// ---------- cenas: ordem e cena de diferença ----------
test("ordem final das cenas (adaptativa) com diferença de subsídio; o próximo passo é a última do roteiro automático", () => {
  const scenes = scenesOf({ simulationModels: { novo: model(), usado: model({ subsidyValue: 0 }) }, interestRateAnnual: 5.4 });
  assert.deepEqual(ids(scenes), ["abertura", "poder", "formacao", "parcelas", "diferenca", "proximo", "validar", "documentos"]);
});

test("neutro: subsídio igual ou zero nos dois → sem cena e SEM as palavras novo/usado em lugar nenhum do DTO", () => {
  for (const models of [
    { novo: model(), usado: model() },
    { novo: model({ subsidyValue: 0 }), usado: model({ subsidyValue: 0 }) },
    { novo: model({ subsidyValue: 0 }), usado: { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" } },
    { novo: model({ financingValue: 100000, firstInstallment: 700 }), usado: model() } // outras diferenças não contam
  ]) {
    const dto = buildPublicPresentation({ simulation: sim({ simulationModels: models }), defaultReason: DEFAULT_REASON });
    assert.ok(!ids(dto.scenes).includes("diferenca"));
    assert.ok(!WORD.test(JSON.stringify(dto)), JSON.stringify(dto).match(WORD)?.[0]);
    assert.ok(!WORD.test(JSON.stringify(buildSummaryImageModel(dto))));
  }
});

test("com diferença: só a cena de diferença usa novo/usado e diz qual cenário as demais mostram", () => {
  const scenes = scenesOf({ simulationModels: { novo: model(), usado: model({ subsidyValue: 10000 }) } });
  const diff = scenes.find((scene) => scene.id === "diferenca");
  assert.deepEqual({ novo: diff.novo, usado: diff.usado, difference: diff.difference, scenario: diff.scenario }, { novo: 42000, usado: 10000, difference: 32000, scenario: "novo" });
  for (const scene of scenes.filter((item) => item.id !== "diferenca")) assert.ok(!WORD.test(JSON.stringify(scene)), scene.id);
  // só usado preenchido: cenário "usado", sem cena
  const onlyUsed = scenesOf({ simulationModels: { novo: { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" }, usado: model() } });
  assert.ok(!ids(onlyUsed).includes("diferenca"));
});

test("um modelo só (ou segundo modelo só 'sincronizado', subsídio em branco) NÃO gera diferença nem as palavras novo/usado", () => {
  const blank = { financingValue: "190.000,00", subsidyValue: "", firstInstallment: "1.085,40", lastInstallment: "812,15" }; // o gerador copia financiamento/parcelas
  const cases = [
    { novo: model(), usado: { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" } }, // um modelo só, subsídio > 0
    { novo: model({ subsidyValue: "6.258,00" }), usado: blank }, // caso real (Carol): usado só sincronizado
    { novo: blank, usado: model() }
  ];
  for (const models of cases) {
    const dto = buildPublicPresentation({ simulation: sim({ simulationModels: models }), defaultReason: DEFAULT_REASON });
    assert.ok(!ids(dto.scenes).includes("diferenca"));
    assert.ok(!WORD.test(JSON.stringify(dto)));
    assert.ok(!WORD.test(JSON.stringify(buildSummaryImageModel(dto))));
    assert.equal(buildSummaryImageModel(dto).difference, null);
  }
  // simulação antiga (campos soltos, sem modelos) com subsídio: um modelo só
  const legacy = buildPresentationScenes({ simulation: { clientName: "Ana", simulationType: "novo", financingValue: 100000, subsidyValue: 6258, firstInstallment: 900, lastInstallment: 700, properties: [] } });
  assert.ok(!ids(legacy).includes("diferenca"));
  // dois modelos com subsídio informado e diferente (inclusive 0 digitado) geram a diferença
  for (const usado of [model({ subsidyValue: 0 }), model({ subsidyValue: "0,00" }), model({ subsidyValue: "1.000,00" })]) {
    assert.ok(ids(buildPresentationScenes({ simulation: sim({ simulationModels: { novo: model({ subsidyValue: "6.258,00" }), usado } }) })).includes("diferenca"));
  }
});

// ---------- player: texto, botões, remoção do corretor, logo ----------
test("abertura: título e subtítulo exatos", () => {
  const source = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(source.includes("`${scene.firstName}, sua simulação de financiamento está pronta`"));
  assert.ok(source.includes("Você já está um passo mais próximo da compra do seu imóvel"));
  assert.ok(!/sua simulação está pronta/.test(source.replace(/simulação de financiamento está pronta/g, "")));
});

test("'Falar com meu corretor' removido: nenhum telefone, wa.me ou botão do corretor no player, no DTO ou no HTML", () => {
  for (const file of ["components/presentation/PresentationPlayer.jsx", "components/presentation/DocumentsSheet.jsx", "components/presentation/player-core.mjs", "lib/simulation-presentation-core.mjs", "lib/simulation-presentation.js", "app/apresentacao/[token]/page.jsx"]) {
    const code = read(file).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/Falar com meu corretor|wa\.me|whatsappUrl/i.test(code), file);
    // round 4 (PRES-17): só o BOOLEANO podeReceberLista consulta o responsável (lib/simulation-presentation.js); o ícone só no botão de receber
    if (file !== "lib/simulation-presentation.js") assert.ok(!/broker/i.test(code), file);
    if (file !== "components/presentation/PresentationPlayer.jsx") assert.ok(!/MessageCircle/.test(code), file);
  }
});

test("proximo: botões VALIDAR SIMULAÇÃO (maiúsculas) e Baixar apresentação; validar avança dentro da apresentação sem enviar nada", () => {
  const source = read("components/presentation/PresentationPlayer.jsx");
  assert.match(source, />\s*VALIDAR SIMULAÇÃO\s*</);
  assert.match(source, /label="Baixar apresentação"/);
  // round 4: o cliente não baixa mais a lista (ele a recebe do corretor); a folha que MOSTRA a lista continua
  assert.ok(!/Baixar imagem da lista de documentos/.test(source));
  assert.match(source, />\s*Lista de documentos\s*</);
  // VALIDAR só libera as cenas e avança: nenhum fetch/mailto/whatsapp no handler
  const handler = /const validate = useCallback\(\(\) => \{([\s\S]*?)\}, \[total\]\);/.exec(source)?.[1] || "";
  assert.match(handler, /setUnlocked\(true\)/);
  assert.match(handler, /dispatch\(\{ type: "unlock", total \}\)/);
  assert.ok(!/fetch|sendEvent|mailto|wa\.me|window\.open/.test(handler));
  assert.match(source, /esse é o próximo passo!/);
});

test("trava: cenas validar/documentos só depois de VALIDAR; sem auto-avanço para elas; concluiu = última cena inteira", () => {
  assert.deepEqual(PRESENTATION_GATED_SCENES, ["validar", "documentos"]);
  const scenes = scenesOf();
  const before = navigableSceneCount(scenes, false);
  assert.equal(scenes[before - 1].id, "proximo");
  assert.equal(navigableSceneCount(scenes, true), scenes.length);
  let state = { ...createPlayerState(before), index: before - 1 };
  assert.equal(isLastScene(state), true);
  assert.equal(isAutoAdvancing(state), false, "a cena 'Próximo passo' não avança sozinha para 'validar'");
  assert.equal(playerReducer(state, { type: "auto" }).index, before - 1);
  assert.equal(playerReducer(state, { type: "next" }).index, before - 1, "sem VALIDAR não passa");
  state = playerReducer(state, { type: "unlock", total: scenes.length });
  assert.equal(state.total, scenes.length);
  assert.equal(scenesOf()[state.index].id, "validar");
  state = playerReducer(state, { type: "next" });
  assert.equal(scenesOf()[state.index].id, "documentos");
  assert.equal(isLastScene(state), true);
  // métrica: 'concluiu' só na última de TODAS as cenas do roteiro principal
  const total = scenes.length;
  assert.deepEqual(sceneMetricEvents({ index: before - 1, total, maxReached: 0 }).events, [{ tipo: "cena", cena: before }]);
  assert.deepEqual(sceneMetricEvents({ index: total - 1, total, maxReached: total - 1 }).events, [{ tipo: "cena", cena: total }, { tipo: "concluiu", cena: total }]);
});

test("links das imagens: mesmo token, ?baixar=1; prévia sem token não tem link", () => {
  const token = generatePresentationToken();
  assert.deepEqual(buildAssetHrefs({ token }), { summary: `/s/${token}/imagem?baixar=1`, documents: `/s/${token}/documentos?baixar=1` });
  assert.deepEqual(buildAssetHrefs({ token: "", preview: true }), { summary: "", documents: "" });
  assert.deepEqual(buildAssetHrefs({ token, preview: true }), { summary: "", documents: "" });
  assert.equal(buildAssetHrefs({ assetsBase: "/dev/vitrine/apresentacao", assetsQuery: "v=x" }).summary, "/dev/vitrine/apresentacao/imagem?v=x&baixar=1");
});

test("logo da Caixa: a MESMA do formulário, no rodapé fixo do palco (todas as cenas), só a logo, sem texto de parceria", () => {
  const form = read("components/simulation-form/SimulationSuccess.jsx");
  assert.ok(form.includes("/assets/caixa-logo-transparent.png"));
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(player.includes('const CAIXA_LOGO = "/assets/caixa-logo-transparent.png"'));
  // a logo fica no palco (.frame), fora de qualquer cena: aparece em TODAS
  const frame = player.slice(player.indexOf("<div className={styles.frame}>"));
  assert.ok(frame.indexOf("styles.caixa") > frame.indexOf("styles.stage"), "rodapé fixo depois do palco");
  assert.ok(!/function Scene\w+[\s\S]{0,4000}CAIXA_LOGO/.test(player.replace(/export default[\s\S]*/, "")), "não está dentro de cena específica");
  assert.ok(fs.existsSync(path.join(root, "public/assets/caixa-logo-transparent.png")));
  assert.ok(!/parceir|aprovad|homologad|oficial da caixa/i.test(player.replace(/\/\/.*$/gm, "")));
  const css = read("components/presentation/presentation.module.css");
  assert.match(css, /aspect-ratio: 780 \/ 196/); // sem deformar
  const image = read("lib/simulation-presentation-image.mjs");
  assert.ok(image.includes('"caixa-logo-transparent.png"'));
  assert.ok((image.match(/logoFooter\(assets\)/g) || []).length >= 2, "logo no resumo (a lista de documentos não tem rodapé)");
});

test("escala: palco com altura total e unidade --u; sem coluna fixa estreita", () => {
  const css = read("components/presentation/presentation.module.css");
  assert.match(css, /height: 100dvh/);
  assert.match(css, /--fw: min\(100vw, calc\(100dvh \* 0\.7\), 700px\)/);
  assert.match(css, /--u: min\(calc\(var\(--fw\) \/ 390\), calc\(100dvh \/ 780\)\)/);
  assert.ok(!/max-width: 480px|max-width: 560px/.test(css));
});

test("ponto de extensão da animação de abertura: componente isolado com durationMs e reducedMotion", () => {
  const source = read("components/presentation/OpeningAnimation.jsx");
  assert.match(source, /export default function OpeningAnimation\(\{ durationMs = OPENING_ANIMATION_DEFAULT_MS, reducedMotion = false \}\)/);
  assert.match(read("components/presentation/PresentationPlayer.jsx"), /<OpeningAnimation reducedMotion=\{reduced\} \/>/);
});

test("documentos: o painel é rolável, fecha (botão e Escape) e não navega a apresentação", () => {
  const sheet = read("components/presentation/DocumentsSheet.jsx");
  assert.match(sheet, /aria-label="Fechar a lista de documentos"/);
  assert.match(sheet, /event\.key === "Escape"/);
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /data-no-nav/);
  assert.match(read("components/presentation/presentation.module.css"), /\.sheetBody \{[^}]*overflow-y: auto/);
});

// ---------- lista de documentos: texto-base (o conteúdo e a personalização estão no round 3) ----------
test("documentos: texto da cena e lista final como item do DTO da cena (sem observação extra de rodapé)", () => {
  assert.equal(DOCUMENTS_SCENE_TEXT, "Para validarmos esses valores junto à Caixa, vamos precisar montar a sua pasta. Para isso, preciso de alguns documentos.");
  const doc = scenesOf().find((scene) => scene.id === "documentos");
  assert.ok(Array.isArray(doc.items) && doc.items.length >= 8);
  assert.ok(!/adicionais conforme o seu perfil/.test(read("lib/simulation-presentation-documents.mjs")));
});

// ---------- imagens PNG ----------
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
async function pngInfo(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.subarray(0, 8).equals(PNG), "assinatura PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), size: bytes.length };
}

test("imagem-resumo: PNG válido 1080x1920, anexo com nome simulacao-<primeironome>.png, sem cache e sem indexação", async () => {
  const dto = buildPublicPresentation({ simulation: sim({ interestRateAnnual: 5.4, simulationModels: { novo: model(), usado: model({ subsidyValue: 0 }) } }), defaultReason: DEFAULT_REASON });
  const response = await renderSummaryImage(dto, { download: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="simulacao-mariana.png"');
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const info = await pngInfo(response);
  assert.deepEqual([info.width, info.height], [1080, 1920]);
  assert.ok(info.size > 20000);
  const inline = await renderSummaryImage(dto, { download: false });
  assert.match(inline.headers.get("content-disposition"), /^inline;/);
});

test("imagem-lista: PNG válido 1080 de largura, altura da lista, nome lista-de-documentos-<primeironome>.png", async () => {
  const dto = buildPublicPresentation({ simulation: sim({ clientName: "José Álvaro Silva" }), defaultReason: DEFAULT_REASON });
  const response = await renderDocumentsImage(dto, { download: true });
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="lista-de-documentos-jose.png"');
  const info = await pngInfo(response);
  const expected = documentsImageSize(getDocumentItems(dto));
  assert.deepEqual([info.width, info.height], [expected.width, expected.height]);
  assert.equal(info.width, 1080);
});

test("imagem: textos vêm só do DTO (números do PDF, taxa se houver, nada sensível)", () => {
  const dto = buildPublicPresentation({ simulation: sim({ interestRateAnnual: 5.4, internalNote: "SEGREDO", clientWhatsApp: "14999887766", registration: { cpf: "123.456.789-09" } }), defaultReason: DEFAULT_REASON });
  const m = buildSummaryImageModel(dto);
  assert.equal(norm(m.power.value), "R$ 232.000,00");
  assert.equal(norm(m.installments.first), "R$ 1.085,40");
  assert.equal(m.installments.interest, "5,4% ao ano");
  assert.equal(m.subtitle, "Simulação de Mariana");
  const json = JSON.stringify(m);
  for (const forbidden of ["SEGREDO", "14999887766", "123.456.789-09", "Souza"]) assert.ok(!json.includes(forbidden));
  const noRate = buildSummaryImageModel(buildPublicPresentation({ simulation: sim(), defaultReason: DEFAULT_REASON }));
  assert.equal(noRate.installments.interest, "");
  assert.equal(summaryFileName("Ana Clara"), "simulacao-ana-clara.png");
  assert.equal(summaryFileName(""), "simulacao-cliente.png");
  assert.equal(documentsFileName("Ünico"), "lista-de-documentos-unico.png");
  assert.equal(wantsDownload(new URLSearchParams("baixar=1")), true);
  assert.equal(wantsDownload(new URLSearchParams("")), false);
  assert.match(imageResponseHeaders({ fileName: "a.png", download: true })["Content-Disposition"], /^attachment/);
});

test("rotas de imagem: mesmo token da página, 404 para token inválido/revogado (mesma função), cabeçalhos e sem login", () => {
  for (const [file, renderer] of [["app/apresentacao/[token]/imagem/route.js", "renderSummaryImage"], ["app/apresentacao/[token]/documentos/route.js", "renderDocumentsImage"]]) {
    const source = read(file);
    assert.match(source, /await getPublicPresentation\(token\)/); // token inexistente/revogado/inválido → null → 404
    assert.match(source, /if \(!dto\) return new Response\("Não encontrado\.", \{ status: 404/);
    assert.ok(source.includes(renderer));
    assert.match(source, /noindex, nofollow, noarchive/);
    assert.match(source, /no-store/);
    assert.match(source, /wantsDownload\(request\.nextUrl\.searchParams\)/);
    assert.ok(!/requireAdmin|cookies\(/.test(source));
  }
  const proxy = read("proxy.js");
  const literal = /const PRESENTATION_TOKEN_PATH = (\/.*\/);/.exec(proxy)?.[1];
  const pattern = new RegExp(literal.slice(1, -1));
  const token = generatePresentationToken();
  for (const sub of ["", "/imagem", "/documentos", "/imagem/"]) assert.ok(pattern.test(`/s/${token}${sub}`), sub);
  for (const bad of ["/s/mhm/imagem", `/s/${token}/outra`, `/s/${token}/imagem/x`, "/s/abcdefghijklmnopqrstuvwx/imagem"]) assert.equal(pattern.test(bad), false, bad);
  assert.equal(pattern.exec(`/s/${token}/documentos`)[2], "documentos");
});

// ---------- PDF intacto; tolerância à coluna ausente; migration; CRM ----------
test("PDF não muda: nenhum arquivo do PDF conhece a taxa de juros e o modelo do PDF é idêntico com e sem juros", () => {
  for (const file of ["lib/simulacao-entrada/presentation-model.mjs", "lib/simulacao-entrada/proposta-pdf.mjs", "app/api/simulations/[id]/proposta-valores/route.js"]) {
    assert.ok(!/interestRate|interest_rate/i.test(read(file)), file);
  }
  const result = { empreendimentoNome: "X", valorImovel: 250000, descontosAplicados: [], subsidioMcmv: 42000, casaPaulista: 0, financiamentoAprovado: 190000, entradaTotal: 18000, totalDescontos: 0, detalhePagamento: { ato: 0, blocos: [] }, beneficiosInformativos: [], classificacao: "ok", motivos: [] };
  const base = buildPresentationModel(result, { financingInstallments: { first: 1085.4, last: 812.15 } });
  const withRate = buildPresentationModel({ ...result, interestRateAnnual: 5.4 }, { financingInstallments: { first: 1085.4, last: 812.15, interestRateAnnual: 5.4 } });
  assert.deepEqual(withRate, base);
  assert.ok(!/interest/i.test(JSON.stringify(base)));
  // o PDF do gerador (SVG do SimulationGenerator) não imprime a taxa: o campo só vive no formulário e no payload
  const generator = read("components/SimulationGenerator.jsx");
  const svg = generator.slice(generator.indexOf("function buildSimulationResultSvg"), generator.indexOf("function buildPropertySvg"));
  assert.ok(!/interestRate|juros/i.test(svg));
});

test("coluna ausente: erro 42703/PGRST204 da taxa é reconhecido; outros erros não; salvar sem a coluna avisa e não quebra", () => {
  assert.equal(isInterestColumnMissingError({ code: "42703", message: 'column "interest_rate_annual" of relation "simulations" does not exist' }), true);
  assert.equal(isInterestColumnMissingError({ code: "PGRST204", message: "Could not find the 'interest_rate_annual' column of 'simulations' in the schema cache" }), true);
  assert.equal(isInterestColumnMissingError({ code: "42703", message: 'column "registration_id" does not exist' }), false);
  assert.equal(isInterestColumnMissingError({ code: "23505", message: "duplicate key interest_rate_annual" }), false);
  assert.equal(isInterestColumnMissingError(null), false);
  assert.match(INTEREST_COLUMN_MISSING_WARNING, /taxa de juros não foi salva/);
  assert.match(INTEREST_COLUMN_MISSING_WARNING, /demais valores .* salvos/);
  const lib = read("lib/simulations.js");
  assert.match(lib, /async function writeSimulationRecord/);
  assert.match(lib, /"interest_rate_annual" in current && isInterestColumnMissingError\(error\)/);
  assert.match(lib, /saveWarning/);
  assert.match(lib, /withSaveWarning\(await getSimulation\(data\.id, auth\), warning\)/);
  // leitura: select("*") nunca nomeia a coluna → a ausência dela não quebra listagens
  assert.ok(!/select\([^)]*interest_rate_annual/.test(lib + read("lib/simulation-list-query.js") + read("lib/simulation-presentation.js")));
  const mapper = read("lib/simulation-mapper.js");
  assert.match(mapper, /if \(simulation\.interestRateAnnual !== undefined\)/); // quem não conhece o campo não apaga a taxa
  assert.match(mapper, /if \(!parsed\.ok\) throw new Error\(parsed\.error\)/);
});

test("migration da taxa: aditiva, idempotente, nome de 14 dígitos, check 0..30, numeric(5,2), sem default", () => {
  const dir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(dir).filter((name) => name.includes("simulations_interest_rate"));
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{14}_simulations_interest_rate\.sql$/);
  const sql = read(`supabase/migrations/${files[0]}`);
  assert.match(sql, /add column if not exists interest_rate_annual numeric\(5,2\)/);
  assert.match(sql, /check \(interest_rate_annual is null or \(interest_rate_annual >= 0 and interest_rate_annual <= 30\)\)/);
  assert.ok(!/default|drop |delete |update |truncate /i.test(sql.replace(/--.*$/gm, "")));
  const mine = files[0].slice(0, 14);
  assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith(mine)).length, 1, "timestamp único");
});

test("campo do CRM: opcional, começa vazio, placeholder 'Ex.: 5,4', validação e autosave", () => {
  const generator = read("components/SimulationGenerator.jsx");
  assert.match(generator, /interestRateAnnual: "",/); // começa vazio (não é valor padrão)
  assert.match(generator, /placeholder="Ex\.: 5,4"/);
  assert.match(generator, /Taxa de juros \(% ao ano\)/);
  assert.match(generator, /interestRateAnnual: interestRate\.ok \? interestRate\.value : undefined/);
  assert.match(generator, /parseInterestRateInput\(formToSave\.interestRateAnnual\)/);
  assert.match(generator, /formatInterestRateInput\(simulation\.interestRateAnnual\)/);
  assert.match(generator, /data\?\.saveWarning/);
});
