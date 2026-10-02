import test from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_KIND,
  REPLY_ACTION,
  decideProspectingReplyAction,
  isAlertStillValid,
  isClearOptOut,
  isInProspecting,
  pickAlertBroker,
  runIndependentConsumers
} from "../lib/prospecting-reply-core.mjs";

// Resposta à Prospecção pelo WhatsApp (pedido do dono, 2026-10-02). Casos
// sintéticos, sem mensagem real.
const ATTEMPT_AT = "2026-10-02T12:00:00.000Z";
const AFTER = "2026-10-02T12:30:00.000Z";
const prospectingContact = { id: "k1", status: "claimed", assigned_user_id: "b1", last_attempt_at: ATTEMPT_AT };
const base = { clientId: "c1", clientStatus: "awaiting_return", contacts: [prospectingContact], messageAt: AFTER };
const decide = (text, extra = {}) => decideProspectingReplyAction({ ...base, text, ...extra });

test("resposta normal de cliente em prospecção -> ALERT_REPLY (vira Em atendimento sozinho; pendência só sem corretor responsável)", () => {
  for (const text of ["oi", "Oi, tudo bem?", "sim", "Tenho interesse", "como funciona?", "qual valor?", "Me chama amanhã", "agora não", "me chama depois", "vou pensar", "quem é?", "👍"]) {
    assert.equal(decide(text), REPLY_ACTION.ALERT_REPLY, text);
  }
});

test("pedido claro para parar -> Não contactar automático", () => {
  for (const text of ["Parar", "PARE", "pode parar", "Não tenho interesse", "não quero", "Não quero mais", "não me chame", "Não me mande mais mensagens", "não me mande mensagem", "Não entre em contato", "remova meu contato", "me tira da lista", "sem interesse", "Não tenho interesse, obrigado", "boa tarde, não quero", "sair", "cancelar"]) {
    assert.equal(decide(text), REPLY_ACTION.OPT_OUT, text);
  }
});

test("dúvida sobre a intenção nunca vira opt-out automático", () => {
  for (const text of ["não tenho interesse agora", "Não tenho interesse no momento", "agora não", "não quero esse, tem outro?", "não quero pagar entrada", "para", "não", "não sei", "quanto é a parcela? se for cara não quero", "não posso falar agora", "vou cancelar minha viagem amanhã", "não me chame de manhã"]) {
    assert.equal(isClearOptOut(text), false, text);
    assert.equal(decide(text), REPLY_ACTION.ALERT_REPLY, text);
  }
});

test("mensagem do próprio corretor nunca dispara a automação", () => {
  assert.equal(decide("parar", { fromMe: true }), REPLY_ACTION.IGNORE);
  assert.equal(decide("oi", { fromMe: true }), REPLY_ACTION.IGNORE);
});

test("cliente fora da prospecção (sem tentativa, outro status) -> só o Chat", () => {
  assert.equal(decide("oi", { clientStatus: "in_service" }), REPLY_ACTION.IGNORE);
  assert.equal(decide("parar", { clientStatus: "in_service" }), REPLY_ACTION.IGNORE);
  assert.equal(decide("oi", { contacts: [{ ...prospectingContact, last_attempt_at: null }] }), REPLY_ACTION.IGNORE);
  assert.equal(decide("oi", { contacts: [] }), REPLY_ACTION.IGNORE);
  assert.equal(decide("oi", { clientId: "" }), REPLY_ACTION.IGNORE);
});

test("evento antigo reentregue (anterior à tentativa) não cria alerta falso", () => {
  assert.equal(decide("oi", { messageAt: "2026-10-01T09:00:00.000Z" }), REPLY_ACTION.IGNORE);
  assert.equal(isInProspecting({ clientStatus: "awaiting_return", contacts: [prospectingContact], messageAt: "2026-10-02T11:59:00.000Z" }), true, "folga de relógio de 2 min");
});

test("Não contactar + nova mensagem -> pendência de reativação, nunca reativa sozinho", () => {
  assert.equal(decide("oi, ainda tem aquele apartamento?", { clientStatus: "do_not_contact" }), REPLY_ACTION.ALERT_REACTIVATION);
  assert.equal(decide("parar", { clientStatus: "do_not_contact" }), REPLY_ACTION.IGNORE);
});

test("pendência se resolve sozinha quando o status mudou por outro caminho", () => {
  assert.equal(isAlertStillValid(ALERT_KIND.REPLY, "awaiting_return"), true);
  assert.equal(isAlertStillValid(ALERT_KIND.REPLY, "in_service"), false);
  assert.equal(isAlertStillValid(ALERT_KIND.REPLY, "do_not_contact"), false);
  assert.equal(isAlertStillValid(ALERT_KIND.REACTIVATION, "do_not_contact"), true);
  assert.equal(isAlertStillValid(ALERT_KIND.REACTIVATION, "in_service"), false);
});

test("pendência vai para o responsável atual (preserva atribuição)", () => {
  assert.equal(pickAlertBroker({ responsibleUserId: "r1", contacts: [prospectingContact], sessionUserId: "s1" }), "r1");
  assert.equal(pickAlertBroker({ responsibleUserId: "", contacts: [prospectingContact], sessionUserId: "s1" }), "b1");
  assert.equal(pickAlertBroker({ responsibleUserId: "", contacts: [{ last_broker_id: "lb" }], sessionUserId: "s1" }), "lb");
  assert.equal(pickAlertBroker({ responsibleUserId: "", contacts: [], sessionUserId: "s1" }), "s1");
});

