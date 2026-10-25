import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TEAM_ALERT_TEXT_MAX,
  isTeamAlertRequest,
  normalizeTeamAlertText,
  resolveTeamAlertRecipient,
  teamAlertAskReply,
  teamAlertNotFoundReply,
  teamAlertSentDetail,
  teamAlertSentReply
} from "../lib/henry-team-alert-core.mjs";
import { HENRY_TOOL_ACCESS } from "../lib/henry-voice-core.mjs";
import { isHenryToolLocked } from "../lib/henry-lock-core.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";

// Henry manda recado à equipe (HENRY-1 "Recado à equipe", REGRA OFICIAL — dono, 2026-10-25): "Eu digo 'Henry, peça para a
// Carol vir até a minha sala', ele escreve e envia aquela mesma mensagem que eu envio pela Meta Diária." + "Sem sim, ele
// apenas envia, não preciso confirmar nada."

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const OWNER = "owner-1";
const TEAM = [
  { id: OWNER, name: "Matheus Machado", gender: "male", status: "active" },
  { id: "u1", name: "Carol Souza", gender: "female", status: "active" },
  { id: "u2", name: "Carolina Lima", gender: "female", status: "active" },
  { id: "u3", name: "Gabriel Reis", gender: "male", status: "active" },
  { id: "u4", name: "Bruna Dias", gender: "female", status: "inactive" }
];

test("destinatário: um só → envia para ele; nome completo desfaz a dúvida", () => {
  const one = resolveTeamAlertRecipient("o Gabriel", TEAM, { ownerId: OWNER });
  assert.equal(one.kind, "one");
  assert.equal(one.user.id, "u3");
  assert.equal(resolveTeamAlertRecipient("Carol Souza", TEAM, { ownerId: OWNER }).user.id, "u1");
  assert.equal(resolveTeamAlertRecipient("para a Carolina", TEAM, { ownerId: OWNER }).user.id, "u2");
});

test("destinatário ambíguo: devolve as opções e a pergunta (não escolhe sozinho)", () => {
  const many = resolveTeamAlertRecipient("Carol", TEAM.map((user) => (user.id === "u2" ? { ...user, name: "Carol Lima" } : user)), { ownerId: OWNER });
  assert.equal(many.kind, "many");
  assert.deepEqual(many.options.map((user) => user.id).sort(), ["u1", "u2"]);
  const ask = teamAlertAskReply(many.options);
  assert.match(ask, /a Carol Souza/);
  assert.match(ask, /a Carol Lima/);
  assert.match(ask, /Pra quem eu mando\?$/);
});

test("inexistente, inativo, o próprio dono: ninguém", () => {
  assert.equal(resolveTeamAlertRecipient("Zuleica", TEAM, { ownerId: OWNER }).kind, "none");
  assert.equal(resolveTeamAlertRecipient("Bruna", TEAM, { ownerId: OWNER }).kind, "none"); // inativa
  assert.equal(resolveTeamAlertRecipient("Matheus", TEAM, { ownerId: OWNER }).kind, "none"); // nunca para si mesmo
  assert.equal(resolveTeamAlertRecipient("", TEAM, { ownerId: OWNER }).kind, "none");
  assert.match(teamAlertNotFoundReply("Zuleica"), /Não achei ninguém ativo na equipe com o nome Zuleica\./);
});

test("texto do recado: limpo, com ponto, limitado", () => {
  assert.equal(normalizeTeamAlertText("  o Matheus pediu para você ir até a sala dele "), "O Matheus pediu para você ir até a sala dele.");
  assert.equal(normalizeTeamAlertText("\"Vem aqui!\""), "Vem aqui!");
  assert.equal(normalizeTeamAlertText("   "), "");
  assert.ok(normalizeTeamAlertText("a".repeat(900)).length <= TEAM_ALERT_TEXT_MAX + 1);
});

test("fala e tela depois do envio: 'Enviei para a Carol: …' e a tela só informa (sem botão de confirmar)", () => {
  const carol = TEAM[1];
  const text = "O Matheus pediu para você ir até a sala dele.";
  assert.equal(teamAlertSentReply(carol, text), 'Enviei para a Carol: "O Matheus pediu para você ir até a sala dele."');
  const detail = teamAlertSentDetail(carol, text);
  assert.equal(detail.title, "Recado enviado");
  assert.equal(detail.confirm, undefined); // decisão do dono: sem confirmação
  assert.match(teamAlertSentReply(carol, text, { training: true }), /^Modo treino: nada foi enviado/);
  assert.match(teamAlertSentDetail(carol, text, { training: true }).title, /não enviado/);
});

