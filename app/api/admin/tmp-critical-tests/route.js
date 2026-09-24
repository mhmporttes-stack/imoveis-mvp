import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { processWhatsappWebhook } from "@/lib/whatsapp-master";
import { markConversationHumanReply, listClientIdsWithHumanAttendance, isHumanAttendingPhone } from "@/lib/whatsapp-attendance";
import { processBroadcastQueueBatch, recoverStuckBroadcastMessages } from "@/lib/whatsapp-broadcasts";
import { recordOutboundAutomationMessage, sendChatMessage } from "@/lib/whatsapp-chat";

// ROTA TEMPORÁRIA DE TESTES (apagada logo após o uso). Protegida por segredo (hash).
// Só telefones fictícios com DDD 00 (nunca chamam a Meta — ver dryRunForFictionalRecipient).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SECRET_HASH = "5ac23929ec4ec24c5c94b985cc2b4c87e815ce7fb582a7254e8541e3b999fd85";
const PHONES = { new9: "5500999990011", new9No9: "550099990011", sim: "5500999990012", human: "5500999990013", chat: "5500999990014" };
const E164 = (digits) => `+${digits}`;
const wamid = (tag) => `wamid.TESTECRIT.${tag}.${randomUUID()}`;
const SET_NULL_TABLES = ["client_origins", "client_attribution_touches", "client_meta_attribution", "crm_notifications", "lead_distribution_history", "calendar_activities"];
const CASCADE_TABLES = ["client_journeys", "client_journey_events", "client_status_history", "crm_automation_executions", "client_tags", "daily_goal_rounds"];
// Cron do CRM (automações) roda no segundo :00 de cada minuto. Os clientes de teste só existem entre :10 e :50.
const WINDOW = { from: 10, to: 20 };
const BUDGET_MS = 36000;

function payload(waId, messageId, text) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "TESTE", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID, display_phone_number: "TESTE" },
      contacts: [{ wa_id: waId, profile: { name: "TESTE CRITICO" } }],
      messages: [{ from: waId, id: messageId, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }]
    } }] }]
  };
}

function statusPayload(recipient, messageId, callback) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "TESTE", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID, display_phone_number: "TESTE" },
      statuses: [{ id: messageId, status: "sent", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: recipient, biz_opaque_callback_data: callback }]
    } }] }]
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  if (createHash("sha256").update(url.searchParams.get("k") || "").digest("hex") !== SECRET_HASH) return NextResponse.json({ error: "no" }, { status: 404 });
  const phase = url.searchParams.get("phase") || "";
  const startedAt = Date.now();
  const serverSecond = new Date().getSeconds();

  if (phase === "clients" && (serverSecond < WINDOW.from || serverSecond > WINDOW.to)) {
    return NextResponse.json({ ok: false, reason: "fora_da_janela_do_cron", serverSecond });
  }
  if (phase === "clients") return runClientsPhase(startedAt);
  if (phase === "broadcast") return runBroadcastPhase();
  return NextResponse.json({ error: "phase" }, { status: 400 });
}