// Simula o banco da pendência com a MESMA regra do índice único parcial
// (uma aberta por cliente) e da idempotência por wa_message_id.
function fakeStore() {
  const processed = new Set();
  const alerts = [];
  return {
    alerts,
    handle(event) {
      if (event.waMessageId && processed.has(event.waMessageId)) return "duplicado";
      if (event.waMessageId) processed.add(event.waMessageId);
      const action = decideProspectingReplyAction({ ...base, ...event });
      if (action === REPLY_ACTION.ALERT_REPLY) {
        const open = alerts.find((alert) => alert.clientId === base.clientId && alert.status === "open");
        if (open) open.count += 1;
        else alerts.push({ clientId: base.clientId, status: "open", count: 1 });
      }
      return action;
    }
  };
}

test("3 mensagens seguidas -> 1 pendência; evento repetido não duplica", () => {
  const store = fakeStore();
  store.handle({ text: "oi", waMessageId: "m1" });
  store.handle({ text: "tudo bem?", waMessageId: "m2" });
  store.handle({ text: "tenho interesse", waMessageId: "m3" });
  assert.equal(store.handle({ text: "tenho interesse", waMessageId: "m3" }), "duplicado");
  assert.equal(store.alerts.length, 1);
  assert.equal(store.alerts[0].count, 3);
});

test("falha do Chat não impede a automação da Prospecção (e vice-versa)", async () => {
  let prospectingRan = false;
  const results = await runIndependentConsumers({
    prospecting: async () => { prospectingRan = true; return { outcome: "alert_reply" }; },
    chat: async () => { throw new Error("falha simulada ao gravar no Chat"); }
  });
  assert.equal(prospectingRan, true);
  assert.deepEqual(results.prospecting, { ok: true, value: { outcome: "alert_reply" } });
  assert.equal(results.chat.ok, false);

  let chatRan = false;
  const reverse = await runIndependentConsumers({
    prospecting: () => { throw new Error("falha síncrona na Prospecção"); },
    chat: async () => { chatRan = true; return { conversationId: "x" }; }
  });
  assert.equal(chatRan, true);
  assert.equal(reverse.prospecting.ok, false);
  assert.equal(reverse.chat.ok, true);
});

// Opção B do dono (2026-10-02): "Não contactar" automático só com intenção
// INEQUÍVOCA — número errado, pessoa errada ou negativa clara sozinha.
test("opção B: número errado / pessoa errada / negativa clara -> Não contactar automático", () => {
  const clear = [
    "Número errado", "numero errado!", "Esse número está errado", "esse telefone é errado", "Foi engano",
    "Você ligou pra pessoa errada", "vc mandou mensagem pro número errado", "Pessoa errada", "Desculpe, número errado",
    "Não sou eu", "não sou o cliente", "Não sou o Carlos", "Não sou a Maria Silva", "não é comigo", "Aqui não mora ninguém com esse nome",
    "Não tenho interesse", "não tenho interesse.", "Não tenho interesse, obrigado", "NÃO TENHO INTERESSE!!!", "Sem interesse", "não estou interessada",
    "Infelizmente não tenho interesse"
  ];
  for (const text of clear) {
    assert.equal(isClearOptOut(text), true, text);
    assert.equal(decide(text), REPLY_ACTION.OPT_OUT, text);
  }
});

test("opção B: ambíguo, temporário, condicional ou pergunta -> permanece Em atendimento (ALERT_REPLY)", () => {
  const ambiguous = [
    "agora não", "no momento não", "não tenho interesse agora", "Não tenho interesse no momento", "por enquanto não",
    "depois eu te chamo", "outro momento", "mais pra frente talvez", "não tenho interesse nesse imóvel, mas quero outro",
    "não tenho interesse, mas se baixar o valor eu vejo", "não tenho interesse por enquanto", "não tenho interesse. me chama em dezembro? aí eu vejo",
    "não tenho interesse quando posso ver outro?", "não sou o dono, fala com meu marido", "não sou o responsável", "não sou o pai dele",
    "número errado? quem é?", "não sou eu quem decide", "não sou o Carlos mas conheço ele", "não tenho interesse?", "não tenho interesse ou não posso agora",
    "não sou o titular do imóvel", "tenho interesse", "oi", "quem é você?", "esse número mudou, me chama no outro", "não sei"
  ];
  for (const text of ambiguous) {
    assert.equal(isClearOptOut(text), false, text);
    assert.equal(decide(text), REPLY_ACTION.ALERT_REPLY, text);
  }
});

test("opção B: Não contactar que escreve de novo continua pendência de reativação (não reativa sozinho)", () => {
  assert.equal(decide("agora posso sim, me chama", { clientStatus: "do_not_contact" }), REPLY_ACTION.ALERT_REACTIVATION);
  assert.equal(decide("número errado", { clientStatus: "do_not_contact" }), REPLY_ACTION.IGNORE);
});
