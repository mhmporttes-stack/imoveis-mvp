// Apresentação interativa — ROUND 3: lista de documentos do dono (personalizada pelo cadastro, só no servidor), ramo opcional de
// imóveis sugeridos, logo da Caixa sem pílula, cabeçalho de duas linhas, "+" alinhado e imagem de documentos sem rodapé.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_SCENE_FIELDS, buildPresentationScenes, buildPublicPresentation } from "../lib/simulation-presentation-core.mjs";
import {
  BRAND_CRECI,
  BRAND_NAME,
  BRAND_ROLE,
  DOCUMENT_PERSONALIZATION_SOURCES,
  buildDocumentItems,
  buildDocumentItemsFor,
  deriveDocumentProfile
} from "../lib/simulation-presentation-documents.mjs";
import { DOCUMENTS_LAYOUT, buildSummaryImageModel, documentItemHeight, documentsImageSize, getDocumentItems, estimateLines } from "../lib/simulation-presentation-image-core.mjs";
import { renderDocumentsImage, renderSummaryImage } from "../lib/simulation-presentation-image.mjs";
import { branchStep, createPlayerState, isAutoAdvancing, isLastScene, playerReducer, propertiesButtonLabel, sceneMetricEvents } from "../components/presentation/player-core.mjs";
import { navigableSceneCount } from "../lib/simulation-presentation-gate.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const code = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ids = (list) => list.map((item) => item.id);
const DEFAULT_REASON = "Este imóvel foi selecionado buscando reduzir ao máximo o desembolso inicial da compra e proporcionar o melhor aproveitamento das condições disponíveis.";

const reg = (over = {}) => ({ simulationType: "individual", oldestBirthDate: "1990-05-10", primaryIncomeType: "registered_employment", primaryMaritalStatus: "single", hasChildrenUnder18: false, ...over });
const byId = (items, id) => items.find((item) => item.id === id);
const model = { financingValue: 190000, subsidyValue: 42000, firstInstallment: 1085.4, lastInstallment: 812.15 };
const sim = (over = {}) => ({
  clientName: "Mariana Souza Lima",
  simulationDate: "2026-10-03",
  simulationModels: { novo: model, usado: model },
  registration: reg(),
  properties: [{ customName: "Residencial Aurora", benefits: [{ text: "Varanda" }], recommendationReason: "Cabe no orçamento.", imageUrl: "" }],
  ...over
});

// ---------- (B) texto exato da referência do dono ----------
test("lista completa (cadastro desconhecido): textos EXATOS da referência do dono, na ordem da referência", () => {
  const items = buildDocumentItems({});
  assert.deepEqual(ids(items), ["identidade", "residencia", "estado-civil", "dependentes", "renda", "carteira", "pis", "fgts", "contato"]);
  assert.deepEqual(
    items.map((item) => [item.title, item.description, item.lines]),
    [
      ["DOCUMENTAÇÃO DE IDENTIDADE COM FOTO", "RG com CPF ou CNH, foto do documento aberto", []],
      ["COMPROVANTE DE RESIDÊNCIA ATUAL", "Máximo de dois meses atrás", []],
      ["COMPROVANTE DE ESTADO CIVIL", "Certidão de nascimento ou casamento", []],
      ["CERTIDÃO DE DEPENDENTES", "Certidão de nascimento de filhos menores de 18 anos", []],
      ["COMPROVANTE DE RENDA", "", ["Formal (2 últimos holerites s/férias) ou Imposto de Renda do ano vigente", "Informal (3 últimos extratos bancários ou 3 últimas faturas de cartão de crédito)"]],
      ["CARTEIRA DE TRABALHO", "Foto, identificação e todos os registros", []],
      ["DOCUMENTAÇÃO COM O NÚMERO DO PIS", "Pode ser encontrado na carteira de trabalho física e nos aplicativos Meu INSS, Carteira de Trabalho Digital, FGTS, Caixa Trabalhador e Caixa Tem", []],
      ["EXTRATO DO FGTS ATUALIZADO", "", []],
      ["E-MAIL E TELEFONE COM DDD", "", []]
    ]
  );
});

