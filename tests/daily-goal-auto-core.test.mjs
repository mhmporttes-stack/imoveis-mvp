import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDailyAutoCap,
  shuffleArray,
  spreadScheduleMinutes,
  isWithinWindow,
  isBusinessDay,
  isOptOutMessage,
  pickMessageVariant,
  renderAutoMessage
} from "../lib/daily-goal-auto-core.mjs";

test("teto do dia = todas as atividades pendentes, sem passar de 100", () => {
  assert.equal(computeDailyAutoCap({ totalActivities: 65 }), 65);
  assert.equal(computeDailyAutoCap({ totalActivities: 130 }), 100);
});

test("teto do dia respeita um override manual menor que as atividades pendentes", () => {
  assert.equal(computeDailyAutoCap({ totalActivities: 65, dailyCapOverride: 10 }), 10);
});

test("override manual maior que 100 não estoura o teto absoluto", () => {
  assert.equal(computeDailyAutoCap({ totalActivities: 65, dailyCapOverride: 500 }), 65);
});

test("sem nenhuma atividade pendente, teto é 0", () => {
  assert.equal(computeDailyAutoCap({ totalActivities: 0 }), 0);
});

test("shuffleArray devolve os mesmos itens, só a ordem muda (e não muta o array original)", () => {
  const original = [1, 2, 3, 4, 5];
  const shuffled = shuffleArray(original, () => 0.999);
  assert.deepEqual([...original], [1, 2, 3, 4, 5]); // não mutou
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4, 5]); // mesmos itens
});

test("shuffleArray é determinístico quando random é fornecido", () => {
  const a = shuffleArray([1, 2, 3, 4, 5], () => 0.5);
  const b = shuffleArray([1, 2, 3, 4, 5], () => 0.5);
  assert.deepEqual(a, b);
});

test("spreadScheduleMinutes espalha dentro da janela, respeitando o mínimo/máximo intervalo", () => {
  let seed = 0;
  const random = () => { seed = (seed + 0.37) % 1; return seed; };
  const times = spreadScheduleMinutes({ count: 5, windowStartMinutes: 480, windowEndMinutes: 1080, minGapMinutes: 20, maxGapMinutes: 40, random });
  assert.ok(times.length <= 5);
  for (const t of times) assert.ok(t >= 480 && t <= 1080);
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= 20 && gap <= 40, `gap=${gap}`);
  }
});

test("spreadScheduleMinutes ativado tarde: começa de nowMinutes, nunca antes", () => {
  const times = spreadScheduleMinutes({ count: 3, windowStartMinutes: 480, windowEndMinutes: 1080, minGapMinutes: 20, maxGapMinutes: 20, nowMinutes: 900, random: () => 0 });
  assert.equal(times[0], 900);
});

test("spreadScheduleMinutes corta quando não cabe mais nenhum horário na janela", () => {
  const times = spreadScheduleMinutes({ count: 20, windowStartMinutes: 480, windowEndMinutes: 540, minGapMinutes: 20, maxGapMinutes: 20, random: () => 0 });
  assert.ok(times.length < 20);
  for (const t of times) assert.ok(t <= 540);
});

test("spreadScheduleMinutes com oscilação: usa a média (janela / count) em vez de minGap/maxGap", () => {
  // janela de 750 min (390 a 1140), 90 mensagens -> média = 8,33 min.
  // random() sempre no meio (0.5) -> cada intervalo fica exatamente na média.
  const times = spreadScheduleMinutes({
    count: 90, windowStartMinutes: 390, windowEndMinutes: 1140,
    minGapMinutes: 20, maxGapMinutes: 40, // devem ser ignorados nesse modo
    oscillateEnabled: true, oscillatePercent: 50, random: () => 0.5
  });
  assert.equal(times.length, 90);
  const gap = times[1] - times[0];
  assert.ok(Math.abs(gap - 750 / 90) < 0.01, `gap=${gap}`);
});

test("spreadScheduleMinutes com oscilação: 0% de oscilação não varia (sempre a média exata)", () => {
  const times = spreadScheduleMinutes({
    count: 10, windowStartMinutes: 0, windowEndMinutes: 100,
    oscillateEnabled: true, oscillatePercent: 0, random: () => Math.random()
  });
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(Math.abs((times[i] - times[i - 1]) - 10) < 0.001);
  }
});

