import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../selectors.js";

const { MP } = globalThis;

test("comparação por texto ignora acento e caixa", () => {
  assert.equal(MP.matchesAny("PREÇO", ["Preco"], true), true);
  assert.equal(MP.matchesAny("Imóveis para venda ou aluguel  ", MP.categoryCard), true);
  assert.equal(MP.matchesAny("Casa geminada", ["Casa"], true), false);
  assert.equal(MP.matchesAny("", ["x"]), false);
});

test("checkpoint por URL ou por texto", () => {
  assert.equal(MP.isCheckpoint("https://www.facebook.com/checkpoint/123", ""), true);
  assert.equal(MP.isCheckpoint("https://www.facebook.com/marketplace/create/rental", "Você atingiu o limite de publicações"), true);
  assert.equal(MP.isCheckpoint("https://www.facebook.com/marketplace/create/rental", "Preço Descrição"), false);
});

test("link do anúncio limpo", () => {
  assert.equal(MP.cleanListingUrl("/marketplace/item/987654/?ref=x"), "https://www.facebook.com/marketplace/item/987654/");
  assert.equal(MP.cleanListingUrl("https://www.facebook.com/marketplace/you/selling"), "");
});

test("todos os campos e opções usados pelo content.js existem em selectors.js", () => {
  for (const key of ["offerType", "propertyType", "bedrooms", "bathrooms", "price", "location", "description", "area", "iptu", "condoFee", "parkingSpaces", "boost"]) assert.ok(MP.fields[key]?.labels?.length, key);
  for (const key of ["sale", "rent"]) assert.ok(MP.fields.offerType.options[key].length);
  for (const key of ["house", "apartment", "townhouse", "land"]) assert.ok(MP.fields.propertyType.options[key].length);
  const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
  assert.doesNotMatch(content, /querySelector(All)?\(\s*["'`][^"'`]*\.(x|_)[a-z0-9]{4,}/, "content.js não pode usar classe CSS gerada do Facebook");
});

test("manifest MV3 com permissões mínimas", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.deepEqual(manifest.host_permissions.sort(), ["https://*.supabase.co/*", "https://www.facebook.com/*", "https://www.matheusmachadoimoveis.com.br/*"]);
  assert.doesNotMatch(manifest.name, /Matheus Machado Imóveis/);
});

// Textos do formulário real do dono (prints de 2026-10-20, Facebook Brasil).
test("calibrado ao formulário real: cartão, título do formulário, campos", () => {
  assert.equal(MP.matchesAny("Imóvel residencial para venda ou locação Anuncie um imóvel para venda ou locação.", MP.categoryCard), true);
  assert.equal(MP.matchesAny("Item para venda Crie um único anúncio", MP.categoryCard), false);
  assert.equal(MP.matchesAny("Veículo para venda", MP.categoryCard), false);
  assert.equal(MP.matchesAny("Marketplace Novo classificado de imóvel Salvar rascunho", MP.formTitle), true);
  // O combobox de venda/locação é achado pelo valor inicial que ele mostra.
  assert.equal(MP.matchesAny("Imóvel residencial para venda ou locação", MP.fields.offerType.labels), true);
  for (const [field, text] of [["bedrooms", "Número de quartos"], ["bathrooms", "Número de banheiros"], ["price", "Preço"], ["description", "Descrição do imóvel"], ["area", "Metros quadrados"], ["iptu", "Imposto Predial e Territorial Urbano"], ["condoFee", "Condomínio"], ["parkingSpaces", "Vagas de estacionamento"], ["propertyType", "Tipo de imóvel"], ["boost", "Turbinar classificado após a publicação"]]) {
    assert.equal(MP.matchesAny(text, MP.fields[field].labels, true), true, field);
  }
  assert.equal(MP.fields.title, undefined, "o formulário de imóvel não tem Título");
  assert.ok(MP.fields.area.optional && MP.fields.iptu.optional && MP.fields.condoFee.optional && MP.fields.parkingSpaces.optional);
});

test("nunca escolhe a opção 'venda ou locação' nem clica em rascunho/turbinar", () => {
  const excluded = (text) => MP.fields.offerType.excludeOptions.some((part) => ` ${MP.normalize(text)} `.includes(part));
  assert.equal(excluded("Imóvel residencial para venda ou locação"), true);
  assert.equal(excluded("Venda"), false);
  assert.equal(excluded("Locação"), false);
  assert.equal(MP.matchesAny("Salvar rascunho", MP.buttons.forbidden), true);
  assert.equal(MP.matchesAny("Turbinar classificado após a publicação", MP.buttons.forbidden), true);
  assert.equal(MP.matchesAny("Salvar rascunho", MP.buttons.publish, true), false);
});

test("vagas: 0 a 3 exatos, 4 ou mais", () => {
  assert.deepEqual(MP.fields.parkingSpaces.optionsFor(2), ["2"]);
  assert.ok(MP.fields.parkingSpaces.optionsFor(6).includes("4+"));
  assert.ok(MP.fields.parkingSpaces.optionsFor(0).includes("0"));
});

test("content.js: sem título, turbinar desligado, ordem do formulário", () => {
  const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
  assert.doesNotMatch(content, /fillText\("title"/);
  assert.match(content, /ensureBoostOff\(\)/);
  const order = ["uploadPhotos(photos)", 'chooseOption("offerType"', 'chooseOption("propertyType"', 'fillText("bedrooms"', 'fillText("bathrooms"', 'fillText("price"', "fillLocation(listing)", 'fillText("description"', 'fillText("area"', 'fillText("iptu"', 'fillText("condoFee"', 'chooseOption("parkingSpaces"', "ensureBoostOff()"];
  const body = content.slice(content.indexOf("async function publish("));
  const positions = order.map((needle) => body.indexOf(needle));
  assert.ok(positions.every((position) => position > 0), "todos os passos presentes");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "na ordem do formulário");
});

test("background: aba dedicada, navegação esperando carregar, reinjeção e aba fechada no fim", () => {
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /chrome\.tabs\.create\(\{ url: "about:blank"/);
  // Nunca mexe nas abas do dono. Única exceção (1.8.10, focusTab): saber qual aba estava ativa para devolver o
  // foco a ela depois de mostrar a aba dedicada durante a abertura de uma conversa.
  const queries = bg.match(/chrome\.tabs\.query\([^)]*\)/g) || [];
  assert.deepEqual(queries, ["chrome.tabs.query({ active: true, windowId: tab.windowId })"], "nunca mexe nas abas do dono");
  assert.match(bg, /if \(previous\?\.id && previous\.id !== tabId\) await chrome\.tabs\.update\(previous\.id, \{ active: true \}\)/);
  assert.match(bg, /PAGE_LOAD_TIMEOUT_MS = 45 \* 1000/);
  assert.match(bg, /marketplace\/create\/rental/);
  assert.match(bg, /target: "card"/);
  assert.match(bg, /target: "create"/);
  assert.match(bg, /Páginas atingidas/);
  assert.match(bg, /chrome\.tabs\.remove\(tab\.id\)/);
  const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
  assert.doesNotMatch(content, /location\.assign/, "quem navega é o background");
  assert.match(content, /progress\("clicou publicar"\)/);
  assert.ok(MP.matchesAny("+ Criar novo classificado", MP.createLink));
});

// Lista real de sugestões do print de 2026-10-20 (2ª tentativa).
const REAL_SUGGESTIONS = [
  "Barriga Verde, Rua Rio Grande do Sul, 155, Marília - SP, 17509-130, Brasil\nBarriga Verde, Rua Rio Grande do Sul, 155, Marília - SP, 17509-130, Brasil",
  "17516-000 Marília, SP\nCidade",
  "Marília\n139.230 número",
  "Osasco, SP\nOsasco, SP · 15.642 número",
  "Marília, SP\nCidade",
  "Marília, SP\nCidade",
  "Avenida Vitória Regia, 692, Marília - SP, 17532-046, Brasil\nEstr. Mun. Danilo Gonzáles 693 · Marília, SP · 232 número"
];

test("localização: escolhe 'Marília, SP · Cidade', não rua, CEP nem outra cidade", () => {
  assert.equal(MP.pickLocationIndex(REAL_SUGGESTIONS), 4);
  assert.equal(MP.pickLocationIndex(["Marília, SP\nMarília, SP · 1.576 número", "Osasco, SP\nCidade"]), 0);
  // Sem o estado não dá para garantir que é a cidade de SP: não escolhe.
  assert.equal(MP.pickLocationIndex(["Marília\n139.230 número", "Osasco, SP\nCidade"]), -1);
  assert.equal(MP.pickLocationIndex(["Osasco, SP\nCidade"]), -1);
});

test("bairro limpo também na extensão; nunca digita o bairro na localização", () => {
  assert.equal(MP.cleanNeighborhood("Terra Verde · Marília/SP"), "Terra Verde");
  const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
  const fill = content.slice(content.indexOf("async function fillLocation("), content.indexOf("function emptyRequiredFields("));
  assert.match(fill, /for \(const typed of \[listing\.city, `\$\{listing\.city\}, \$\{listing\.state\}`\]\)/);
  assert.doesNotMatch(fill, /neighborhood/);
  assert.match(fill, /ArrowDown/);
  assert.match(fill, /locationChosen/);
  assert.doesNotMatch(content, /bathrooms \|\| 1/, "sem padrão de 1 banheiro (dono, 2026-10-20)");
  assert.match(content, /if \(!listing\.bathrooms\) throw new StepError\("banheiros"/);
  assert.match(content, /Campos vazios:/);
});

test("Verificar agora responde na hora (antes de publicar) e o popup mostra o motivo", () => {
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /tick\("manual", resolve\)/);
  assert.match(bg, /onDecision\(\{ reason: "publicando"/);
  const popup = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  assert.match(popup, /REASON_LABELS\.verificando/);
  assert.match(popup, /describeCheck\(result\?\.reason, result\?\.waitUntil\)/);
});

// "DOM falso": objetos com innerText/outerHTML como os do Facebook (espaço não separável, spans aninhados).
const fakeOption = (text, html = `<div role="option" class="x1" data-id="9"><span><span>${text}</span></span></div>`) => ({ innerText: text, textContent: text.replace(/\n/g, ""), outerHTML: html });

test("localização (3ª tentativa real): acha a cidade com espaço não separável, 'São Paulo' e texto quebrado", () => {
  const options = [
    fakeOption("Barriga Verde, Rua Rio Grande do Sul, 155, Marília - SP, 17509-130, Brasil"),
    fakeOption("17516-000 Marília, SP\nCidade"),
    fakeOption("Marília\n139.230 número"),
    fakeOption("Marília, SP\nCidade"),
    fakeOption("Marília, São Paulo\nCidade")
  ];
  assert.equal(MP.pickLocationIndex(options.map((o) => o.innerText)), 3);
  assert.equal(MP.pickLocationIndex(["Rua X, 10, Marília - SP", "Marília, São Paulo\nCidade"]), 1);
  assert.equal(MP.pickLocationIndex(["Rua X, 10, Marília - SP", "Marília, São Paulo"]), 1);
  assert.equal(MP.pickLocationIndex(["Marília\u200b,\u202fSP\nCidade"]), 0);
  assert.equal(MP.pickLocationIndex(["Mariliana, PR\nCidade", "Marília\n139 número"]), -1);
  assert.equal(MP.pickLocationIndex(["Mariliana, PR\nCidade", "Marília\nSão Paulo · 139 número"]), 1);
  assert.equal(MP.normalize("Marília, SP"), "marilia, sp");
});

test("diagnóstico: 5 primeiras opções e HTML da 1ª sem atributos", () => {
  const text = MP.describeOptions(Array.from({ length: 7 }, (_, i) => fakeOption(`Opção ${i + 1}\nCidade`)));
  assert.match(text, /^7 sugestões\. Primeiras: 1\) Opção 1 Cidade \| 2\)/);
  assert.match(text, /5\) Opção 5/);
  assert.doesNotMatch(text, /6\) Opção 6/);
  assert.match(text, /HTML da 1ª: <div role="option"><span><span>/);
  assert.doesNotMatch(text, /class=|data-id/);
  assert.equal(MP.describeOptions([]), "0 sugestões. Primeiras: nenhuma.");
});