// ---------- (C) personalização ----------
test("renda: formal/CLT/IR → holerites ou IR; informal → extratos ou faturas; desconhecido ou misto → as duas linhas", () => {
  const formal = "Os 2 últimos holerites (sem férias) ou Imposto de Renda do ano vigente";
  const informal = "Os 3 últimos extratos bancários ou as 3 últimas faturas de cartão de crédito";
  const renda = (registration) => byId(buildDocumentItemsFor(registration), "renda");
  assert.equal(renda(reg({ primaryIncomeType: "registered_employment" })).description, formal);
  assert.equal(renda(reg({ primaryIncomeType: "income_tax_declarant" })).description, formal);
  assert.equal(renda(reg({ primaryIncomeType: "self_employed_unregistered" })).description, informal);
  assert.deepEqual(renda(reg({ primaryIncomeType: "self_employed_unregistered" })).lines, []);
  assert.equal(renda(reg({ primaryIncomeType: "outro-valor" })).lines.length, 2);
  assert.equal(renda(null).lines.length, 2);
  // proponentes com rendas diferentes (cadastro conjunto): lista completa
  assert.equal(renda(reg({ simulationType: "joint", primaryIncomeType: "registered_employment", secondaryIncomeType: "self_employed_unregistered" })).lines.length, 2);
  assert.equal(renda(reg({ simulationType: "joint", primaryIncomeType: "registered_employment", secondaryIncomeType: "income_tax_declarant" })).description, formal);
  // o 2º proponente só conta no cadastro conjunto
  assert.equal(renda(reg({ simulationType: "individual", primaryIncomeType: "registered_employment", secondaryIncomeType: "self_employed_unregistered" })).description, formal);
});

test("estado civil (dono 2026-10-05): solteiro e união estável → nascimento; casado → casamento; divorciado → casamento + obs de averbação; viúvo/desconhecido → ou", () => {
  const civil = (registration) => byId(buildDocumentItemsFor(registration), "estado-civil").description;
  assert.equal(civil(reg({ primaryMaritalStatus: "single" })), "Certidão de nascimento");
  assert.equal(civil(reg({ primaryMaritalStatus: "married" })), "Certidão de casamento");
  assert.equal(civil(reg({ primaryMaritalStatus: "stable_union" })), "Certidão de nascimento");
  assert.equal(civil(reg({ primaryMaritalStatus: "divorced" })), "Certidão de casamento");
  const obsOf = (status) => byId(buildDocumentItemsFor(reg({ primaryMaritalStatus: status })), "estado-civil").obs;
  assert.equal(obsOf("divorced"), "Com averbação do divórcio");
  for (const status of ["single", "married", "stable_union", "widowed", ""]) assert.equal(obsOf(status), undefined, status);
  // cadastro conjunto: só personaliza se os dois coincidirem (regra mantida); divorciados nos dois → obs
  const joint = (a, b) => byId(buildDocumentItemsFor(reg({ simulationType: "joint", primaryMaritalStatus: a, secondaryMaritalStatus: b })), "estado-civil");
  assert.equal(joint("divorced", "divorced").obs, "Com averbação do divórcio");
  assert.equal(joint("divorced", "single").description, "Certidão de nascimento ou casamento");
  assert.equal(joint("divorced", "single").obs, undefined);
  assert.equal(civil(reg({ primaryMaritalStatus: "widowed" })), "Certidão de nascimento ou casamento");
  assert.equal(civil(reg({ primaryMaritalStatus: "" })), "Certidão de nascimento ou casamento");
  assert.equal(civil(undefined), "Certidão de nascimento ou casamento");
  assert.equal(byId(buildDocumentItemsFor(reg()), "estado-civil").title, "COMPROVANTE DE ESTADO CIVIL");
});

test("dependentes: sem filhos menores omite o item; com filhos ou desconhecido mostra", () => {
  assert.equal(byId(buildDocumentItemsFor(reg({ hasChildrenUnder18: false })), "dependentes"), undefined);
  assert.ok(byId(buildDocumentItemsFor(reg({ hasChildrenUnder18: true })), "dependentes"));
  assert.ok(byId(buildDocumentItemsFor(reg({ hasChildrenUnder18: null })), "dependentes"));
  assert.ok(byId(buildDocumentItemsFor(reg({ hasChildrenUnder18: undefined })), "dependentes"));
  assert.ok(byId(buildDocumentItemsFor(undefined), "dependentes"));
});