test("spreadScheduleMinutes com oscilação: 100% pode chegar perto de 0, mas nunca abaixo de 1 minuto", () => {
  const times = spreadScheduleMinutes({
    count: 10, windowStartMinutes: 0, windowEndMinutes: 100,
    oscillateEnabled: true, oscillatePercent: 100, random: () => 0
  });
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i] - times[i - 1] >= 1);
  }
});

test("spreadScheduleMinutes com oscilação desligada (padrão) continua usando minGap/maxGap normalmente", () => {
  const times = spreadScheduleMinutes({
    count: 5, windowStartMinutes: 480, windowEndMinutes: 1080, minGapMinutes: 20, maxGapMinutes: 40,
    oscillateEnabled: false, random: () => 0
  });
  assert.equal(times[1] - times[0], 20);
});

test("isWithinWindow", () => {
  assert.equal(isWithinWindow(480, 480, 1080), true);
  assert.equal(isWithinWindow(1080, 480, 1080), true);
  assert.equal(isWithinWindow(479, 480, 1080), false);
  assert.equal(isWithinWindow(1081, 480, 1080), false);
});

test("isBusinessDay: segunda a sexta são dias úteis, sábado e domingo não", () => {
  assert.equal(isBusinessDay(0), false); // domingo
  assert.equal(isBusinessDay(1), true);
  assert.equal(isBusinessDay(5), true);
  assert.equal(isBusinessDay(6), false); // sábado
});

test("isOptOutMessage reconhece PARAR/SAIR/CANCELAR ignorando maiúsculas e acentos", () => {
  assert.equal(isOptOutMessage("PARAR"), true);
  assert.equal(isOptOutMessage("parar"), true);
  assert.equal(isOptOutMessage("Sair"), true);
  assert.equal(isOptOutMessage("cancelar"), true);
  assert.equal(isOptOutMessage("  Não Quero Mais  "), true);
});

test("isOptOutMessage NÃO dispara em frase longa que só menciona a palavra (evita falso positivo)", () => {
  assert.equal(isOptOutMessage("vou cancelar minha viagem amanhã"), false);
  assert.equal(isOptOutMessage("oi, tudo bem?"), false);
  assert.equal(isOptOutMessage(""), false);
});

test("pickMessageVariant nunca repete a última variação usada (com mais de 1 opção)", () => {
  const variants = ["a", "b"];
  const { text, index } = pickMessageVariant(variants, 0, () => 0); // sortearia índice 0 de novo
  assert.equal(index, 1);
  assert.equal(text, "b");
});

test("pickMessageVariant com 1 única variação sempre repete (nada a evitar)", () => {
  assert.deepEqual(pickMessageVariant(["único"], 0), { text: "único", index: 0 });
});

test("renderAutoMessage substitui {primeiro_nome}", () => {
  assert.equal(renderAutoMessage("Oi, {primeiro_nome}!", { primeiroNome: "Carol" }), "Oi, Carol!");
});

test("renderAutoMessage substitui {nome_corretor} e {associado_associada} conforme o gênero", () => {
  assert.equal(
    renderAutoMessage("Meu nome é {nome_corretor}, sou {associado_associada} do corretor Matheus Machado.", { nomeCorretor: "Eduardo", corretorGender: "male" }),
    "Meu nome é Eduardo, sou associado do corretor Matheus Machado."
  );
  assert.equal(
    renderAutoMessage("Meu nome é {nome_corretor}, sou {associado_associada} do corretor Matheus Machado.", { nomeCorretor: "Bruna", corretorGender: "female" }),
    "Meu nome é Bruna, sou associada do corretor Matheus Machado."
  );
});

test("renderAutoMessage sem gênero cadastrado nunca deixa {associado_associada} cru — cai no fallback neutro", () => {
  assert.equal(
    renderAutoMessage("Meu nome é {nome_corretor}, sou {associado_associada} do corretor Matheus Machado.", { nomeCorretor: "Caroline", corretorGender: "" }),
    "Meu nome é Caroline, faço parte da equipe do corretor Matheus Machado."
  );
  assert.equal(
    renderAutoMessage("Aqui é {nome_corretor}, {associado_associada} do corretor Matheus Machado.", { nomeCorretor: "Caroline", corretorGender: "" }),
    "Aqui é Caroline, faço parte da equipe do corretor Matheus Machado."
  );
});