async function runClientsPhase(startedAt) {
  const db = getSupabaseAdminClient();
  const results = {};
  const notes = [];
  const createdClientIds = new Set();
  const testPhoneE164 = Object.values(PHONES).map(E164);
  const overBudget = () => Date.now() - startedAt > BUDGET_MS;
  globalThis.__waDryRun = [];

  const { data: usersBefore } = await db.from("admin_users").select("id, lead_distribution_position");
  const { data: stateBefore } = await db.from("lead_distribution_state").select("*").eq("id", "default").maybeSingle();
  let stateAfterMine = null;

  const clientsByPhone = async (phones) => {
    const { data } = await db.from("simulation_registrations").select("id, phone_normalized, full_name, responsible_user_id").in("phone_normalized", phones);
    (data || []).forEach((row) => createdClientIds.add(row.id));
    return data || [];
  };
  const conversationsByPhone = async (phones) => {
    const { data } = await db.from("whatsapp_conversations").select("id, contact_phone, last_human_reply_at, client_id").in("contact_phone", phones);
    return data || [];
  };
  const eventCount = async (id) => (await db.from("whatsapp_master_events").select("id", { count: "exact", head: true }).eq("message_id", id)).count;
  const snapState = async () => (await db.from("lead_distribution_state").select("*").eq("id", "default").maybeSingle()).data;

  try {
    // A) cliente novo + número COM o 9 ("Sim" -> roleta cria o cliente)
    const a1 = wamid("A");
    const resA = await processWhatsappWebhook(payload(PHONES.new9, a1, "Sim"));
    let clients = await clientsByPhone([E164(PHONES.new9)]);
    results.A_cliente_novo_criado = { pass: clients.length === 1, clientes: clients.length, webhook: resA };
    stateAfterMine = await snapState();

    // B) webhook duplicado (mesmo ID) -> nada novo
    const resB = await processWhatsappWebhook(payload(PHONES.new9, a1, "Sim"));
    clients = await clientsByPhone([E164(PHONES.new9)]);
    results.B_webhook_duplicado = { pass: clients.length === 1 && resB.inserted === 0 && (await eventCount(a1)) === 1, inserted: resB.inserted, clientes: clients.length };

    // C) cliente existente + número SEM o 9 -> mesmo cliente, mesma conversa
    await processWhatsappWebhook(payload(PHONES.new9No9, wamid("C"), "Sim"));
    clients = await clientsByPhone([E164(PHONES.new9), E164(PHONES.new9No9)]);
    const convs = await conversationsByPhone([E164(PHONES.new9), E164(PHONES.new9No9)]);
    results.C_numero_sem_9 = { pass: clients.length === 1 && convs.length === 1, clientes: clients.length, conversas: convs.length, telefoneConversa: convs[0]?.contact_phone };

    // D) duas respostas "sim" simultâneas (mesmo telefone) -> 1 cliente
    if (!overBudget()) {
      await Promise.all([
        processWhatsappWebhook(payload(PHONES.sim, wamid("D1"), "sim")),
        processWhatsappWebhook(payload(PHONES.sim, wamid("D2"), "Sim!"))
      ]);
      clients = await clientsByPhone([E164(PHONES.sim)]);
      const convD = await conversationsByPhone([E164(PHONES.sim)]);
      results.D_dois_sim_simultaneos = { pass: clients.length === 1 && convD.length === 1, clientes: clients.length, conversas: convD.length };
      stateAfterMine = await snapState();
    } else results.D_dois_sim_simultaneos = { pass: null, skipped: "orçamento de tempo" };

    // E) "simulação" não casa com "sim"; atendimento humano bloqueia a automação; volta após 30 min
    if (!overBudget()) {
      await processWhatsappWebhook(payload(PHONES.human, wamid("E0"), "Quero fazer uma simulação"));
      let humanClients = await clientsByPhone([E164(PHONES.human)]);
      const convHuman = (await conversationsByPhone([E164(PHONES.human)]))[0];
      results.E1_simulacao_nao_casa_com_sim = { pass: humanClients.length === 0 && Boolean(convHuman), clientes: humanClients.length };
      await markConversationHumanReply(convHuman.id, new Date());
      await processWhatsappWebhook(payload(PHONES.human, wamid("E1"), "Sim"));
      humanClients = await clientsByPhone([E164(PHONES.human)]);
      results.E2_automacao_durante_atendimento_humano = { pass: humanClients.length === 0 && (await isHumanAttendingPhone(E164(PHONES.human))) === true, clientes: humanClients.length };
      await db.from("whatsapp_conversations").update({ last_human_reply_at: new Date(Date.now() - 40 * 60 * 1000).toISOString() }).eq("id", convHuman.id);
      await processWhatsappWebhook(payload(PHONES.human, wamid("E2"), "Sim"));
      humanClients = await clientsByPhone([E164(PHONES.human)]);
      results.E3_automacao_volta_apos_30min = { pass: humanClients.length === 1, clientes: humanClients.length };
      stateAfterMine = await snapState();
    } else results.E = { pass: null, skipped: "orçamento de tempo" };

    // F) mensagem automática nunca conta como atendimento humano
    const convAuto = (await conversationsByPhone([E164(PHONES.new9)]))[0];
    await db.from("whatsapp_conversations").update({ last_human_reply_at: null }).eq("id", convAuto.id);
    await recordOutboundAutomationMessage({ phone: E164(PHONES.new9), text: "teste automática", metaMessageId: wamid("F"), automationId: null, metadata: { kind: "teste" } });
    const afterAuto = (await conversationsByPhone([E164(PHONES.new9)]))[0];
    results.F_mensagem_automatica_nao_marca_humano = { pass: afterAuto.last_human_reply_at === null };

    // G) resposta humana pelo Chat (envio SIMULADO, número fictício) marca o atendimento humano
    if (!overBudget()) {
      await processWhatsappWebhook(payload(PHONES.chat, wamid("G0"), "oi"));
      const convChat = (await conversationsByPhone([E164(PHONES.chat)]))[0];
      const { data: owner } = await db.from("admin_users").select("id").eq("email", "mhmporttes@gmail.com").maybeSingle();
      const auth = { user: { email: "mhmporttes@gmail.com" }, profile: { id: owner?.id || null, name: "TESTE CRITICO", role: "admin", email: "mhmporttes@gmail.com" } };
      let sendOutcome = "ok";
      try { await sendChatMessage(convChat.id, "teste (número fictício, envio simulado)", auth); } catch (error) { sendOutcome = `erro:${String(error?.message || error).slice(0, 160)}`; }
      const afterChat = (await conversationsByPhone([E164(PHONES.chat)]))[0];
      results.G_resposta_humana_no_chat = { pass: sendOutcome === "ok" && Boolean(afterChat.last_human_reply_at), sendOutcome, marcado: Boolean(afterChat.last_human_reply_at) };
    }

    // H) regra de redistribuição: cliente atendido por humano é protegido (clientes 'archived', sem corretor)
    if (!overBudget()) {
      const baseClient = {
        simulation_type: "individual", phone: "(00) 99999-0020", oldest_birth_date: "1900-01-01", primary_income_type: "self_employed_unregistered",
        primary_profession: "Nao informado", primary_monthly_income: 0, has_over_three_years_registered_work: false, has_children_under_18: false,
        primary_marital_status: "single", has_residential_property: false, status: "archived", distribution_type: "round_robin"
      };
      const mk = async (n, phone) => {
        const { data, error } = await db.from("simulation_registrations").insert({ ...baseClient, full_name: `TESTE CRITICO H${n}`, phone_normalized: phone }).select("id").single();
        if (error) throw error;
        createdClientIds.add(data.id);
        return data.id;
      };
      const hA = await mk("A", "+5500999990021"), hB = await mk("B", "+5500999990022"), hC = await mk("C", "+5500999990023");
      const changedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      testPhoneE164.push("+5500999990021", "+5500999990022", "+5500999990023");
      await db.from("whatsapp_conversations").insert([
        { contact_phone: "+5500999990021", client_id: hA, last_human_reply_at: new Date().toISOString() },
        { contact_phone: "+5500999990022", client_id: hB, last_human_reply_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        { contact_phone: "+5500999990023", client_id: hC, last_human_reply_at: null }
      ]);
      const protectedIds = await listClientIdsWithHumanAttendance([hA, hB, hC].map((id) => ({ id, responsible_changed_at: changedAt, created_at: changedAt })));
      results.H_redistribuicao_protege_atendido = { pass: protectedIds.has(hA) && !protectedIds.has(hB) && !protectedIds.has(hC), protegidos_A_B_C: [hA, hB, hC].map((id) => protectedIds.has(id)) };
    }

    // Efeitos laterais gravados pelos triggers do banco nos clientes de teste (antes de apagar)
    const ids = [...createdClientIds];
    const efeitos = {};
    for (const table of [...SET_NULL_TABLES, ...CASCADE_TABLES]) {
      const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).in("client_id", ids);
      efeitos[table] = error ? `n/d (${error.message.slice(0, 40)})` : count;
    }
    results.efeitos_gravados_antes_de_apagar = efeitos;
    results.envios_simulados = (globalThis.__waDryRun || []).map((item) => `${item.kind}→…${item.recipient.slice(-4)}`);
    results.clientes_de_teste_com_corretor_real = (await clientsByPhone(testPhoneE164)).filter((row) => row.responsible_user_id).length;
  } catch (error) {
    results.ERRO = String(error?.stack || error).slice(0, 1500);
  } finally {
    const cleanup = {};
    try {
      await clientsByPhone(testPhoneE164);
      const ids = [...createdClientIds];
      const { data: convRows } = await db.from("whatsapp_conversations").select("id").in("contact_phone", testPhoneE164);
      const convIds = (convRows || []).map((row) => row.id);
      if (convIds.length) await db.from("whatsapp_flow_sessions").delete().in("conversation_id", convIds);
      await db.from("whatsapp_flow_logs").delete().in("contact_phone", testPhoneE164);
      await db.from("whatsapp_master_events").delete().like("message_id", "wamid.TESTECRIT.%");
      if (convIds.length) await db.from("whatsapp_conversations").delete().in("id", convIds);
      if (ids.length) {
        for (const table of SET_NULL_TABLES) await db.from(table).delete().in("client_id", ids);
        const { error } = await db.from("simulation_registrations").delete().in("id", ids);
        cleanup.clientesApagados = error ? `ERRO ${error.message}` : ids.length;
      }
      // contadores das regras de resposta automática: o envio simulado conta como resposta.
      // Subtrai EXATAMENTE o que os testes somaram (há tráfego real no sistema — nunca sobrescreve com valor antigo).
      const { data: rules } = await db.from("whatsapp_automation_replies").select("id, keyword, response_message, triggered_count");
      const textSends = (globalThis.__waDryRun || []).filter((item) => item.kind === "text");
      cleanup.contadoresSubtraidos = {};
      for (const rule of rules || []) {
        const prefix = String(rule.response_message || "").slice(0, 25);
        const mine = prefix ? textSends.filter((item) => item.text.startsWith(prefix)).length : 0;
        if (mine) {
          await db.from("whatsapp_automation_replies").update({ triggered_count: Math.max(0, (rule.triggered_count || 0) - mine) }).eq("id", rule.id);
          cleanup.contadoresSubtraidos[rule.keyword] = mine;
        }
      }
      // fila da roleta
      const stateNow = await snapState();
      if (stateAfterMine && stateNow && stateNow.updated_at === stateAfterMine.updated_at && usersBefore) {
        for (const user of usersBefore) await db.from("admin_users").update({ lead_distribution_position: user.lead_distribution_position }).eq("id", user.id);
        if (stateBefore) await db.from("lead_distribution_state").upsert(stateBefore);
        cleanup.filaRoletaRestaurada = true;
      } else {
        cleanup.filaRoletaRestaurada = stateAfterMine ? "PULADA (outro lead mexeu na fila durante o teste)" : "não houve mudança";
      }
    } catch (cleanupError) {
      cleanup.erroLimpeza = String(cleanupError?.message || cleanupError);
    }
    results.limpeza = cleanup;
    results.duracao_ms = Date.now() - startedAt;
    results.segundo_de_inicio = new Date(startedAt).getSeconds();
    results.notas = notes;
  }
  return NextResponse.json(results);
}

