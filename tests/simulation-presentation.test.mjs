// Apresentação interativa da simulação (/s/<token>) — regras puras, DTO público, rotas e proteção do PDF.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  EVENT_TYPES,
  PRESENTATION_TOKEN_LENGTH,
  PUBLIC_BRANCH_FIELDS,
  PUBLIC_SCENE_FIELDS,
  buildPresentationScenes,
  buildPropertyBranch,
  buildPublicPresentation,
  createRateLimiter,
  firstNameOf,
  generatePresentationToken,
  isLikelyBot,
  isPresentationSchemaMissing,
  isPresentationToken,
  parsePresentationEvent,
  safeImageUrl,
  sceneDurationMs
} from "../lib/simulation-presentation-core.mjs";
import { formatBRL, formatDateBR } from "../lib/simulation-presentation-format.mjs";
import { getRenderableSimulationModels, simulationModelHasValues } from "../lib/simulation-models.js";
import { buildPresentationModel } from "../lib/simulacao-entrada/presentation-model.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const norm = (text) => String(text).replace(/ /g, " ");
const DEFAULT_REASON = "Este imóvel foi selecionado buscando reduzir ao máximo o desembolso inicial da compra e proporcionar o melhor aproveitamento das condições disponíveis.";

const same = { financingValue: 190000, subsidyValue: 42000, firstInstallment: 1085.4, lastInstallment: 812.15 };

// Simulação "suja" de propósito: tudo que NÃO pode sair no link público.
function sensitiveSimulation(over = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    registrationId: "99999999-8888-7777-6666-555555555555",
    clientName: "Mariana Souza Lima",
    clientWhatsApp: "14999887766",
    createdByUserId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    createdBy: "corretor@secreto.com",
    simulationDate: "2026-10-03",
    publicNote: "NOTA-PUBLICA-NAO-SAI",
    internalNote: "NOTA-INTERNA-SECRETA 14999887766",
    simulationType: "novo",
    simulationModels: { novo: { ...same }, usado: { ...same } },
    downPaymentValue: 5000,
    fgtsValue: 7000,
    registration: {
      id: "99999999-8888-7777-6666-555555555555",
      fullName: "Mariana Souza Lima",
      cpf: "123.456.789-09",
      phone: "14999887766",
      email: "mariana@cliente.com",
      oldestBirthDate: "1990-02-03",
      address: "Rua Secreta 100",
      primaryMonthlyIncome: 8123.45,
      status: "approved",
      responsibleUserId: "rrrrrrrr-0000-0000-0000-000000000000"
    },
    properties: [
      {
        id: "pppppppp-0000-0000-0000-000000000000",
        propertyId: "empreendimento-interno-id",
        customName: "Residencial Aurora",
        customPrice: "R$ 999.999",
        customTerms: "REGRAS-INTERNAS-NAO-SAEM",
        customDiscounts: "DESCONTO-INTERNO-NAO-SAI",
        customSalesText: "TEXTO-VENDA-INTERNO",
        internalNotes: "NOTAS-INTERNAS-EMPREENDIMENTO",
        regras: { teto: 1 },
        imageUrl: "https://cdn.exemplo.com/foto.jpg",
        benefits: [{ id: "bbb", text: "Varanda gourmet" }, { text: "Lazer completo" }],
        recommendationReason: "Fica perto da escola dos filhos e cabe no orçamento."
      }
    ],
    ...over
  };
}
const ids = (scenes) => scenes.map((scene) => scene.id);

// ---------- token ----------
test("token: 24 caracteres base62, >= 128 bits, aleatório e com as 3 classes", () => {
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    const token = generatePresentationToken();
    assert.equal(token.length, PRESENTATION_TOKEN_LENGTH);
    assert.ok(PRESENTATION_TOKEN_LENGTH * Math.log2(62) >= 128);
    assert.match(token, /^[A-Za-z0-9]{24}$/);
    assert.ok(isPresentationToken(token));
    assert.ok(!seen.has(token), "token repetido");
    seen.add(token);
  }
});

test("token nunca é id interno (UUID) nem ref curto de corretor", () => {
  const uuid = "11111111-2222-3333-4444-555555555555";
  assert.equal(isPresentationToken(uuid), false);
  assert.equal(isPresentationToken(uuid.replaceAll("-", "")), false);
  for (const ref of ["mhm", "1", "equipe", "carlos-silva", "abcdefghijklmnopqrstuvwx"]) assert.equal(isPresentationToken(ref), false, ref);
  assert.equal(isPresentationToken("abcdefghijklmnopqrstuvwx"), false); // 24 minúsculas = poderia ser ref de corretor
  assert.equal(isPresentationToken("AbCdEfGhIjKlMnOpQrStUv1"), false); // 23
  assert.equal(isPresentationToken(null), false);
});

