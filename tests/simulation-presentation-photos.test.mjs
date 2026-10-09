import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MAX_PRESENTATION_IMAGES,
  PUBLIC_BRANCH_FIELDS,
  buildPropertyBranch,
  livePropertyImages
} from "../lib/simulation-presentation-core.mjs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function simulation(properties) {
  return { clientName: "Maria Souza", properties, model: { values: {} } };
}
const property = (over = {}) => ({ propertyId: "p1", customName: "Recanto Verde", benefits: [], imageUrl: "https://cdn.exemplo.com/antiga.jpg", recommendationReason: "x", ...over });

test("fotos atuais do cadastro: ordem do cadastro, sem repetição, só URL segura (sem data:, sem http, sem imagem-padrão)", () => {
  const photos = {
    p1: [
      { data: "https://cdn.exemplo.com/a.jpg", name: "a" },
      "https://cdn.exemplo.com/b.jpg",
      { url: "https://cdn.exemplo.com/a.jpg" }, // repetida
      { data: "data:image/png;base64,AAAA" }, // embutida: nunca sai
      { data: "http://cdn.exemplo.com/inseguro.jpg" },
      { data: "/assets/hero-marilia.png" }, // imagem-padrão do site
      { src: "/assets/foto-local.jpg" },
      null,
      42
    ]
  };
  assert.deepEqual(livePropertyImages(photos, "p1"), ["https://cdn.exemplo.com/a.jpg", "https://cdn.exemplo.com/b.jpg", "/assets/foto-local.jpg"]);
  assert.deepEqual(livePropertyImages(photos, "outro"), []);
  assert.deepEqual(livePropertyImages(undefined, "p1"), []);
  assert.deepEqual(livePropertyImages({ p1: "não é lista" }, "p1"), []);
});

test("fotos atuais: no máximo 12 por imóvel", () => {
  const many = { p1: Array.from({ length: 30 }, (_, i) => ({ data: `https://cdn.exemplo.com/${i}.jpg` })) };
  const images = livePropertyImages(many, "p1");
  assert.equal(images.length, MAX_PRESENTATION_IMAGES);
  assert.equal(MAX_PRESENTATION_IMAGES, 12);
  assert.equal(images[0], "https://cdn.exemplo.com/0.jpg");
});

test("ramo: o link usa as fotos ATUAIS do cadastro (a foto gravada na simulação só vale sem fotos no cadastro)", () => {
  const sim = simulation([property(), property({ propertyId: "p2", customName: "Outro", imageUrl: "https://cdn.exemplo.com/gravada2.jpg" })]);
  const propertyPhotos = { p1: [{ data: "https://cdn.exemplo.com/nova1.jpg" }, { data: "https://cdn.exemplo.com/nova2.jpg" }] };
  const [first, second] = buildPropertyBranch({ simulation: sim, propertyPhotos });
  assert.deepEqual(first.images, ["https://cdn.exemplo.com/nova1.jpg", "https://cdn.exemplo.com/nova2.jpg"]);
  assert.equal(first.imageUrl, "https://cdn.exemplo.com/nova1.jpg", "a capa também acompanha o cadastro");
  assert.deepEqual(second.images, []);
  assert.equal(second.imageUrl, "https://cdn.exemplo.com/gravada2.jpg", "sem fotos no cadastro: foto gravada na simulação, como antes");
  // sem o mapa (falha na leitura): comportamento anterior
  assert.equal(buildPropertyBranch({ simulation: sim })[0].imageUrl, "https://cdn.exemplo.com/antiga.jpg");
});

test("DTO público: `images` está na lista permitida e nenhuma outra chave nova sai na cena do imóvel", () => {
  assert.ok(PUBLIC_BRANCH_FIELDS.includes("images"));
  const branch = buildPropertyBranch({ simulation: simulation([property()]), propertyPhotos: { p1: [{ data: "https://cdn.exemplo.com/n.jpg" }] } });
  assert.equal(branch.length, 1);
  for (const scene of branch) {
    for (const key of Object.keys(scene)) assert.ok(PUBLIC_BRANCH_FIELDS.includes(key), `chave fora da lista: ${key}`);
  }
});

test("servidor: fotos lidas na hora de abrir o link (uma consulta leve: só id e fotos, sem o PDF do cadastro)", () => {
  const lib = read("lib/simulation-presentation.js");
  assert.match(lib, /loadPropertyPhotos/);
  assert.match(lib, /propertyPhotos/);
  const entry = read("lib/simulation-presentation-entry.js");
  assert.match(entry, /select\("id, photos_json"\)\.in\("id", ids\)/);
  assert.ok(!/pdf_data/.test(entry.slice(entry.indexOf("loadPropertyPhotos"), entry.indexOf("export async function loadPropertyEntryResults"))));
  // falha na leitura nunca derruba a apresentação
  assert.match(entry, /catch \(error\)[\s\S]*return \{\};/);
});

test("player: fotos trocam a cada 2 s com dissolução; só a atual e a próxima ficam no DOM; foto que falha sai; sem foto, fundo de ícone", () => {
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.match(player, /const SLIDE_INTERVAL_MS = 2000;/);
  assert.match(player, /setInterval\(\(\) => setIndex\(/);
  assert.match(player, /if \(i !== current && i !== next\) return null;/);
  assert.match(player, /setFailed\(\(previous\) => new Set\(previous\)\.add\(source\)\)/);
  assert.match(player, /<PhotoSlideshow scene=\{scene\}/);
  assert.match(player, /styles\.photoFallback/);
  const css = read("components/presentation/presentation.module.css");
  assert.match(css, /\.slide \{ opacity: 0; transition: opacity 0\.7s ease; \}/);
});

test("qualidade da foto: moldura exata (sem sobra de 6%, sem zoom de 1,12x e sem will-change que borra a imagem)", () => {
  const css = read("components/presentation/presentation.module.css");
  const rule = /\n\.photo \{[^}]*\}/.exec(css)?.[0] || "";
  assert.match(rule, /inset: 0; width: 100%; height: 100%/);
  assert.ok(!/will-change/.test(rule));
  const ken = /@keyframes kenBurns \{[^}]*\}[^}]*\}/.exec(css)?.[0] || "";
  assert.ok(ken && !/1\.12/.test(ken), "zoom da foto única ficou leve (até 1,05x)");
});