test("itens fixos aparecem para todos os perfis e a ordem é sempre a da referência", () => {
  const fixed = ["identidade", "residencia", "carteira", "pis", "fgts", "contato"];
  const order = ["identidade", "residencia", "estado-civil", "dependentes", "renda", "carteira", "pis", "fgts", "contato"];
  for (const registration of [undefined, null, reg(), reg({ primaryIncomeType: "self_employed_unregistered", primaryMaritalStatus: "divorced", hasChildrenUnder18: true }), reg({ hasChildrenUnder18: false, primaryMaritalStatus: "widowed" })]) {
    const list = ids(buildDocumentItemsFor(registration));
    for (const id of fixed) assert.ok(list.includes(id), id);
    assert.deepEqual(list, order.filter((id) => list.includes(id)));
  }
});

test("cadastro manual (data de nascimento-marcador 1900-01-01): renda/estado civil/filhos são placeholders → lista completa", () => {
  const manual = reg({ oldestBirthDate: "1900-01-01", primaryIncomeType: "self_employed_unregistered", primaryMaritalStatus: "single", hasChildrenUnder18: false });
  assert.deepEqual(deriveDocumentProfile(manual), { income: "desconhecido", marital: "desconhecido", dependents: "desconhecido" });
  const items = buildDocumentItemsFor(manual);
  assert.equal(byId(items, "renda").lines.length, 2);
  assert.equal(byId(items, "estado-civil").description, "Certidão de nascimento ou casamento");
  assert.ok(byId(items, "dependentes"));
});

test("a personalização espelha o motor documental do CRM (os trechos citados existem no arquivo)", () => {
  for (const source of DOCUMENT_PERSONALIZATION_SOURCES) assert.ok(read(source.file).includes(source.anchor), `"${source.anchor}" não está em ${source.file}`);
});

test("cenário do dono: renda formal + casado + com filhos / informal + solteiro + sem filhos", () => {
  const a = buildDocumentItemsFor(reg({ primaryIncomeType: "registered_employment", primaryMaritalStatus: "married", hasChildrenUnder18: true }));
  assert.equal(byId(a, "renda").description, "Os 2 últimos holerites (sem férias) ou Imposto de Renda do ano vigente");
  assert.equal(byId(a, "estado-civil").description, "Certidão de casamento");
  assert.ok(byId(a, "dependentes"));
  const b = buildDocumentItemsFor(reg({ primaryIncomeType: "self_employed_unregistered", primaryMaritalStatus: "single", hasChildrenUnder18: false }));
  assert.equal(byId(b, "renda").description, "Os 3 últimos extratos bancários ou as 3 últimas faturas de cartão de crédito");
  assert.equal(byId(b, "estado-civil").description, "Certidão de nascimento");
  assert.equal(byId(b, "dependentes"), undefined);
});

// ---------- PRIVACIDADE: só a lista final sai ----------
test("DTO e HTML nunca carregam o valor cru do cadastro (renda, estado civil, filhos): só a lista final", () => {
  const registration = reg({ simulationType: "joint", primaryIncomeType: "registered_employment", secondaryIncomeType: "self_employed_unregistered", primaryMaritalStatus: "divorced", secondaryMaritalStatus: "stable_union", hasChildrenUnder18: true, cpf: "123.456.789-09", email: "x@y.com", primaryMonthlyIncome: 8123.45 });
  const dto = buildPublicPresentation({ simulation: sim({ registration }), defaultReason: DEFAULT_REASON });
  const json = JSON.stringify(dto);
  for (const raw of ["registered_employment", "self_employed_unregistered", "income_tax_declarant", "stable_union", "divorced", "married", "widowed", "primaryIncomeType", "primaryMaritalStatus", "secondaryIncomeType", "hasChildrenUnder18", "has_children", "simulationType", "oldestBirthDate", "registration", "123.456.789-09", "x@y.com", "8123"]) {
    assert.ok(!json.includes(raw), `vazou: ${raw}`);
  }
  const doc = dto.scenes.find((scene) => scene.id === "documentos");
  assert.deepEqual(Object.keys(doc).sort(), [...PUBLIC_SCENE_FIELDS.documentos].sort());
  for (const item of doc.items) assert.deepEqual(Object.keys(item).sort(), ["description", "id", "lines", "title"]);
  // quem desenha (cena, folha, imagem) só recebe a lista final: nenhum acesso ao cadastro
  for (const file of ["components/presentation/DocumentsSheet.jsx", "components/presentation/PresentationPlayer.jsx", "lib/simulation-presentation-image.mjs", "lib/simulation-presentation-image-core.mjs", "app/apresentacao/[token]/page.jsx", "app/apresentacao/[token]/documentos/route.js"]) {
    assert.ok(!/primaryIncomeType|primaryMaritalStatus|hasChildrenUnder18|deriveDocumentProfile|\.registration\b/.test(code(file)), file);
  }
  // a derivação roda só na montagem das cenas (servidor)
  assert.ok(read("lib/simulation-presentation-core.mjs").includes("buildDocumentItemsFor(simulation.registration)"));
});

