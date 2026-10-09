import test from "node:test";
import assert from "node:assert/strict";
import { buildPropertyBranch, buildPropertyValues } from "../lib/simulation-presentation-core.mjs";

const entry = (over = {}, features = []) => ({
  result: {
    valorImovel: 242000,
    financiamentoAprovado: 200000,
    totalDescontos: 0,
    casaPaulista: 0,
    subsidioMcmv: 0,
    entradaTotal: 30000,
    detalhePagamento: { ato: 0, blocos: [{ label: "Entrada parcelada", parcelas: 30, valorParcela: 1000 }] },
    ...over
  },
  features
});

test("sem nenhum desconto/benefício a cena de valores não existe (a apresentação do imóvel termina na cena do imóvel)", () => {
  assert.equal(buildPropertyValues({ entry: entry() }), null);
  // características comuns do cadastro (sem documentação gratuita) não são benefício
  assert.equal(buildPropertyValues({ entry: entry({}, ["Documentação parcelada", "Imóvel pronto para morar", "Entrada parcelada"]) }), null);
});

test("qualquer desconto/benefício mantém a cena de valores: incorporadora, Casa Paulista, subsídio ou documentação gratuita", () => {
  assert.ok(buildPropertyValues({ entry: entry({ totalDescontos: 5000 }) }));
  assert.ok(buildPropertyValues({ entry: entry({ casaPaulista: 10000 }) }));
  assert.ok(buildPropertyValues({ entry: entry({ subsidioMcmv: 20000 }) }));
  const doc = buildPropertyValues({ entry: entry({}, ["Documentação gratuita"]) });
  assert.ok(doc);
  assert.equal(doc.documentacaoGratuita, 12100, "5% do valor do imóvel (regra existente, pendente de validação)");
  assert.equal(doc.totalDescontos, 12100);
});

test("ramo: imóvel sem benefício não ganha cena de valores; o outro imóvel (com benefício) continua ganhando", () => {
  const simulation = {
    properties: [
      { propertyId: "a", customName: "Sem benefício", benefits: [], imageUrl: "https://cdn.exemplo.com/a.jpg" },
      { propertyId: "b", customName: "Com desconto", benefits: [], imageUrl: "https://cdn.exemplo.com/b.jpg" }
    ]
  };
  const branch = buildPropertyBranch({ simulation, entryResults: { a: entry(), b: entry({ totalDescontos: 8000 }) } });
  assert.equal(branch[0].valores, undefined);
  assert.ok(branch[1].valores);
  assert.equal(branch[1].valores.totalDescontos, 8000);
});