test("entrada confiável: depurador ligado na aba dedicada, desligado no fim; localização usa cliques/teclas reais", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.permissions.includes("debugger"));
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /chrome\.debugger\.attach\(\{ tabId \}, "1\.3"\)/);
  assert.match(bg, /Input\.dispatchMouseEvent/);
  assert.match(bg, /Input\.dispatchKeyEvent/);
  assert.match(bg, /Input\.insertText/);
  const run = bg.slice(bg.indexOf("async function runPublication("));
  assert.ok(run.indexOf("detachDebugger(tab.id)") < run.indexOf("chrome.tabs.remove(tab.id)"));
  assert.match(bg, /recoverInterruptedRun/);
  const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
  const fill = content.slice(content.indexOf("async function fillLocation("), content.indexOf("function emptyRequiredFields("));
  assert.match(content, /if \(!\(await trusted\("text", \{ text: char \}\)\)\)/);
  assert.match(fill, /key\(control, "ArrowDown"\)/);
  assert.match(fill, /MP\.describeOptions/);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /depurar este navegador/);
});

// Print do dono (2026-10-20): a extensão escolheu "Rua Marília, Vera Cruz - SP, Brasil".
test("localização: nunca rua/avenida/bairro com o nome da cidade; só a CIDADE Marília, SP", () => {
  const options = [
    "Rua Marília, Vera Cruz - SP, Brasil\nRua Marília, Vera Cruz - SP, Brasil",
    "Avenida Marília, 100, Tupã - SP",
    "Bairro Marília, Assis - SP",
    "Marília\n139.230 número",
    "Marília, SP\nCidade"
  ];
  assert.equal(MP.pickLocationIndex(options), 4);
  assert.equal(MP.pickLocationIndex(options.slice(0, 4)), -1, "sem a cidade na lista: não escolhe nada");
  assert.equal(MP.isCityOption("Rua Marília, Vera Cruz - SP, Brasil"), false);
  assert.equal(MP.isCityOption("Marília, São Paulo"), true);
  assert.equal(MP.isCityOption("Marília\nSão Paulo, Brasil"), true);
  assert.equal(MP.isConfirmedCity("Marília, SP"), true);
  assert.equal(MP.isConfirmedCity("Marília, São Paulo, Brasil"), true);
  assert.equal(MP.isConfirmedCity("Rua Marília, Vera Cruz - SP, Brasil"), false);
  assert.equal(MP.isConfirmedCity("Marília"), false);
  const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
  assert.match(content, /Localização não confirmada/);
  assert.match(content, /MP\.isConfirmedCity\(control\.value/);
});

// Lista do print do dono (2026-10-20): só os de Marília/imóveis/classificados entram.
const GROUPS_ON_SCREEN = [
  "CLÁSSIFICADOS DE VENDAS MARILIA-SP",
  "Ecosport Clube Brasil",
  "Venda e Troca de Casas Marília SP",
  "Classificados Ivaiporã",
  "Alugue e Compre imóveis Marilia SP",
  "Imóveis São Carlos",
  "VENDA EM MARILIA",
  "Peças de veículos usadas",
  "Desapegos Marília e região",
  "Brechó Online"
];
const WANTED = ["CLÁSSIFICADOS DE VENDAS MARILIA-SP", "venda e troca de casas Marília sp", "Alugue e Compre imóveis Marilia SP", "VENDA EM MARILIA", "Desapegos Marília e região."];

test("grupos: marca só os da lista do CRM (acento/caixa/pontuação), nunca outras cidades/temas", () => {
  const { select, missing } = MP.matchGroups(GROUPS_ON_SCREEN, WANTED);
  assert.deepEqual(select.map((item) => GROUPS_ON_SCREEN[item.index]), ["CLÁSSIFICADOS DE VENDAS MARILIA-SP", "Venda e Troca de Casas Marília SP", "Alugue e Compre imóveis Marilia SP", "VENDA EM MARILIA", "Desapegos Marília e região"]);
  assert.deepEqual(missing, []);
  for (const other of ["Ecosport Clube Brasil", "Classificados Ivaiporã", "Imóveis São Carlos", "Peças de veículos usadas", "Brechó Online"]) {
    assert.ok(!select.some((item) => GROUPS_ON_SCREEN[item.index] === other), other);
  }
  const partial = MP.matchGroups(["VENDA EM MARILIA"], WANTED);
  assert.equal(partial.select.length, 1);
  assert.equal(partial.missing.length, 4, "grupo não encontrado não bloqueia: só vira 'não encontrado'");
  assert.equal(MP.matchGroups(GROUPS_ON_SCREEN, WANTED, 2).select.length, 2, "respeita o limite");
  // Nome parecido não é o mesmo grupo.
  assert.equal(MP.matchGroups(["VENDA EM MARILIA E REGIÃO"], ["VENDA EM MARILIA"]).select.length, 0);
});

test("publicação: marca grupos antes de Publicar e manda o resultado ao CRM", () => {
  const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
  const body = content.slice(content.indexOf("async function publish("));
  assert.ok(body.indexOf("selectGroups(listing.groups") < body.indexOf('progress("publicar")'));
  assert.match(content, /groups: groupsResult/);
  assert.match(content, /if \(isChecked\(box\)\) selected\.push\(\{ name, members \}\)/, "confere que ficou marcado e guarda os membros");
});

test("grupos: lê o nº de membros como o Facebook mostra", () => {
  assert.equal(MP.parseMembers("VENDA EM MARILIA\n12 mil membros · 10+ publicações por dia"), "12 mil membros");
  assert.equal(MP.parseMembers("Imoveis Marilia\n1,2 mil membros"), "1,2 mil membros");
  assert.equal(MP.parseMembers("Grupo\n3.456 membros"), "3.456 membros");
  assert.equal(MP.parseMembers("Group\n15K members"), "15K members");
  assert.equal(MP.parseMembers("Sem contagem"), "");
});

test("lista completa do dono (15 grupos) bate com a tela, inclusive com hífen e pontuação diferentes", () => {
  const wanted = ["Alugue e Compre imóveis Marilia SP", "venda e troca de casas Marília sp", "Imoveis - Marília e Região", "Imoveis Marilia", "VENDA E LOCAÇÃO, IMOVEIS EM MARILIA-SP", "Aluguel e Venda de Imóveis-Marilia", "Vende-se e Aluga-se Imóveis em Marília", "CLÁSSIFICADOS DE VENDAS MARILIA-SP", "Desapegos Marília e região.", "Marília compra e venda", "Classifacil - Classificados Marília", "Vende Tudo Marília - Compra, Venda e Troca", "Compra, Vende, Troca - Marília", "compras e vendas Marília.", "VENDA EM MARILIA"];
  const screen = ["Imóveis - Marília e região", "VENDA E LOCAÇÃO IMÓVEIS EM MARÍLIA SP", "Ecosport Clube Brasil", "Compra Vende Troca Marília", "Classificados Ivaiporã"];
  const { select, missing } = MP.matchGroups(screen, wanted);
  assert.deepEqual(select.map((item) => screen[item.index]), ["Imóveis - Marília e região", "VENDA E LOCAÇÃO IMÓVEIS EM MARÍLIA SP", "Compra Vende Troca Marília"]);
  assert.equal(missing.length, 12);
});
