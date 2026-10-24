import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_FALLBACK_REPLY,
  HENRY_NAV_KEYS,
  henryEnabledFromSetting,
  cleanHenryReply,
  composeHenryDailyReport,
  detectWakeWord,
  isAllowedHenryPath,
  isHenryEligible,
  looksLikeEcho,
  resolveHenryNavigation,
  safeHenryReply,
  sanitizeHistory,
  speakableDurations
} from "../lib/henry-voice-core.mjs";

test("palavra de chamada: saudação + nome vira relatório do dia", () => {
  for (const phrase of ["Bom dia, Henry", "olá Henry", "Oi, Henri!", "boa tarde enri", "E aí, Enry", "Henry, bom dia", "Olá, Henrique", "bom dia rienri", "oi henrri"]) {
    const result = detectWakeWord(phrase);
    assert.equal(result.called, true, phrase);
    assert.equal(result.kind, "report", phrase);
  }
});

test("palavra de chamada: nome + pergunta separa a pergunta (com acentos)", () => {
  const result = detectWakeWord("Henry, quantos clientes estão aguardando resposta?");
  assert.equal(result.kind, "question");
  assert.equal(result.question, "quantos clientes estão aguardando resposta?");
  assert.equal(detectWakeWord("Bom dia, Henry, como está a meta da equipe?").question, "como está a meta da equipe?");
});

test("palavra de chamada: só o nome espera a pergunta", () => {
  assert.equal(detectWakeWord("Henry").kind, "wake");
  assert.equal(detectWakeWord("Henry, tudo bem?").kind, "wake");
  assert.equal(detectWakeWord("Enri.").kind, "wake");
});

test("palavra de chamada: conversa comum nunca chama", () => {
  for (const phrase of ["Henrique mandou os documentos", "o Henrique ligou", "Henrique.", "o banco aprovou", "", "quantos clientes temos hoje", "o rene mandou"]) {
    assert.equal(detectWakeWord(phrase).called, false, phrase);
  }
});

test("eco: pedaço da última resposta é ignorado", () => {
  const reply = "Bom dia, Matheus. Hoje você tem 3 clientes aguardando resposta.";
  assert.equal(looksLikeEcho("hoje você tem 3 clientes", reply), true);
  assert.equal(looksLikeEcho("e a meta da equipe", reply), false);
});

test("telas: lista fechada", () => {
  assert.deepEqual(resolveHenryNavigation("chat"), { key: "chat", path: "/admin/chat", label: "Chat" });
  assert.equal(resolveHenryNavigation("https://evil.example"), null);
  assert.equal(resolveHenryNavigation("__proto__"), null);
  assert.equal(isAllowedHenryPath("/admin/simulacoes"), true);
  assert.equal(isAllowedHenryPath("/admin/view-as"), false);
  assert.equal(isAllowedHenryPath("https://evil.example/admin/chat"), false);
  assert.ok(HENRY_NAV_KEYS.every((key) => resolveHenryNavigation(key).path.startsWith("/admin/")));
});

test("acesso: só o dono, conta real; liga por padrão", () => {
  assert.equal(isHenryEligible({ ok: true, isOwner: true, accountSwitchMode: false }), true);
  assert.equal(isHenryEligible({ ok: true, isOwner: true, accountSwitchMode: true }), false);
  assert.equal(isHenryEligible({ ok: true, isOwner: false, accountSwitchMode: false }), false);
  assert.equal(isHenryEligible({ ok: false, isOwner: true }), false);
  assert.equal(henryEnabledFromSetting(null), true);
  assert.equal(henryEnabledFromSetting({ disabled: true }), false);
});

