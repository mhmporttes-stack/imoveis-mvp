// Concordância de gênero e número nas falas do Henry (dono, 2026-10-24: "entraram dois transferências"). Regra única:
// lib/pt-br-concordancia.mjs. Rodar: node --test tests/pt-br-concordancia.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { concordarNumeros, contagem, isFeminineWord, numeroPorExtenso } from "../lib/pt-br-concordancia.mjs";
import { pronounceForSpeech } from "../lib/henry-voice-providers.mjs";
import {
  composeHenryClientAlert,
  HENRY_ALERT_ARRIVAL,
  HENRY_ALERT_ARRIVAL_SUMMARY,
  HENRY_ALERT_NEW,
  HENRY_ALERT_SUMMARY,
  HENRY_ALERT_TRANSFER,
  HENRY_ALERT_WAITING
} from "../lib/henry-voice-client-alerts-core.mjs";
import { composeHenryBirthdayAlert } from "../lib/henry-birthday-alerts-core.mjs";
import { birthdayQuestion } from "../lib/henry-morning-core.mjs";
import { composeBirthdaySentence } from "../lib/alexa-config-core.mjs";
import { HENRY_ACK_ITEMS, HENRY_WAIT_PHRASES } from "../lib/henry-voice-narration.mjs";
import * as lexicon from "../lib/henry-voice-lexicon.mjs";

const FEMININE = [
  ["transferência", "transferências"], ["simulação", "simulações"], ["visita", "visitas"], ["venda", "vendas"],
  ["mensagem", "mensagens"], ["conversa", "conversas"], ["tarefa", "tarefas"], ["atividade", "atividades"],
  ["pendência", "pendências"], ["prospecção", "prospecções"], ["aprovação", "aprovações"], ["reunião", "reuniões"],
  ["ação", "ações"], ["documentação", "documentações"], ["pessoa", "pessoas"], ["corretora", "corretoras"], ["hora", "horas"]
];
const MASCULINE = [["cliente", "clientes"], ["lead", "leads"], ["atendimento", "atendimentos"], ["ponto", "pontos"], ["corretor", "corretores"], ["alerta", "alertas"], ["dia", "dias"]];

test("tabela 1/2/3 × substantivo: artigo, número escrito e número falado", () => {
  for (const [one, many] of FEMININE) {
    assert.equal(isFeminineWord(one), true, one);
    assert.equal(isFeminineWord(many), true, many);
    assert.equal(contagem(1, one, many), `uma ${one}`);
    assert.equal(contagem(2, one, many), `2 ${many}`);
    assert.equal(contagem(3, one, many), `3 ${many}`);
    assert.equal(concordarNumeros(contagem(2, one, many)), `duas ${many}`);
    assert.equal(concordarNumeros(contagem(3, one, many)), `3 ${many}`);
    assert.equal(contagem(2, one, many, { extenso: true }), `duas ${many}`);
    assert.equal(contagem(3, one, many, { extenso: true }), `três ${many}`);
    assert.equal(concordarNumeros(`1 ${one}`), `uma ${one}`);
    assert.equal(concordarNumeros(`dois ${many}`), `duas ${many}`, "o modelo escrevendo 'dois'");
    assert.equal(concordarNumeros(`um ${one}`), `uma ${one}`, "o modelo escrevendo 'um'");
  }
  for (const [one, many] of MASCULINE) {
    assert.equal(isFeminineWord(one), false, one);
    assert.equal(contagem(1, one, many), `um ${one}`);
    assert.equal(concordarNumeros(contagem(2, one, many)), `2 ${many}`);
    assert.equal(concordarNumeros(`dois ${many}`), `dois ${many}`);
  }
});

test("dois gêneros (cliente) no feminino por nome: por extenso quando a voz não teria como saber", () => {
  assert.equal(contagem(1, "cliente nova", "clientes novas", { genero: "f" }), "uma cliente nova");
  assert.equal(contagem(2, "cliente nova", "clientes novas", { genero: "f" }), "duas clientes novas");
  assert.equal(contagem(3, "cliente nova", "clientes novas", { genero: "f" }), "3 clientes novas");
  assert.equal(contagem(2, "cliente novo", "clientes novos"), "2 clientes novos");
});