// ---------- (D) fluxo das cenas ----------
test("roteiro principal termina em próximo passo → validar → documentos; imóveis ficam no ramo (não no roteiro)", () => {
  const dto = buildPublicPresentation({ simulation: sim(), defaultReason: DEFAULT_REASON });
  assert.deepEqual(ids(dto.scenes), ["abertura", "poder", "formacao", "parcelas", "proximo", "validar", "documentos"]);
  assert.ok(!ids(dto.scenes).includes("imovel") && !ids(dto.scenes).includes("porque"));
  assert.equal(dto.branch.length, 1);
  const before = navigableSceneCount(dto.scenes, false);
  assert.equal(dto.scenes[before - 1].id, "proximo");
  // o auto-avanço PARA no próximo passo (com ou sem imóveis)
  const state = { ...createPlayerState(before), index: before - 1 };
  assert.equal(isLastScene(state), true);
  assert.equal(isAutoAdvancing(state), false);
  assert.equal(playerReducer(state, { type: "auto" }).index, before - 1);
});

test("botão dos imóveis: IMÓVEL SUGERIDO (1) · IMÓVEIS SUGERIDOS (2+) · sem imóvel não há botão", () => {
  assert.equal(propertiesButtonLabel(0), null);
  assert.equal(propertiesButtonLabel(undefined), null);
  assert.equal(propertiesButtonLabel(1), "IMÓVEL SUGERIDO");
  assert.equal(propertiesButtonLabel(2), "IMÓVEIS SUGERIDOS");
  assert.equal(propertiesButtonLabel(5), "IMÓVEIS SUGERIDOS");
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.match(player, /const propertiesLabel = propertiesButtonLabel\(propertyCount\)/);
  assert.match(player, /\{propertiesLabel \? \(/); // só aparece quando há imóvel
  assert.match(player, />\s*VALIDAR SIMULAÇÃO\s*</);
  assert.match(player, /label="Baixar apresentação"/);
  assert.ok(!/Falar com meu corretor|wa\.me/i.test(code("components/presentation/PresentationPlayer.jsx")));
});

test("ramo: N cenas, 'Continuar' no último, voltar do primeiro e continuar do último saem do ramo (volta ao próximo passo)", () => {
  assert.deepEqual(branchStep({ index: 0, total: 3 }, "next"), { index: 1, exit: false });
  assert.deepEqual(branchStep({ index: 1, total: 3 }, "next"), { index: 2, exit: false });
  assert.deepEqual(branchStep({ index: 2, total: 3 }, "next"), { index: 2, exit: true });
  assert.deepEqual(branchStep({ index: 2, total: 3 }, "prev"), { index: 1, exit: false });
  assert.deepEqual(branchStep({ index: 0, total: 3 }, "prev"), { index: 0, exit: true });
  assert.deepEqual(branchStep({ index: 0, total: 1 }, "next"), { index: 0, exit: true });
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.match(player, /\{last \? "Continuar" : "Próximo imóvel"\}/);
  assert.match(player, /Imóvel \$\{scene\.position\} de \$\{scene\.count\}/); // indicador só com N > 1
  assert.match(player, /const multi = scene\.count > 1/);
  // sair do ramo NÃO mexe no índice do roteiro principal: ele continua no próximo passo
  const step = /const stepBranch = useCallback\(\(action\) => \{([\s\S]*?)\}, \[\]\);/.exec(player)?.[1] || "";
  assert.match(step, /setBranchIndex\(null\)/);
  assert.ok(!/dispatch\(/.test(step));
  // sem relógio no ramo: quem avança é o cliente
  assert.match(player, /isAutoAdvancing\(state\) && !inBranch/);
});

test("ramo: foto grande em revelação, características em sequência escalonada e a mensagem de justificativa", () => {
  const player = read("components/presentation/PresentationPlayer.jsx");
  const scene = /function SceneImovel[\s\S]*?\n}\n/.exec(player)?.[0] || "";
  assert.match(scene, /styles\.photoReveal/);
  assert.match(scene, /800 \+ i \* 240/); // entrada escalonada
  assert.match(scene, /styles\.propReason/);
  assert.match(scene, /\{scene\.reason\}/);
  assert.match(read("components/presentation/presentation.module.css"), /@keyframes photoReveal/);
});

test("métricas: só as cenas do roteiro principal geram 'cena'; o ramo não gera evento; 'concluiu' ao chegar à cena de documentos", () => {
  const player = read("components/presentation/PresentationPlayer.jsx");
  const effect = /const result = sceneMetricEvents\([\s\S]*?\}, \[(.*?)\]\);/.exec(player)?.[1] || "";
  assert.equal(effect, "tracking, token, state.index, total");
  assert.ok(!/branchIndex/.test(effect));
  const dto = buildPublicPresentation({ simulation: sim(), defaultReason: DEFAULT_REASON });
  const total = dto.scenes.length;
  assert.deepEqual(sceneMetricEvents({ index: total - 1, total, maxReached: total - 1 }).events, [{ tipo: "cena", cena: total }, { tipo: "concluiu", cena: total }]);
  assert.equal(dto.scenes[total - 1].id, "documentos");
});

// ---------- (E) logo da Caixa sem pílula ----------
test("logo da Caixa: sem pílula branca, sem caixa/borda/fundo; direto sobre o fundo, bem maior, com halo nas cenas escuras", () => {
  const css = read("components/presentation/presentation.module.css");
  const rules = [...css.matchAll(/(^|\n)([^\n{}@/]*\.caixa[^\n{]*)\{([^}]*)\}/g)].map((match) => ({ selector: match[2].trim(), body: match[3] }));
  assert.ok(rules.length >= 2);
  for (const { selector, body } of rules) {
    assert.ok(!/background|border:|border-radius|box-shadow|padding/.test(body.replace(/aspect-ratio[^;]*;/, "")), `${selector} tem fundo/borda/caixa`);
  }
  assert.ok(!css.includes("caixaPill"));
  const logo = rules.find((rule) => rule.selector === ".caixaLogo");
  assert.match(logo.body, /width: calc\(var\(--cw\) \* 0\.52\)/); // 52% da largura útil
  assert.doesNotMatch(css, /.caixaLogo { filter: drop-shadow/);
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(!player.includes("caixaPill"));
  assert.match(player, /className=\{styles\.caixaLogo\}/);
  // PNG do resumo: nenhuma pílula branca em volta da logo
  const image = read("lib/simulation-presentation-image.mjs");
  const footer = /function logoFooter\(assets\) \{[\s\S]*?\n}\n/.exec(image)?.[0] || "";
  assert.ok(footer && !/backgroundColor|borderRadius|boxShadow|padding/.test(footer));
});

// ---------- (G) cabeçalho de duas linhas ----------
test("cabeçalho: MATHEUS MACHADO (negrito, espaçado) e CORRETOR DE IMÓVEIS (menor, azul claro) nas cenas e nas imagens", () => {
  assert.equal(BRAND_NAME, "MATHEUS MACHADO");
  assert.equal(BRAND_ROLE, "CORRETOR DE IMÓVEIS");
  assert.equal(BRAND_CRECI, "CRECI 323106");
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.match(player, /<strong>\{BRAND_NAME\}<\/strong>\s*<span>\{BRAND_ROLE\}<\/span>/);
  assert.ok(!player.includes("Matheus Machado Imóveis"));
  const css = read("components/presentation/presentation.module.css");
  assert.match(css, /\.brandText strong \{[^}]*font-weight: 800; letter-spacing: 0\.17em; text-transform: uppercase/);
  assert.match(css, /\.brandText span \{[^}]*letter-spacing: 0\.24em[^}]*color: var\(--accent\)/);
  const image = read("lib/simulation-presentation-image.mjs");
  assert.ok(!image.includes("MATHEUS MACHADO IMÓVEIS"));
  assert.match(image, /text\(BRAND_NAME[\s\S]*text\(BRAND_ROLE/);
});

// ---------- (F) ícone "+" ----------
test("'+' no eixo dos valores: item do fluxo (sem altura zero), mesmo respiro acima/abaixo, sem divisória por baixo", () => {
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.match(player, /styles\.rowsSoma/);
  assert.equal((player.match(/styles\.rowPart/g) || []).length, 2);
  const css = read("components/presentation/presentation.module.css");
  const plus = /\n\.plus \{([^}]*)\}/.exec(css)?.[1] || "";
  assert.ok(plus && !/height: 0/.test(plus));
  assert.match(plus, /justify-content: center/);
  assert.match(plus, /margin: calc\(var\(--u\) \* 2\) 0/); // simétrico
  assert.match(css, /\.rowsSoma \.rowPart \{[^}]*border-bottom: 0[^}]*align-items: center; text-align: center/);
  // desktop: valores e "+" na mesma coluna à esquerda
  assert.match(css, /\.rowsSoma \.rowPart \{ align-items: flex-start; text-align: left/);
  assert.match(css, /\.plus \{ justify-content: flex-start/);
});

// ---------- (A) imagem da lista de documentos ----------
test("imagem de documentos: sem faixa de rodapé e sem texto de WhatsApp/Instagram/contato (decisão do dono)", () => {
  const image = code("lib/simulation-presentation-image.mjs");
  const docs = image.slice(image.indexOf("function checkBox"), image.indexOf("// ---------- respostas ----------"));
  assert.ok(docs.length > 500);
  assert.ok(!/whatsapp|instagram|mhm\.machado|fale conosco|ENVIE AS FOTOS|SIGA NOSSO|PRIMEIRO PASSO|CONQUISTA/i.test(docs));
  assert.ok(!/logoFooter|caixa/i.test(docs), "a lista de documentos não tem rodapé nem logo da Caixa");
  for (const file of ["components/presentation/DocumentsSheet.jsx", "lib/simulation-presentation-documents.mjs"]) {
    assert.ok(!/instagram|mhm\.machado|fale conosco|ENVIE AS FOTOS|pelo whatsapp/i.test(code(file)), file);
  }
});

test("imagem de documentos: altura acompanha a lista (termina após o último item, com margem), largura 1080, proporção boa", () => {
  const full = buildDocumentItems({});
  const short = buildDocumentItems({ dependents: "nao", income: "formal", marital: "casamento" });
  const a = documentsImageSize(full);
  const b = documentsImageSize(short);
  assert.equal(a.width, 1080);
  assert.ok(a.height > b.height || b.height === 1350, "menos itens → imagem menor (ou o piso)");
  assert.ok(a.height >= 1350 && a.height <= 2000, `altura ${a.height}`);
  const ratio = a.height / a.width;
  assert.ok(ratio > 1.3 && ratio < 1.9, `proporção ${ratio}`);
  assert.ok(documentsImageSize([]).height >= 1350);
  assert.ok(estimateLines("DOCUMENTAÇÃO DE IDENTIDADE COM FOTO", { size: DOCUMENTS_LAYOUT.titleSize, width: 880 }) === 1);
  assert.ok(estimateLines("A".repeat(400).replace(/(.{10})/g, "$1 "), { size: 30, width: 880 }) > 3);
});

test("rotas de imagem: PNG 200 para cada perfil; cabeçalhos; o primeiro nome só no arquivo", async () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const registration of [undefined, reg({ primaryIncomeType: "self_employed_unregistered", primaryMaritalStatus: "divorced", hasChildrenUnder18: true }), reg({ hasChildrenUnder18: false })]) {
    const dto = buildPublicPresentation({ simulation: sim({ registration }), defaultReason: DEFAULT_REASON });
    const response = await renderDocumentsImage(dto, { download: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="lista-de-documentos-mariana.png"');
    assert.match(response.headers.get("cache-control"), /no-store/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.subarray(0, 8).equals(PNG));
    assert.equal(bytes.readUInt32BE(16), 1080);
    assert.equal(bytes.readUInt32BE(20), documentsImageSize(getDocumentItems(dto)).height);
  }
  // resumo com 2 imóveis (rótulo no plural) continua gerando
  const two = sim();
  two.properties.push({ customName: "Condomínio Segundo", benefits: [] });
  const summary = await renderSummaryImage(buildPublicPresentation({ simulation: two, defaultReason: DEFAULT_REASON }), { download: false });
  assert.equal(summary.status, 200);
  assert.match(read("app/apresentacao/[token]/documentos/route.js"), /if \(!dto\) return new Response\("Não encontrado\.", \{ status: 404/);
});

// ---------- folha da cena ----------
test("folha 'Lista de documentos': mesma lista do DTO, caixa de marcar em SVG e nada de rodapé", () => {
  const sheet = read("components/presentation/DocumentsSheet.jsx");
  assert.match(sheet, /export default function DocumentsSheet\(\{ items = \[\], onClose \}\)/);
  assert.match(sheet, /<svg viewBox="0 0 24 24">/); // ✓ desenhado, não glifo
  assert.ok(!/✓|✔|☑/.test(sheet));
  assert.match(read("components/presentation/PresentationPlayer.jsx"), /<DocumentsSheet items=\{current\.items\}/);
});

// ---------- imagem-resumo ----------
test("resumo em imagem: rótulo singular/plural dos imóveis sugeridos e nomes vindos só do ramo", () => {
  const one = buildSummaryImageModel(buildPublicPresentation({ simulation: sim(), defaultReason: DEFAULT_REASON }));
  assert.equal(one.propertyLabel, "IMÓVEL SUGERIDO");
  const many = sim();
  many.properties.push({ customName: "B", benefits: [] }, { customName: "C", benefits: [] }, { customName: "D", benefits: [] });
  const model2 = buildSummaryImageModel(buildPublicPresentation({ simulation: many, defaultReason: DEFAULT_REASON }));
  assert.equal(model2.propertyLabel, "IMÓVEIS SUGERIDOS");
  assert.equal(model2.propertyNames.length, 3);
  assert.equal(model2.propertyMore, 1);
  const none = buildSummaryImageModel(buildPublicPresentation({ simulation: sim({ properties: [] }), defaultReason: DEFAULT_REASON }));
  assert.equal(none.propertyLabel, "");
  assert.deepEqual(none.propertyNames, []);
});

test("buildPresentationScenes continua devolvendo só o roteiro principal (contagem do CRM)", () => {
  assert.equal(buildPresentationScenes({ simulation: sim() }).length, 7);
});

// ---------- observação (obs) do estado civil: DTO, PNG e folha ----------
test("obs do divorciado: vai no DTO só como texto final, entra na altura do PNG (1 e 2 linhas) e a folha a renderiza", async () => {
  const dto = buildPublicPresentation({ simulation: sim({ registration: reg({ primaryMaritalStatus: "divorced" }) }), defaultReason: DEFAULT_REASON });
  const civil = byId(getDocumentItems(dto), "estado-civil");
  assert.equal(civil.description, "Certidão de casamento");
  assert.equal(civil.obs, "Com averbação do divórcio");
  const plain = { id: "x", title: "COMPROVANTE DE ESTADO CIVIL", description: "Certidão de casamento", lines: [] };
  assert.ok(documentItemHeight({ ...plain, obs: "Com averbação do divórcio" }) > documentItemHeight(plain));
  const long = "Com averbação do divórcio, emitida há no máximo 90 dias, com carimbo do cartório e assinatura do oficial responsável pelo registro";
  assert.ok(documentItemHeight({ ...plain, obs: long }) > documentItemHeight({ ...plain, obs: "Com averbação do divórcio" }));
  for (const obs of ["Com averbação do divórcio", long]) {
    const png = await renderDocumentsImage({ scenes: [{ id: "documentos", items: [{ ...plain, obs }] }], firstName: "Ana" }, { download: false });
    assert.equal(png.status, 200);
  }
  assert.ok(code("components/presentation/DocumentsSheet.jsx").includes("item.obs"));
  for (const status of ["single", "married", "stable_union"]) {
    const other = buildPublicPresentation({ simulation: sim({ registration: reg({ primaryMaritalStatus: status }) }), defaultReason: DEFAULT_REASON });
    assert.equal(byId(getDocumentItems(other), "estado-civil").obs, "");
  }
});