test("token: bytes >= 248 são descartados (sem viés) e a fonte é injetável", () => {
  let call = 0;
  const fake = () => {
    call += 1;
    const bytes = new Uint8Array(48).fill(255); // todos descartados
    if (call > 2) for (let i = 0; i < 48; i += 1) bytes[i] = (i * 7 + call) % 248;
    return bytes;
  };
  const token = generatePresentationToken(fake);
  assert.ok(isPresentationToken(token));
  assert.ok(call >= 3);
});

test("proxy.js: só o formato do token é reescrito; ref curto, admin e api seguem iguais", () => {
  const source = read("proxy.js");
  const literal = /const PRESENTATION_TOKEN_PATH = (\/.*\/);/.exec(source)?.[1];
  assert.ok(literal, "regex do token no proxy");
  const pattern = new RegExp(literal.slice(1, -1));
  for (let i = 0; i < 100; i += 1) assert.ok(pattern.test(`/s/${generatePresentationToken()}`));
  for (const nonToken of ["/s/mhm", "/s/1", "/s", "/s/abcdefghijklmnopqrstuvwx", "/s/AbCdEfGhIjKlMnOpQrStUv12/extra", "/s/ABCDEFGHIJKLMNOPQRSTUVWX"]) {
    assert.equal(pattern.test(nonToken), false, nonToken);
  }
  assert.match(source, /NextResponse\.rewrite\(target\)/);
  assert.match(source, /noindex, nofollow, noarchive/);
  assert.match(source, /Referrer-Policy", "no-referrer"/);
  assert.match(source, /Cache-Control", "no-store, max-age=0"/);
  // não exige login para /s ou /apresentacao e não afrouxou o resto
  assert.match(source, /isAdminPath && !isPublicAdminPath\(pathname\)/);
  assert.match(source, /PUBLIC_ADMIN_PATHS = \["\/admin\/login", "\/admin\/reset-password"\]/);
  assert.match(source, /matcher: \["\/admin\/:path\*", "\/api\/:path\*", "\/academia\/:path\*", "\/s\/:path\*", "\/apresentacao\/:path\*"\]/);
});

// ---------- formatação ----------
test("formatação pt-BR: R$ 232.000,00", () => {
  assert.equal(norm(formatBRL(232000)), "R$ 232.000,00");
  assert.equal(norm(formatBRL(1085.4)), "R$ 1.085,40");
  assert.equal(norm(formatBRL(0)), "R$ 0,00");
  assert.equal(norm(formatBRL("abc")), "R$ 0,00");
  assert.equal(formatDateBR("2026-10-03"), "03/10/2026");
  assert.equal(formatDateBR("2026-10-03T02:00:00.000Z"), "03/10/2026");
  assert.equal(formatDateBR(""), "");
});

// ---------- DTO público (allowlist) ----------
test("DTO público: nenhum dado sensível sai; só o primeiro nome", () => {
  const dto = buildPublicPresentation({ simulation: sensitiveSimulation(), defaultReason: DEFAULT_REASON });
  const json = JSON.stringify(dto);
  for (const forbidden of [
    "Souza", "Lima", "123.456.789-09", "14999887766", "mariana@cliente.com", "1990-02-03", "Rua Secreta", "8123", "NOTA-INTERNA", "NOTA-PUBLICA",
    "REGRAS-INTERNAS", "DESCONTO-INTERNO", "TEXTO-VENDA", "NOTAS-INTERNAS-EMPREENDIMENTO", "empreendimento-interno-id", "approved", "corretor@secreto.com",
    "11111111-2222", "99999999-8888", "aaaaaaaa-bbbb", "rrrrrrrr", "pppppppp", "R$ 999.999", "registration", "cpf", "email", "internalNotes", "regras", "status"
  ]) {
    assert.ok(!json.includes(forbidden), `vazou: ${forbidden}`);
  }
  assert.deepEqual(Object.keys(dto), ["version", "scenes", "branch"]);
  for (const scene of dto.scenes) {
    const allowed = PUBLIC_SCENE_FIELDS[scene.id];
    assert.ok(allowed, `cena sem allowlist: ${scene.id}`);
    for (const key of Object.keys(scene)) assert.ok(allowed.includes(key), `${scene.id} expôs campo fora da allowlist: ${key}`);
  }
  assert.ok(dto.branch.length > 0);
  for (const scene of dto.branch) for (const key of Object.keys(scene)) assert.ok(PUBLIC_BRANCH_FIELDS.includes(key), `ramo expôs campo fora da allowlist: ${key}`);
  assert.equal(dto.scenes[0].firstName, "Mariana");
  assert.equal(firstNameOf("  Ana   Clara Souza "), "Ana");
  assert.equal(firstNameOf(""), "");
});

test("DTO público: sem botão/telefone do corretor (removido no round 2): nenhum wa.me nem broker no DTO", () => {
  // mesmo que alguém ainda passe um "broker" para a função, ele é ignorado
  const dto = buildPublicPresentation({ simulation: sensitiveSimulation(), broker: { firstName: "Carlos", whatsappUrl: "https://wa.me/5514911112222" }, defaultReason: DEFAULT_REASON });
  const json = JSON.stringify(dto);
  assert.ok(!/wa\.me|whatsapp|broker|Carlos|5514911112222/i.test(json));
  for (const scene of dto.scenes) assert.ok(!("broker" in scene));
});

test("imagem: só https ou caminho do próprio site; nunca data:, javascript: nem a imagem-padrão", () => {
  assert.equal(safeImageUrl("https://cdn.exemplo.com/a.jpg"), "https://cdn.exemplo.com/a.jpg");
  assert.equal(safeImageUrl("/assets/foto.jpg"), "/assets/foto.jpg");
  for (const bad of ["data:image/png;base64,AAAA", "javascript:alert(1)", "//evil.com/a.png", "http://x.com/a.png", "/assets/hero-marilia.png", "", null]) {
    assert.equal(safeImageUrl(bad), "", String(bad));
  }
});

// ---------- seleção de cenas ----------
test("cenas: roteiro principal (os imóveis sugeridos NÃO entram: vivem no ramo opcional)", () => {
  const scenes = buildPresentationScenes({ simulation: sensitiveSimulation(), defaultReason: DEFAULT_REASON });
  assert.deepEqual(ids(scenes), ["abertura", "poder", "formacao", "parcelas", "proximo", "validar", "documentos"]);
  assert.equal(scenes[2].mode, "soma");
  assert.ok(!("modelLabel" in scenes[1]), "sem rótulo de modelo");
  assert.equal(scenes.find((scene) => scene.id === "proximo").dateLabel, "03/10/2026");
});

test("cenas: subsídio R$ 0 → financiamento como valor total, sem destacar zero", () => {
  const sim = sensitiveSimulation({ simulationModels: { novo: { ...same, subsidyValue: 0 }, usado: { ...same, subsidyValue: 0 } } });
  const formacao = buildPresentationScenes({ simulation: sim, defaultReason: DEFAULT_REASON }).find((scene) => scene.id === "formacao");
  assert.equal(formacao.mode, "financiamento");
  assert.equal(formacao.total, 190000);
  assert.equal(formacao.subsidy, 0);
  // o componente usa só `mode` e `total` neste caso; o texto do player nunca cita o valor zero (ver teste do player)
  const onlySubsidy = sensitiveSimulation({ simulationModels: { novo: { ...same, financingValue: 0 }, usado: { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" } } });
  assert.equal(buildPresentationScenes({ simulation: onlySubsidy }).find((scene) => scene.id === "formacao").mode, "subsidio");
});

test("cenas: só o SUBSÍDIO diferente entre novo e usado gera a cena de diferença; financiamento/parcela diferentes não", () => {
  const diff = sensitiveSimulation({ simulationModels: { novo: { ...same }, usado: { ...same, financingValue: 150000, subsidyValue: 0 } } });
  const scenes = buildPresentationScenes({ simulation: diff, defaultReason: DEFAULT_REASON });
  assert.ok(ids(scenes).includes("diferenca"));
  assert.ok(ids(scenes).indexOf("diferenca") > ids(scenes).indexOf("parcelas"));
  const scene = scenes.find((item) => item.id === "diferenca");
  assert.deepEqual({ novo: scene.novo, usado: scene.usado, difference: scene.difference, scenario: scene.scenario }, { novo: 42000, usado: 0, difference: 42000, scenario: "novo" });
  // só a parcela/financiamento diferente NÃO conta: a única diferença apresentada é o subsídio
  const onlyInstallment = sensitiveSimulation({ simulationModels: { novo: { ...same }, usado: { ...same, lastInstallment: 700, financingValue: 100000 } } });
  assert.ok(!ids(buildPresentationScenes({ simulation: onlyInstallment })).includes("diferenca"));
  // iguais (inclusive um escrito como texto e o outro como número) e centavos comparados como o PDF
  const text = sensitiveSimulation({ simulationModels: { novo: { ...same }, usado: { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15" } } });
  assert.ok(!ids(buildPresentationScenes({ simulation: text })).includes("diferenca"));
  const cents = sensitiveSimulation({ simulationModels: { novo: { ...same, subsidyValue: "42.000,001" }, usado: { ...same, subsidyValue: 42000 } } });
  assert.ok(!ids(buildPresentationScenes({ simulation: cents })).includes("diferenca"), "42.000,001 = 42.000,00 em centavos");
  // diferença de 1 centavo conta
  const oneCent = sensitiveSimulation({ simulationModels: { novo: { ...same, subsidyValue: "42.000,01" }, usado: { ...same } } });
  assert.equal(buildPresentationScenes({ simulation: oneCent }).find((item) => item.id === "diferenca").difference, 0.01);
});

test("ramo: sem imóvel sugerido não há cena de imóvel (ramo vazio, nenhum botão)", () => {
  const dto = buildPublicPresentation({ simulation: sensitiveSimulation({ properties: [] }), defaultReason: DEFAULT_REASON });
  assert.deepEqual(dto.branch, []);
  assert.deepEqual(ids(dto.scenes), ["abertura", "poder", "formacao", "parcelas", "proximo", "validar", "documentos"]);
  assert.deepEqual(buildPropertyBranch({ simulation: sensitiveSimulation({ properties: [{ customName: "  ", benefits: [] }] }) }), []);
});

test("ramo: justificativa REAL do corretor é usada; vazia ou texto-padrão vira o texto-padrão do dono (mesma constante do gerador)", () => {
  const real = sensitiveSimulation();
  assert.equal(buildPropertyBranch({ simulation: real, defaultReason: DEFAULT_REASON })[0].reason, "Fica perto da escola dos filhos e cabe no orçamento.");
  for (const reason of ["", "   ", undefined, null, DEFAULT_REASON]) {
    const sim = sensitiveSimulation();
    sim.properties[0].recommendationReason = reason;
    assert.equal(buildPropertyBranch({ simulation: sim, defaultReason: DEFAULT_REASON })[0].reason, DEFAULT_REASON, JSON.stringify(reason));
  }
  // a constante do texto-padrão é a do gerador/PDF (simulation-mapper), não uma cópia
  assert.match(read("lib/simulation-mapper.js"), /Este imóvel foi selecionado buscando reduzir ao máximo o desembolso inicial da compra e proporcionar o melhor aproveitamento das condições disponíveis\./);
  assert.match(read("lib/simulation-presentation.js"), /defaultReason: DEFAULT_RECOMMENDATION_REASON/);
});

test("ramo: uma cena por imóvel sugerido, na ordem do cadastro, com posição e total; nome, foto segura e até 6 benefícios", () => {
  const sim = sensitiveSimulation();
  sim.properties[0].benefits = Array.from({ length: 9 }, (_, i) => ({ text: `Benefício ${i + 1}` }));
  sim.properties[0].imageUrl = "data:image/png;base64,AAAA";
  sim.properties.push({ customName: "Condomínio Segundo", benefits: [{ text: "Vaga coberta" }], imageUrl: "https://cdn.exemplo.com/2.jpg", recommendationReason: "" });
  sim.properties.push({ customName: "", benefits: [] }); // sem nome: não conta
  const branch = buildPropertyBranch({ simulation: sim, defaultReason: DEFAULT_REASON });
  assert.equal(branch.length, 2);
  assert.deepEqual(branch.map((scene) => [scene.name, scene.position, scene.count]), [["Residencial Aurora", 1, 2], ["Condomínio Segundo", 2, 2]]);
  assert.equal(branch[0].imageUrl, "");
  assert.equal(branch[0].benefits.length, 6);
  assert.equal(branch[1].imageUrl, "https://cdn.exemplo.com/2.jpg");
  assert.ok(branch.every((scene) => scene.id === "imovel"));
});

test("cenas: sem valores na simulação → null (nada a apresentar)", () => {
  const empty = sensitiveSimulation({ simulationModels: null, financingValue: 0, subsidyValue: 0, firstInstallment: 0, lastInstallment: 0 });
  assert.equal(buildPresentationScenes({ simulation: empty }), null);
  assert.equal(buildPublicPresentation({ simulation: empty }), null);
  assert.equal(buildPresentationScenes({ simulation: {} }), null);
});

test("cenas: simulação legada (campos soltos, sem simulationModels) usa o mesmo caminho do PDF", () => {
  const legacy = { clientName: "João Pedro", simulationType: "usado", financingValue: 120000, subsidyValue: 0, firstInstallment: 900, lastInstallment: 700, simulationDate: "2026-09-01", properties: [] };
  const scenes = buildPresentationScenes({ simulation: legacy });
  assert.equal(scenes.find((scene) => scene.id === "poder").value, 120000);
  assert.equal(scenes.find((scene) => scene.id === "parcelas").first, 900);
});

test("cenas: só uma parcela cadastrada mostra só ela; nenhuma parcela dispensa a cena", () => {
  const one = buildPresentationScenes({ simulation: sensitiveSimulation({ simulationModels: { novo: { ...same, lastInstallment: 0 }, usado: { ...same, lastInstallment: 0 } } }) });
  const parcelas = one.find((scene) => scene.id === "parcelas");
  assert.equal(parcelas.last, 0);
  const none = buildPresentationScenes({ simulation: sensitiveSimulation({ simulationModels: { novo: { ...same, firstInstallment: 0, lastInstallment: 0 }, usado: { ...same, firstInstallment: 0, lastInstallment: 0 } } }) });
  assert.ok(!ids(none).includes("parcelas"));
});

test("tempo de cada cena do roteiro principal (auto-avanço respeita a leitura)", () => {
  assert.ok(sceneDurationMs({ id: "poder" }) >= 4000);
  const scenes = buildPresentationScenes({ simulation: sensitiveSimulation(), defaultReason: DEFAULT_REASON });
  assert.ok(scenes.every((scene) => scene.durationMs >= 4000 && scene.durationMs <= 20000));
});

// ---------- números idênticos aos do PDF ----------
test("números da apresentação = números que o PDF usa (mesma função getRenderableSimulationModels)", () => {
  const cases = [
    sensitiveSimulation(),
    sensitiveSimulation({ simulationModels: { novo: { financingValue: "232.000,00", subsidyValue: "0,00", firstInstallment: "R$ 1.320,00", lastInstallment: "980,55" }, usado: { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" } } }),
    sensitiveSimulation({ simulationModels: { novo: { ...same }, usado: { ...same, financingValue: 150000, subsidyValue: 0, firstInstallment: 940, lastInstallment: 701.1 } } }),
    { clientName: "Legado", simulationType: "novo", financingValue: 180000.5, subsidyValue: 12000.25, firstInstallment: 1000, lastInstallment: 750, properties: [] }
  ];
  for (const simulation of cases) {
    // o PDF (SimulationGenerator.buildPresentationPages) usa, por modelo preenchido: totals.total/financing/subsidy e first/lastInstallment
    const pdfModels = getRenderableSimulationModels(simulation).filter((model) => simulationModelHasValues(model.values));
    const scenes = buildPresentationScenes({ simulation });
    const poder = scenes.find((scene) => scene.id === "poder");
    const formacao = scenes.find((scene) => scene.id === "formacao");
    const parcelas = scenes.find((scene) => scene.id === "parcelas");
    assert.equal(poder.value, pdfModels[0].totals.total);
    assert.equal(formacao.financing, pdfModels[0].totals.financing);
    assert.equal(formacao.subsidy, pdfModels[0].totals.subsidy);
    assert.equal(formacao.total, pdfModels[0].totals.financing + pdfModels[0].totals.subsidy);
    const pdfMoney = (value) => (typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0);
    assert.equal(parcelas.first, pdfMoney(pdfModels[0].values.firstInstallment));
    assert.equal(parcelas.last, pdfMoney(pdfModels[0].values.lastInstallment));
    assert.equal(norm(formatBRL(poder.value)), norm(formatBRL(pdfModels[0].totals.total)));
    const diferenca = scenes.find((scene) => scene.id === "diferenca");
    if (diferenca) {
      const byType = Object.fromEntries(pdfModels.map((model) => [model.type, model]));
      assert.equal(diferenca.novo, byType.novo.totals.subsidy);
      assert.equal(diferenca.usado, byType.usado.totals.subsidy);
    }
  }
});

test("a apresentação não recalcula nada: o modelo do PDF (presentation-model) continua o mesmo e não é importado", () => {
  assert.equal(typeof buildPresentationModel, "function");
  const files = [
    "lib/simulation-presentation-core.mjs",
    "lib/simulation-presentation-format.mjs",
    "lib/simulation-presentation.js",
    "components/presentation/PresentationPlayer.jsx",
    "components/presentation/player-core.mjs",
    "components/presentation/SimulationPresentationPanel.jsx",
    "app/api/admin/simulacoes/[id]/apresentacao/route.js",
    "app/api/s/[token]/evento/route.js",
    "app/apresentacao/[token]/page.jsx",
    "app/admin/simulacoes/[id]/apresentacao/page.jsx"
  ];
  for (const file of files) {
    // Exceção única (2026-10-05, PRES-20): o core reutiliza `buildPresentationModel` (função PURA, sem PDF) só para a conta da
    // documentação gratuita; continua proibido importar o PDF em si.
    const source = read(file).replace(/^import \{ buildPresentationModel \} from "\.\/simulacao-entrada\/presentation-model\.mjs";\r?$/m, "");
    assert.ok(!/proposta-pdf|presentation-model|pdf-lib|buildSimulationResultSvg|buildPresentationPages/.test(source.replace(/\/\/.*$/gm, "")), `${file} toca no PDF`);
    // nada de fórmula financeira nova: sem cálculo de juros/amortização/percentual
    // (a taxa de juros anual é só um valor cadastrado que se exibe: nenhuma fórmula)
    assert.ok(!/Math\.pow\(1 \+|amortiza|\*\s*taxa|taxa\s*\*/i.test(source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")) || file.endsWith("player-core.mjs"), `${file} parece calcular financeiro`);
  }
  // a rota do PDF segue usando o modelo e o gerador de sempre
  const pdfRoute = read("app/api/simulations/[id]/proposta-valores/route.js");
  assert.match(pdfRoute, /gerarPropostaValoresPdf/);
  assert.match(pdfRoute, /buildPresentationModel/);
  assert.match(pdfRoute, /requireAdminApi/);
  assert.ok(!pdfRoute.includes("simulation-presentation"));
});

// ---------- rotas ----------
test("rota admin: guard primeiro, escopo do PDF (getSimulation com auth), 401/403/404 e idempotência", () => {
  const source = read("app/api/admin/simulacoes/[id]/apresentacao/route.js");
  assert.ok(source.indexOf("await requireAdminApi(request)") < source.indexOf("await getSimulation("));
  assert.match(source, /getSimulation\(\(await params\)\.id, auth\)/);
  assert.match(source, /NextResponse\.json\(\{ error: auth\.error \}, \{ status: auth\.status \}\)/); // 401/403 do guard
  assert.match(source, /AdminPermissionError[\s\S]{0,200}status: 403/); // fora do escopo da equipe
  assert.match(source, /Simulação não encontrada[\s\S]{0,60}404/);
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /ensurePresentation/); // gerar = idempotente
  assert.match(source, /error: "Não foi possível gerar a apresentação\." \}, \{ status: 500/);
  // nunca devolve o objeto da simulação/cliente
  assert.ok(!/NextResponse\.json\(simulation/.test(source));
  // metade do escopo (corretor/gestor/associado) vem de getSimulation → assertCanAccessResponsibleUser (lib/simulations.js)
  assert.match(read("lib/simulations.js"), /assertCanAccessResponsibleUser\(auth, row\.created_by_user_id/);
});

test("prévia no CRM: mesmo escopo e sem métrica (sem token)", () => {
  const source = read("app/admin/simulacoes/[id]/apresentacao/page.jsx");
  assert.ok(source.indexOf("await requireAdminPage()") < source.indexOf("await getSimulation("));
  assert.match(source, /getSimulation\(id, auth\)/);
  assert.match(source, /token=""/);
  assert.match(source, /preview/);
});

test("página pública: noindex, no-referrer, 404 genérico e nenhum guard de login", () => {
  const source = read("app/apresentacao/[token]/page.jsx");
  assert.match(source, /index: false, follow: false/);
  assert.match(source, /referrer: "no-referrer"/);
  assert.match(source, /force-dynamic/);
  assert.match(source, /if \(!dto\) notFound\(\)/);
  assert.ok(!/requireAdmin/.test(source));
  assert.match(source, /scenes=\{dto\.scenes\}/); // só o DTO vai ao navegador
});

test("lib: token inválido/inexistente/revogado/tabela ausente → null; escrita só pela função atômica", () => {
  const source = read("lib/simulation-presentation.js");
  assert.ok(source.includes("return notFound(\"token_fora_do_formato\")"));
  assert.ok(source.includes("return notFound(\"link_revogado\")"));
  assert.ok(source.includes("return notFound(\"migration_ausente\")"));
  assert.match(source, /rpc\("record_simulation_presentation_event"/);
  assert.match(source, /Recurso ainda não ativado no banco\./);
  assert.match(source, /import "server-only"/);
  // round 2: nenhum contato do corretor na apresentação (sem "Falar com meu corretor")
  // round 4 (PRES-17): a lib só VERIFICA se há responsável com WhatsApp válido (booleano podeReceberLista); nunca monta wa.me
  assert.ok(!/wa\.me|loadBrokerContact/.test(source));
  assert.match(source, /export async function canReceiveDocumentsList/);
  assert.ok(!/OFFICIAL|WHATSAPP_OFICIAL|official/i.test(source));
});

// ---------- tolerância à migration ausente ----------
test("migration ausente é reconhecida (42P01, 42883, PGRST205/202, mensagem) e erro comum não", () => {
  for (const error of [
    { code: "42P01", message: "relation \"public.simulation_presentations\" does not exist" },
    { code: "PGRST205", message: "Could not find the table 'public.simulation_presentations' in the schema cache" },
    { code: "42883", message: "function record_simulation_presentation_event does not exist" },
    { code: "PGRST202", message: "Could not find the function" },
    { message: "relation simulation_presentations does not exist" }
  ]) assert.equal(isPresentationSchemaMissing(error), true, error.message);
  for (const error of [null, undefined, { code: "23505", message: "duplicate key" }, { code: "42501", message: "permission denied" }]) {
    assert.equal(isPresentationSchemaMissing(error), false);
  }
});

test("painel do CRM: mostra 'Recurso ainda não ativado no banco' e não quebra a tela", () => {
  const panel = read("components/presentation/SimulationPresentationPanel.jsx");
  assert.match(panel, /state && !state\.schemaReady/);
  assert.match(panel, /Recurso ainda não ativado no banco\./);
  const route = read("app/api/admin/simulacoes/[id]/apresentacao/route.js");
  assert.match(route, /schemaReady: false, message: PRESENTATION_SCHEMA_MESSAGE/);
  // a página da simulação (e o PDF) continuam sendo renderizados
  const page = read("app/admin/simulacoes/[id]/page.jsx");
  assert.match(page, /<SimulationGenerator/);
  assert.match(page, /<SimulationPresentationPanel simulationId=\{simulation\.id\} \/>/);
});

// ---------- evento ----------
test("evento: allowlist estrita do corpo", () => {
  assert.deepEqual(EVENT_TYPES, ["abriu", "cena", "concluiu"]);
  assert.deepEqual(parsePresentationEvent({ tipo: "abriu", nova: true }), { tipo: "abriu", cena: null, nova: true });
  assert.deepEqual(parsePresentationEvent({ tipo: "abriu" }), { tipo: "abriu", cena: null, nova: false });
  assert.deepEqual(parsePresentationEvent({ tipo: "cena", cena: 3 }), { tipo: "cena", cena: 3, nova: false });
  assert.deepEqual(parsePresentationEvent({ tipo: "concluiu", cena: 7 }), { tipo: "concluiu", cena: 7, nova: false });
  for (const bad of [
    null, [], "x", 5, {}, { tipo: "apagar" }, { tipo: "cena" }, { tipo: "cena", cena: 0 }, { tipo: "cena", cena: 33 }, { tipo: "cena", cena: 2.5 },
    { tipo: "cena", cena: "2" }, { tipo: "abriu", ip: "1.2.3.4" }, { tipo: "abriu", nome: "x" }, { tipo: "abriu", nova: "sim" }, { tipo: "concluiu" }
  ]) assert.equal(parsePresentationEvent(bad), null, JSON.stringify(bad));
  // `nova` só vale para "abriu"
  assert.equal(parsePresentationEvent({ tipo: "cena", cena: 2, nova: true }).nova, false);
});

test("evento: rota pública sem login, sem IP/user-agent gravados, 404/400 genéricos e cabeçalhos", () => {
  const source = read("app/api/s/[token]/evento/route.js");
  assert.ok(!/requireAdmin/.test(source));
  assert.ok(!/x-forwarded-for|x-real-ip|request\.ip|remoteAddress/i.test(source), "não pode ler IP");
  assert.ok(!/user_agent|userAgent:/.test(source), "não pode gravar user-agent");
  assert.match(source, /isPresentationToken\(token\)\) return respond\(\{ error: "Não encontrado\." \}, 404\)/);
  assert.match(source, /Requisição inválida\.[\s\S]{0,40}400/);
  assert.match(source, /"Cache-Control": "no-store"/);
  assert.match(source, /X-Robots-Tag/);
  assert.match(source, /429/);
  assert.match(source, /isLikelyBot/);
  assert.match(source, /recordPresentationEvent\(token, event\)/);
  assert.ok(!/NextResponse\.json\(\{ ok: true, /.test(source), "resposta não devolve dados");
});

test("evento: bots óbvios são ignorados e limite de taxa funciona (sem IP)", () => {
  for (const ua of ["", "facebookexternalhit/1.1", "WhatsApp/2.23", "Googlebot/2.1", "curl/8.4", "Mozilla/5.0 (compatible; bingbot/2.0)"]) assert.equal(isLikelyBot(ua), true, ua);
  assert.equal(isLikelyBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"), false);
  let clock = 0;
  const allow = createRateLimiter({ limit: 3, windowMs: 1000, now: () => clock });
  assert.deepEqual([allow("a"), allow("a"), allow("a"), allow("a")], [true, true, true, false]);
  assert.equal(allow("b"), true, "outro link não é afetado");
  clock = 1001;
  assert.equal(allow("a"), true, "janela renovada");
});

test("migration: aditiva, idempotente, RLS sem policy pública, UNIQUE parcial, função atômica e só service role", () => {
  const dir = path.join(root, "supabase/migrations");
  const file = fs.readdirSync(dir).find((name) => name.includes("simulation_presentations"));
  assert.ok(file, "migration existe");
  assert.match(file, /^\d{14}_/, "14 dígitos");
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  assert.match(sql, /create table if not exists public\.simulation_presentations/);
  assert.match(sql, /token text not null unique check \(char_length\(token\) >= 22\)/);
  assert.match(sql, /references public\.simulations\(id\) on delete cascade/);
  assert.match(sql, /create unique index if not exists simulation_presentations_one_active_idx[\s\S]*where status = 'active'/);
  assert.match(sql, /enable row level security/);
  assert.ok(!/create policy/i.test(sql), "sem policy pública");
  assert.match(sql, /revoke all on public\.simulation_presentations from anon, authenticated/);
  assert.match(sql, /create or replace function public\.record_simulation_presentation_event/);
  assert.match(sql, /grant execute on function public\.record_simulation_presentation_event\(text, text, integer, boolean\) to service_role/);
  assert.match(sql, /view_count = view_count \+ case when p_nova_sessao then 1 else 0 end/);
  assert.match(sql, /completed_at = coalesce\(completed_at, now\(\)\)/);
  assert.ok(!/ip_address|user_agent|\bip\b/i.test(sql.replace(/--.*$/gm, "")), "sem IP/user-agent");
  assert.ok(!/\b(drop|truncate|(?<!on )delete)\b/i.test(sql.replace(/--.*$/gm, "")), "aditiva: nada destrutivo");
  assert.ok(!/alter table public\.(simulations|simulation_registrations)/i.test(sql), "não mexe nas tabelas existentes");
  // UNIQUE por telefone em simulation_registrations é proibido (CLAUDE.md regra 5)
  assert.ok(!/unique[\s\S]{0,60}phone/i.test(sql));
});

test("migrations: nenhuma colisão de timestamp com a nova", () => {
  const names = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql"));
  const stamps = names.map((name) => name.split("_")[0]);
  const mine = names.find((name) => name.includes("simulation_presentations")).split("_")[0];
  assert.equal(stamps.filter((stamp) => stamp === mine).length, 1);
});

test("AppChrome: apresentação em tela cheia, sem cabeçalho/rodapé do site", () => {
  const chrome = read("components/AppChrome.jsx");
  assert.match(chrome, /\/apresentacao\//);
  assert.match(chrome, /\\\/s\\\/\[A-Za-z0-9\]\{24\}/);
});

// ---------- regressão: simulação "usado" no formato real de `rowToSimulation` (campos soltos, sem imóveis) ----------
// Caso de produção (link de teste, 2026-10-05): o link 404 devia ser diagnosticável. Estas formas vêm de rowToSimulation.
const realShape = (over = {}) => ({
  id: "9aa9d38a-0c0b-4d28-aa38-505443579a5a",
  registrationId: "",
  clientName: "Teste Test",
  simulationType: "usado",
  financingValue: 180000,
  subsidyValue: 20000,
  firstInstallment: 1050.9,
  lastInstallment: 780.3,
  downPaymentValue: 0,
  fgtsValue: 0,
  totalPurchasePower: 200000,
  expandedPurchasePower: 200000,
  showExpandedPower: false,
  simulationDate: "2026-10-01",
  publicNote: "",
  internalNote: "",
  simulationModels: null,
  outputMode: "individual",
  entrySimulationSnapshots: [],
  properties: [],
  ...over
});

test("regressão: simulação usado só com campos soltos (sem modelos, sem imóveis, sem snapshots) gera a apresentação", () => {
  const scenes = buildPresentationScenes({ simulation: realShape(), defaultReason: DEFAULT_REASON });
  assert.deepEqual(ids(scenes), ["abertura", "poder", "formacao", "parcelas", "proximo", "validar", "documentos"]);
  assert.equal(scenes[0].firstName, "Teste");
  assert.equal(scenes[1].value, 200000);
  assert.equal(scenes[3].first, 1050.9);
  assert.equal(scenes[3].interestRate, null);
});

test("regressão: nota com modelos vazios (autosave) + campos soltos preenchidos usa os campos soltos, como o PDF", () => {
  const empty = { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" };
  const scenes = buildPresentationScenes({ simulation: realShape({ simulationModels: { novo: { ...empty }, usado: { ...empty } } }) });
  assert.equal(scenes.find((scene) => scene.id === "poder").value, 200000);
});

test("simulação aguardando valores (tudo zerado) não tem o que apresentar: null (404 com motivo no log)", () => {
  const pending = realShape({ financingValue: 0, subsidyValue: 0, firstInstallment: 0, lastInstallment: 0, totalPurchasePower: 0 });
  assert.equal(buildPresentationScenes({ simulation: pending }), null);
  const source = read("lib/simulation-presentation.js");
  for (const reason of ["token_fora_do_formato", "migration_ausente", "token_inexistente", "link_revogado", "simulacao_inexistente", "simulacao_sem_valores"]) {
    assert.ok(source.includes(`notFound("${reason}")`), reason);
  }
  assert.match(source, /console\.warn\("\[apresentacao\] 404 publico:", reason\)/);
});