test("numeroPorExtenso e casos de borda da voz", () => {
  assert.equal(numeroPorExtenso(21, "f"), "vinte e uma");
  assert.equal(numeroPorExtenso(200, "f"), "duzentas");
  assert.equal(numeroPorExtenso(202, "m"), "duzentos e dois");
  assert.equal(numeroPorExtenso(100, "f"), "cem");
  assert.equal(pronounceForSpeech("Entraram 2 clientes novos e 2 transferências."), "Entraram 2 clientes novos e duas transferências.");
  assert.equal(pronounceForSpeech("22 atividades, 212 visitas, 11 vendas, 12 horas"), "vinte e duas atividades, duzentas e doze visitas, 11 vendas, 12 horas");
  assert.equal(pronounceForSpeech("2 mil reais e 2 mil pessoas"), "2 mil reais e duas mil pessoas");
  assert.equal(pronounceForSpeech("às 10:21 horas, 3,2 vendas, 1.200 vendas, 1 alerta"), "às 10:21 horas, 3,2 vendas, 1.200 vendas, 1 alerta");
  assert.equal(pronounceForSpeech("Dois conversas aguardam, 2 atrasadas"), "Duas conversas aguardam, duas atrasadas");
  assert.equal(pronounceForSpeech("Corretor tem dois estados"), "Corretor tem dois estados");
});

// --- Snapshot dos avisos com 1 e 2 itens de cada tipo --------------------------------------------------------------
const users = new Map([
  ["gabriel", { id: "gabriel", name: "Gabriel Souza", gender: "male" }],
  ["bruna", { id: "bruna", name: "Bruna Lima", gender: "female" }]
]);
const spoken = (text) => pronounceForSpeech(text);

test("aviso: 2 transferências → 'duas transferências' (caso do dono)", () => {
  const events = [
    { clientId: "c1", clientName: "Maria Silva", receiverId: "gabriel", kind: "transfer", path: ["bruna", "gabriel"] },
    { clientId: "c2", clientName: "Pedro Alves", receiverId: "bruna", kind: "transfer", path: ["gabriel", "bruna"] }
  ];
  const { text } = composeHenryClientAlert(events, { users, away: true, random: () => 0 });
  assert.equal(text, "Enquanto você estava fora, entraram 2 transferências. Maria com o Gabriel e Pedro com a Bruna.");
  assert.equal(spoken(text), "Enquanto você estava fora, entraram duas transferências. Maria com o Gabriel e Pedro com a Bruna.");
});

test("aviso: 1 de cada tipo / 2 novos / 2 novas", () => {
  const mixed = composeHenryClientAlert([
    { clientId: "c1", clientName: "Pedro Alves", receiverId: "gabriel", kind: "new", path: ["gabriel"] },
    { clientId: "c2", clientName: "Maria Silva", receiverId: "bruna", kind: "transfer", path: ["gabriel", "bruna"] }
  ], { users, away: true, random: () => 0 }).text;
  assert.equal(mixed, "Enquanto você estava fora, entraram um cliente novo e uma transferência. Pedro com o Gabriel e Maria com a Bruna.");
  const twoMale = composeHenryClientAlert([
    { clientId: "c1", clientName: "Pedro Alves", receiverId: "gabriel", kind: "new", path: ["gabriel"] },
    { clientId: "c2", clientName: "Maria Silva", receiverId: "bruna", kind: "new", path: ["bruna"] }
  ], { users, away: true, random: () => 0 }).text;
  assert.equal(spoken(twoMale), "Enquanto você estava fora, entraram 2 clientes novos. Pedro com o Gabriel e Maria com a Bruna.");
  const twoFemale = composeHenryClientAlert([
    { clientId: "c1", clientName: "Ana Souza", receiverId: "gabriel", kind: "new", path: ["gabriel"] },
    { clientId: "c2", clientName: "Maria Silva", receiverId: "bruna", kind: "new", path: ["bruna"] }
  ], { users, away: true, random: () => 0 }).text;
  assert.equal(twoFemale, "Enquanto você estava fora, entraram duas clientes novas. Ana com o Gabriel e Maria com a Bruna.");
  const one = composeHenryClientAlert([{ clientId: "c1", clientName: "Maria Silva", receiverId: "gabriel", kind: "new", path: ["gabriel"] }], { users, random: () => 0 }).text;
  assert.match(one, /uma nova cliente/);
});