async function runBroadcastPhase() {
  const db = getSupabaseAdminClient();
  const results = {};
  const broadcastIds = [];
  globalThis.__waDryRun = [];
  try {
    // I) "Disparar agora" + cron simultâneos: cada mensagem enviada UMA vez
    const { data: bc, error: bcError } = await db.from("whatsapp_broadcasts").insert({ campaign_name: "TESTE CRITICO 3", template_name: "teste_critico", status: "processing" }).select("id").single();
    if (bcError) throw bcError;
    broadcastIds.push(bc.id);
    const rows = Array.from({ length: 10 }, (_, i) => ({ broadcast_id: bc.id, full_name: `T${i}`, phone_normalized: `+55009999901${String(i).padStart(2, "0")}`, queued_at: new Date(Date.now() - (20 - i) * 1000).toISOString() }));
    const { error: msgError } = await db.from("whatsapp_broadcast_messages").insert(rows);
    if (msgError) throw msgError;
    await Promise.all([processBroadcastQueueBatch(bc.id, 25000), processBroadcastQueueBatch(bc.id, 25000), processBroadcastQueueBatch(bc.id, 25000)]);
    const { data: bmsgs } = await db.from("whatsapp_broadcast_messages").select("id, status, attempts, audit, whatsapp_message_id").eq("broadcast_id", bc.id);
    const claimedOnce = (bmsgs || []).every((m) => (m.audit || []).filter((e) => e.event === "claimed").length === 1);
    const totalAttempts = (bmsgs || []).reduce((sum, m) => sum + (m.attempts || 0), 0);
    const simulados = (globalThis.__waDryRun || []).filter((item) => item.kind === "template");
    const porTelefone = simulados.reduce((acc, item) => ({ ...acc, [item.recipient]: (acc[item.recipient] || 0) + 1 }), {});
    results.I_disparo_3_processos_simultaneos = {
      pass: bmsgs?.length === 10 && claimedOnce && totalAttempts === 10 && Object.values(porTelefone).every((n) => n === 1),
      mensagens: bmsgs?.length, totalTentativas: totalAttempts, todasAdquiridasUmaVez: claimedOnce,
      envios_simulados_por_telefone_max: Math.max(0, ...Object.values(porTelefone)), envios_simulados_total: simulados.length,
      status: [...new Set((bmsgs || []).map((m) => m.status))]
    };

    // J) interrupção durante o processamento + recuperação segura
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const r1Wamid = null;
    const { data: stuck } = await db.from("whatsapp_broadcast_messages").insert([
      { broadcast_id: bc.id, full_name: "R1", phone_normalized: "+5500999990151", status: "processing", processing_started_at: old, claim_token: randomUUID() },
      { broadcast_id: bc.id, full_name: "R2", phone_normalized: "+5500999990152", status: "processing", processing_started_at: old, send_started_at: old, claim_token: randomUUID() }
    ]).select("id, full_name");
    const r1 = stuck.find((row) => row.full_name === "R1").id, r2 = stuck.find((row) => row.full_name === "R2").id;
    await db.from("whatsapp_broadcasts").update({ status: "processing" }).eq("id", bc.id);
    globalThis.__waDryRun = [];
    const recovered = await recoverStuckBroadcastMessages(300);
    const { data: afterRecover } = await db.from("whatsapp_broadcast_messages").select("id, status, error_code, attempts").in("id", [r1, r2]);
    const s1 = afterRecover.find((m) => m.id === r1), s2 = afterRecover.find((m) => m.id === r2);
    await processBroadcastQueueBatch(bc.id, 15000);
    const { data: afterBatch } = await db.from("whatsapp_broadcast_messages").select("id, status, error_code, attempts").in("id", [r1, r2]);
    const f1 = afterBatch.find((m) => m.id === r1), f2 = afterBatch.find((m) => m.id === r2);
    const enviadosApos = (globalThis.__waDryRun || []).map((item) => item.recipient.slice(-4));
    results.J_recuperacao_de_mensagem_presa = {
      pass: recovered.requeued === 1 && recovered.delivery_unknown === 1 && s1.status === "queued" && s2.status === "failed" && s2.error_code === "delivery_unknown" && f1.attempts === 1 && f2.attempts === 0 && f2.status === "failed" && !enviadosApos.includes("0152"),
      recover: recovered, r1_apos_recuperar: s1.status, r2_apos_recuperar: `${s2.status}/${s2.error_code}`,
      r1_apos_lote: `${f1.status} tentativas=${f1.attempts}`, r2_apos_lote: `${f2.status} tentativas=${f2.attempts}`, r2_reenviada: enviadosApos.includes("0152")
    };

    // K) o aviso de status da Meta chega depois para a mensagem 'delivery_unknown' -> reconcilia sem reenviar
    const fakeWamid = wamid("K");
    await processWhatsappWebhook(statusPayload("5500999990152", fakeWamid, `bcm:${r2}`));
    const { data: rec } = await db.from("whatsapp_broadcast_messages").select("status, whatsapp_message_id, error_code").eq("id", r2).maybeSingle();
    results.K_reconciliacao_por_webhook = { pass: rec?.status === "sent" && rec?.whatsapp_message_id === fakeWamid && !rec?.error_code, estado: `${rec?.status}/${rec?.error_code || "-"}` };
  } catch (error) {
    results.ERRO = String(error?.stack || error).slice(0, 1500);
  } finally {
    const cleanup = {};
    try {
      await db.from("whatsapp_master_events").delete().like("message_id", "wamid.TESTECRIT.%");
      if (broadcastIds.length) await db.from("whatsapp_broadcasts").delete().in("id", broadcastIds);
      const { count } = await db.from("whatsapp_broadcast_messages").select("id", { count: "exact", head: true }).like("phone_normalized", "+5500%");
      cleanup.mensagensDeTesteRestantes = count;
    } catch (cleanupError) {
      cleanup.erroLimpeza = String(cleanupError?.message || cleanupError);
    }
    results.limpeza = cleanup;
  }
  return NextResponse.json(results);
}