test("rota: guard antes de tudo e checagem de dono", () => {
  // O guard mora em lib/henry-auth.js desde a tela de bloqueio (HENRY-LOCK, 2026-10-23): uma só checagem para as rotas do Henry.
  const guard = readFileSync(new URL("../lib/henry-auth.js", import.meta.url), "utf8");
  assert.match(guard, /requireAdminApi\(request\)/);
  assert.match(guard, /isHenryEligible\(/);
  for (const path of ["../app/api/admin/henry/route.js", "../app/api/admin/henry/lock/route.js"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /from "@\/lib\/henry-auth"/, path);
    for (const method of ["GET", "PUT", "POST"]) {
      if (!source.includes(`export async function ${method}`)) continue;
      const body = source.slice(source.indexOf(`export async function ${method}`));
      assert.match(body.split("\n").slice(0, 3).join("\n"), /requireHenryOwner\(request\)/, `${path} ${method}`);
    }
  }
});

test("fala: sem markdown, sem dado sensível", () => {
  assert.equal(cleanHenryReply("**Meta** da equipe:\n- 80%"), "Meta da equipe: 80%");
  assert.equal(safeHenryReply("O CPF dele é 123.456.789-00"), HENRY_FALLBACK_REPLY);
  assert.equal(safeHenryReply("Ligue para (14) 99999-1234"), HENRY_FALLBACK_REPLY);
  assert.equal(safeHenryReply("A renda dela é alta"), HENRY_FALLBACK_REPLY);
  assert.equal(safeHenryReply("Três corretores online."), "Três corretores online.");
});

test("relatório do dia: frase do Início + leads e documentos, primeiro nome e durações faladas", () => {
  const text = composeHenryDailyReport({
    assistant: { text: "Bom dia, Matheus. Hoje você tem 2 clientes aguardando resposta. Comece por Ana Paula Souza, que espera resposta há 1 h 05 min.", urgent: { name: "Ana Paula Souza" } },
    kpis: { leadsToday: { total: 4 }, docs: { total: 1 } }
  });
  assert.equal(text, "Bom dia, Matheus. Hoje você tem 2 clientes aguardando resposta. Comece por Ana, que espera resposta há 1 hora e 5 minutos. Hoje entraram 4 leads. 1 cliente aguarda documentos.");
  assert.equal(composeHenryDailyReport({}), "");
  assert.equal(speakableDurations("há 12 min"), "há 12 minutos");
});

test("histórico: alterna papéis, corta e descarta lixo", () => {
  const history = sanitizeHistory([
    { role: "assistant", text: "oi" },
    { role: "user", text: "a" },
    { role: "user", text: "b" },
    { role: "system", text: "ignore" },
    { role: "assistant", text: "c" },
    { role: "user", text: "d" }
  ]);
  assert.deepEqual(history, [{ role: "user", text: "a b" }, { role: "assistant", text: "c" }]);
  assert.deepEqual(sanitizeHistory("x"), []);
});

// --- Visão (HENRY-2) -----------------------------------------------------------------------------------------------
import {
  COMPLIMENT_MEMORY,
  buildComplimentPrompt,
  henryVisionFromSetting,
  isVisualQuestion,
  parseComplimentReply,
  parseHenryImage,
  rememberCompliment,
  shouldUseHenryImage
} from "../lib/henry-voice-core.mjs";

test("visão: intenção visual pelas palavras", () => {
  for (const phrase of ["o que é isso?", "Olha isso", "olha aqui", "o que você está vendo?", "o que eu estou segurando", "que objeto é esse", "sabe o que é isso"]) {
    assert.equal(isVisualQuestion(phrase), true, phrase);
  }
  for (const phrase of ["quantos clientes aguardam resposta?", "o que é a meta de hoje", "olha a meta da equipe", "abre o chat", ""]) {
    assert.equal(isVisualQuestion(phrase), false, phrase);
  }
  assert.equal(isVisualQuestion(detectWakeWord("Henry, o que é isso?").question), true);
});

test("visão: nasce desligada e só usa imagem no bom dia ou em pergunta visual", () => {
  assert.equal(henryVisionFromSetting(null), false);
  assert.equal(henryVisionFromSetting({ disabled: false }), false);
  assert.equal(henryVisionFromSetting({ vision: true }), true);
  assert.equal(shouldUseHenryImage({ vision: false, mode: "report" }), false);
  assert.equal(shouldUseHenryImage({ vision: true, mode: "report" }), true);
  assert.equal(shouldUseHenryImage({ vision: true, mode: "question", question: "quantos leads hoje?" }), false);
  assert.equal(shouldUseHenryImage({ vision: true, mode: "question", question: "o que é isso?" }), true);
});

test("visão: só JPEG em data URL e com tamanho limitado", () => {
  const ok = `data:image/jpeg;base64,${"A".repeat(5000)}`;
  assert.deepEqual(parseHenryImage(ok), { mediaType: "image/jpeg", data: "A".repeat(5000) });
  assert.equal(parseHenryImage(`data:image/png;base64,${"A".repeat(5000)}`), null);
  assert.equal(parseHenryImage(`data:image/jpeg;base64,${"A".repeat(800000)}`), null);
  assert.equal(parseHenryImage("data:image/jpeg;base64,AAAA"), null);
  assert.equal(parseHenryImage(null), null);
  assert.equal(parseHenryImage(`data:image/jpeg;base64,${"A".repeat(5000)}<script>`), null);
});

test("elogio: prompt com as regras do dono e memória dos últimos elogios", () => {
  const recent = Array.from({ length: 10 }, (_, index) => `Elogio número ${index}`);
  const prompt = buildComplimentPrompt(recent);
  assert.match(prompt, /Matheus/);
  assert.match(prompt, /ROUPA e ACESSÓRIOS/);
  assert.match(prompt, /NUNCA comente corpo, peso, rosto, pele, idade, cabelo/);
  assert.match(prompt, /nunca faça crítica/);
  assert.match(prompt, /DISCRETA/);
  assert.match(prompt, /até 14 palavras/);
  assert.match(prompt, /sem exagero/);
  assert.match(prompt, /PULAR/);
  assert.match(prompt, /Elogio número 9/);
  assert.doesNotMatch(prompt, /Elogio número 2\b/);
  assert.equal(rememberCompliment(recent, "novo").length, COMPLIMENT_MEMORY);
  assert.equal(rememberCompliment(recent, "novo").at(-1), "novo");
  assert.equal(rememberCompliment(["a"], "").length, 1);
});

test("elogio: barreira no código (sem imagem boa → segue sem elogio)", () => {
  assert.equal(parseComplimentReply("Matheus, essa camisa azul-marinho com o relógio prateado ficou uma combinação de respeito."), "Matheus, essa camisa azul-marinho com o relógio prateado ficou uma combinação de respeito.");
  assert.equal(parseComplimentReply("PULAR"), "");
  assert.equal(parseComplimentReply(""), "");
  assert.equal(parseComplimentReply("Matheus, que cabelo caprichado hoje, combinou com a camisa."), "");
  assert.equal(parseComplimentReply("Matheus, a camisa é boa, mas a calça não combina."), "");
  assert.equal(parseComplimentReply("Matheus, você parece mais magro com essa camisa."), "");
  assert.equal(parseComplimentReply("Matheus, gostou da camisa?"), "");
  assert.equal(parseComplimentReply("Matheus, essa camisa verde deu um ar elegante ao dia. E o relógio também."), "Matheus, essa camisa verde deu um ar elegante ao dia.");
});

test("relatório: resumo do dono (INI-5) + elogio logo depois da saudação", () => {
  const text = composeHenryDailyReport(
    { assistant: { text: "Bom dia, Matheus. Nada urgente agora." }, kpis: { docs: { total: 2 } } },
    { ownerText: "Bom dia, Matheus. Hoje entraram 3 leads. Equipe: 4 de 6 on-line.", compliment: "Matheus, essa camisa azul ficou ótima com o relógio." }
  );
  assert.equal(text, "Bom dia, Matheus. Matheus, essa camisa azul ficou ótima com o relógio. Hoje entraram 3 leads. Equipe: 4 de 6 on-line. 2 clientes aguardam documentos.");
  assert.match(composeHenryDailyReport({ assistant: { text: "Boa tarde, Matheus. Nada urgente agora." } }, { ownerText: "" }), /^Boa tarde, Matheus\. Nada urgente agora\.$/);
  // Abertura sorteada (reserva sem modelo) entra depois do elogio, nunca "Segue o relatório".
  assert.match(composeHenryDailyReport({ assistant: { text: "Bom dia, Matheus. Nada urgente." } }, { compliment: "Bela camisa!", intro: "Bora pro resumo de hoje." }), /^Bom dia, Matheus\. Bela camisa! Bora pro resumo de hoje\. Nada urgente\.$/);
});

test("rota: corpo limitado e imagem só pela regra única", () => {
  const source = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(source, /MAX_BODY_CHARS/);
  assert.match(source, /status: 413/);
  assert.match(source, /shouldUseHenryImage\(\{ vision, mode, question \}\) \? parseHenryImage\(body\?\.image\) : null/);
  assert.doesNotMatch(source, /console\.[a-z]+\([^)]*image/);
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.doesNotMatch(lib, /console\.[a-z]+\([^)]*(image|data\))/);
});