test("aniversário: 1 e 2 (cliente/clientes no gênero do nome)", () => {
  assert.equal(birthdayQuestion(["Ana"]), "Hoje é aniversário da cliente Ana. Quer que eu prepare uma mensagem pra ela?");
  assert.equal(birthdayQuestion(["Jean"]), "Hoje é aniversário do cliente Jean. Quer que eu prepare uma mensagem pra ele?");
  assert.equal(birthdayQuestion(["Ana", "Bruna"]), "Hoje é aniversário das clientes Ana e Bruna. Quer que eu prepare uma mensagem pra elas?");
  assert.equal(birthdayQuestion(["Jean", "Ana"]), "Hoje é aniversário dos clientes Jean e Ana. Quer que eu prepare uma mensagem pra eles?");
  assert.equal(composeBirthdaySentence(["Ana"]), "Machado, além disso, hoje uma cliente faz aniversário: Ana.");
  assert.equal(composeBirthdaySentence(["Ana", "Bruna"]), "Machado, além disso, hoje duas clientes fazem aniversário: Ana e Bruna.");
  const two = composeHenryBirthdayAlert([
    { kind: "birthday", clientId: "a", clientName: "Ana Souza", receiverId: "gabriel", own: false },
    { kind: "birthday", clientId: "b", clientName: "Maria Silva", receiverId: "gabriel", own: false }
  ], { users }).text;
  assert.match(two, /^Hoje tem duas aniversariantes: Ana, do Gabriel e Maria, do Gabriel\./);
});

// --- Varredura: nenhum "um/dois" antes de palavra feminina nos bancos e nos montadores --------------------------------
const WRONG = /\b(um|dois|Um|Dois)\s+([A-Za-zÀ-ÿ]+)(?:\s+([A-Za-zÀ-ÿ]+))?/g;
function wrongIn(text) {
  return [...String(text).matchAll(WRONG)].filter((m) => isFeminineWord(m[2], m[3])).map((m) => m[0]);
}

test("bancos de frases do Henry: sem 'um/dois' antes de palavra feminina", () => {
  const texts = [];
  const collect = (value) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect([HENRY_WAIT_PHRASES, HENRY_ACK_ITEMS, Object.values(lexicon)]);
  const r = { name: "o Gabriel", with: "com o Gabriel", to: "pro Gabriel", by: "pelo Gabriel", pron: "ele" };
  for (const c of [{ name: "Maria", gender: "female", novo: "uma nova cliente", art: "a ", pron: "Ela", o: "a" }, { name: "Ariel", gender: null, novo: "um novo lead", art: "", pron: "", o: "" }]) {
    for (const item of [...HENRY_ALERT_NEW, ...HENRY_ALERT_TRANSFER]) texts.push(item.render({ r, c }), item.neutral?.({ r, c }) || "");
    for (const item of HENRY_ALERT_WAITING) texts.push(item.render({ c, t: "5 minutos" }));
  }
  for (const item of HENRY_ALERT_SUMMARY) texts.push(item.render({ head: "2 transferências" }));
  for (const item of HENRY_ALERT_ARRIVAL) texts.push(item.render({ p: { name: "a Bruna", pron: "ela" } }));
  for (const item of HENRY_ALERT_ARRIVAL_SUMMARY) texts.push(item.render({ names: "a Bruna e o Gabriel" }));
  assert.ok(texts.length > 100);
  assert.deepEqual(texts.flatMap(wrongIn), []);
});

test("montadores (lib/henry-*, lib/alexa-*, lib/alexa-v2/*): sem 'um/dois' fixo antes de palavra feminina", () => {
  const dir = fileURLToPath(new URL("../lib/", import.meta.url));
  const files = [
    ...readdirSync(dir).filter((file) => /^(henry|alexa|painel-inicio)[\w-]*\.(mjs|js)$/.test(file)),
    ...readdirSync(`${dir}alexa-v2`).filter((file) => /\.(mjs|js)$/.test(file)).map((file) => `alexa-v2/${file}`)
  ];
  const found = [];
  for (const file of files) {
    readFileSync(`${dir}${file}`, "utf8").split("\n").forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const hit of wrongIn(line)) found.push(`${file}:${index + 1}: ${hit}`);
    });
  }
  assert.deepEqual(found, []);
});