test("gatilho: peça/pede/chama/avisa/manda recado a alguém; perguntas comuns não", () => {
  for (const text of ["Henry, peça para a Carol vir até a minha sala", "pede pra carol vir aqui", "chama o Gabriel", "avisa a Bruna que a cliente chegou", "manda um recado pro Eduardo", "fala pra Carol vir aqui"]) {
    assert.equal(isTeamAlertRequest(text), true, text);
  }
  for (const text of ["me fala o ranking", "fala para mim o funil", "quantos clientes novos hoje?", "diz o artista", "avisa quando chegar cliente", "chama a atenção", "como tá a meta"]) {
    assert.equal(isTeamAlertRequest(text), false, text);
  }
});

test("classificação: 2ª escrita nomeada, direta, fechada com a tela bloqueada", () => {
  assert.equal(HENRY_TOOL_ACCESS.enviar_alerta_corretor, "escrita_interna_direta");
  assert.equal(isHenryToolLocked(HENRY_TOOL_ACCESS.enviar_alerta_corretor), true);
  assert.match(buildHenryStaticPrompt(), /enviar_alerta_corretor, que envia na hora, sem perguntar se pode/);
});

test("envio = a MESMA mensagem da Supervisão da Meta Diária, sem confirmação; ambíguo/inexistente e Treino não enviam; guard do dono", () => {
  const server = read("../lib/henry-team-alert.js");
  // mesmo caminho da Meta Diária (POST /api/admin/supervision-messages → sendSupervisionMessage); nenhuma escrita própria
  assert.match(server, /import \{ sendSupervisionMessage \} from "\.\/supervision-messages";/);
  assert.equal(server.match(/sendSupervisionMessage\(/g).length, 1);
  assert.doesNotMatch(server, /\.(insert|update|upsert|delete|rpc)\(|createAlertDeliveries|sendPush|whatsapp/i);
  const body = server.slice(server.indexOf("export async function sendHenryTeamAlert"));
  const sendAt = body.indexOf("await sendSupervisionMessage(");
  // guard (só o dono, conta real, fora de "Alterar conta") antes de tudo
  assert.ok(body.indexOf("isHenryEligible(") < sendAt);
  assert.match(body, /isOwner: isOwnerAdminEmail\(auth\?\.user\?\.email\)/);
  // ambíguo e inexistente saem ANTES do envio
  assert.ok(body.indexOf('match.kind === "many"') < sendAt);
  assert.ok(body.indexOf('match.kind !== "one"') < sendAt);
  // Treino sai ANTES do envio (simula)
  assert.ok(body.indexOf("if (training) return") > -1 && body.indexOf("if (training) return") < sendAt);
  // ferramenta: envia direto (sem passo de confirmação/"sim"), Treino pelo trainingStore
  const lib = read("../lib/henry-voice.js");
  const tool = lib.slice(lib.indexOf('if (name === "enviar_alerta_corretor")'), lib.indexOf('if (name === "spotify")'));
  assert.match(tool, /sendHenryTeamAlert\(auth, \{ destinatario: input\?\.destinatario, texto: input\?\.texto \}, \{ training: Boolean\(trainingStore\.getStore\(\)\) \}\)/);
  assert.doesNotMatch(tool, /morning|confirm|BIRTHDAY_ALERT_STEP/);
  // a rota do Henry continua só do dono
  assert.match(read("../app/api/admin/henry/route.js"), /const auth = await requireHenryOwner\(request\);/);
});

test("recado que cita meta/ranking não cai na rota direta de leitura (vai para o modelo e a ferramenta do recado)", async () => {
  const { henryDirectRoute } = await import("../lib/henry-voice-turn.mjs");
  for (const text of ["avisa a bruna que a meta da equipe foi batida", "chama o gabriel pra ver o ranking", "peça para a carol vir até a minha sala"]) {
    assert.equal(henryDirectRoute(text, { turns: [], today: "2026-10-25" }), null, text);
  }
  assert.ok(henryDirectRoute("como tá a meta do dia pra equipe?", { turns: [], today: "2026-10-25" })); // leitura segue igual
});