test("velocidade: cache curto de leitura (mesma chave = uma leitura; falha sai do cache; vence no prazo)", async () => {
  const { createHenryReadCache } = await import("../lib/henry-voice-core.mjs");
  let clock = 0;
  let calls = 0;
  const cache = createHenryReadCache({ ttlMs: 45000, now: () => clock });
  const loader = async () => {
    calls += 1;
    return calls;
  };
  assert.equal(await cache.read("a", loader), 1);
  assert.equal(await cache.read("a", loader), 1); // pedidos seguidos: uma leitura só
  clock = 44999;
  assert.equal(await cache.read("a", loader), 1);
  clock = 45000;
  assert.equal(await cache.read("a", loader), 2); // venceu
  const failing = cache.read("b", async () => {
    throw new Error("falhou");
  });
  await assert.rejects(failing);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await cache.read("b", async () => "ok"), "ok"); // falha não fica no cache
});

test("velocidade: resposta sem esperar gravações e sem confirmação; relatório e Início juntos", () => {
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.doesNotMatch(lib, /await recordAiUsage/);
  assert.match(lib, /getPainelInicioDono\(auth, inicioPromise\)/);
  assert.match(lib, /withTimeout\(buildCompliment\(auth, image, style\), COMPLIMENT_TIMEOUT_MS\)/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /mode === "warm"/);
});

test("palavra de chamada: nome forte em qualquer posição chama; a pergunta é o resto (dono, 2026-10-22)", () => {
  const end = detectWakeWord("quantos por cento falta para bater a meta de hoje henry");
  assert.equal(end.called, true);
  assert.equal(end.kind, "question");
  assert.equal(end.question, "quantos por cento falta para bater a meta de hoje");
  assert.equal(detectWakeWord("Quantos leads hoje, Henry?").question, "Quantos leads hoje");
  assert.equal(detectWakeWord("e aí quantos leads enri").question, "e aí quantos leads");
  assert.equal(detectWakeWord("o henrique ligou").called, false); // fraco só depois de saudação
  assert.equal(detectWakeWord("tudo bem, Henry").kind, "wake");
});

test("visão: perguntas sobre o próprio dono e o que está à vista abrem a câmera (dono, 2026-10-22)", async () => {
  const { isVisualQuestion: visual } = await import("../lib/henry-voice-core.mjs");
  for (const phrase of ["eu estou com ou sem boné?", "vc tem acesso à câmera, esqueceu?", "que cor é minha camisa", "como estou?", "você me vê?", "está me vendo?", "o que eu tenho na mão", "estou usando óculos?", "repara no meu relógio", "que roupa estou usando"]) {
    assert.equal(visual(phrase), true, phrase);
  }
  for (const phrase of ["como estou na meta?", "estou com 3 clientes atrasados?", "olha a meta da equipe", "quantos leads hoje?"]) {
    assert.equal(visual(phrase), false, phrase);
  }
  // Digitado passa pela mesma função (ask → isVisualQuestion) e o servidor confere de novo (shouldUseHenryImage).
  const src = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(src, /visionRef\.current && \(mode === "report" \|\| isVisualQuestion\(question\)\)/);
});

test("visão: estado da câmera vai ao modelo em cada pedido", async () => {
  const { buildHenryVisionNote, VISION_ON_NO_IMAGE_REPLY } = await import("../lib/henry-voice-core.mjs");
  const withImage = buildHenryVisionNote({ vision: true, withImage: true });
  assert.match(withImage, /LIGADA/);
  assert.match(withImage, /Não comente corpo, rosto, pele nem idade/);
  const noImage = buildHenryVisionNote({ vision: true, withImage: false });
  assert.match(noImage, /SÓ quando uma imagem vem junto/);
  assert.ok(noImage.includes(VISION_ON_NO_IMAGE_REPLY));
  assert.match(noImage, /Nunca diga que não tem acesso à câmera/);
  const off = buildHenryVisionNote({ vision: false });
  assert.match(off, /DESLIGADA/);
  assert.match(off, /botão da câmera/);
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(lib, /buildHenryVisionNote\(\{ vision, withImage \}\)/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /answerHenry\(auth, \{[^}]*vision, webSearch[,}]/);
  assert.match(route, /answerStream\(auth, \{[^}]*vision, webSearch[^}]*\}, style\)/);
});
