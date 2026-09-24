import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { processWhatsappWebhook } from "@/lib/whatsapp-master";
import {
  deleteChatConversation,
  getChatConversation,
  getChatMessageMedia,
  listChatConversations,
  openChatForClient,
  sendChatInternalMessage,
  sendChatMessage
} from "@/lib/whatsapp-chat";

// ROTA TEMPORÁRIA DE TESTES (apagada logo após o uso). Protegida por segredo (hash).
// Só telefones fictícios com DDD 00 (o envio à Meta é simulado por trava temporária).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SECRET_HASH = "a422919f49c3514309fdb77c1532c27486d6e35e43a9dd9e830db4e6d31f9fb8";
const WINDOW = { from: 10, to: 20 };
const BUDGET_MS = 36000;
const wamid = (tag) => `wamid.TESTECRIT2.${tag}.${randomUUID()}`;
const E164 = (digits) => `+${digits}`;

function pay(waId, messageId, { text = "", referral = null, audioId = "" } = {}) {
  const message = { from: waId, id: messageId, timestamp: String(Math.floor(Date.now() / 1000)) };
  if (audioId) {
    message.type = "audio";
    message.audio = { id: audioId, mime_type: "audio/ogg; codecs=opus", sha256: "x", voice: true };
  } else {
    message.type = "text";
    message.text = { body: text };
  }
  if (referral) message.referral = referral;
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "TESTE", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID, display_phone_number: "TESTE" },
      contacts: [{ wa_id: waId, profile: { name: "TESTE CRITICO" } }],
      messages: [message]
    } }] }]
  };
}

const authFor = (user) => ({ user: { email: user.email }, profile: { id: user.id, name: user.name, role: user.role, status: user.status, email: user.email } });
async function expectError(fn) {
  try { await fn(); return { threw: false }; } catch (error) { return { threw: true, status: error?.status || null, code: error?.code || "", message: String(error?.message || "").slice(0, 120) }; }
}

async function loadStaff(db) {
  const { data } = await db.from("admin_users").select("id, name, email, role, status").eq("status", "active").in("role", ["admin", "manager", "broker"]);
  const byRole = (role) => (data || []).filter((user) => user.role === role);
  const brokers = byRole("broker");
  return { brokerA: brokers[0], brokerB: brokers[1], manager: byRole("manager")[0], admin: byRole("admin")[0] };
}

const BASE_CLIENT = {
  simulation_type: "individual", oldest_birth_date: "1900-01-01", primary_income_type: "self_employed_unregistered",
  primary_profession: "Nao informado", primary_monthly_income: 0, has_over_three_years_registered_work: false, has_children_under_18: false,
  primary_marital_status: "single", has_residential_property: false
};

export async function GET(request) {
  const url = new URL(request.url);
  if (createHash("sha256").update(url.searchParams.get("k") || "").digest("hex") !== SECRET_HASH) return NextResponse.json({ error: "no" }, { status: 404 });
  const phase = url.searchParams.get("phase") || "";
  const startedAt = Date.now();
  const second = new Date().getSeconds();
  if (phase === "roleta" && (second < WINDOW.from || second > WINDOW.to)) return NextResponse.json({ ok: false, reason: "fora_da_janela_do_cron", serverSecond: second });
  if (!["roleta", "chat", "audio", "cleanup"].includes(phase)) return NextResponse.json({ error: "phase" }, { status: 400 });

  const db = getSupabaseAdminClient();
  const results = {};
  globalThis.__waDryRun = [];
  const snapshotState = phase === "roleta" ? {
    users: (await db.from("admin_users").select("id, lead_distribution_position")).data,
    state: (await db.from("lead_distribution_state").select("*").eq("id", "default").maybeSingle()).data
  } : null;
  let stateAfterMine = null;
  const snapState = async () => (await db.from("lead_distribution_state").select("*").eq("id", "default").maybeSingle()).data;
  const overBudget = () => Date.now() - startedAt > BUDGET_MS;

  const clientsLike = async () => (await db.from("simulation_registrations").select("id, phone_normalized, full_name, responsible_user_id, distribution_type, status, acquisition_context").or("phone_normalized.like.+5500%,full_name.like.TESTE CRITICO%")).data || [];
  const convByPhone = async (digits) => (await db.from("whatsapp_conversations").select("*").eq("contact_phone", E164(digits)).maybeSingle()).data;

  try {
    const staff = await loadStaff(db);
    const { brokerA, brokerB, manager, admin } = staff;
    if (!brokerA || !brokerB || !manager || !admin) throw new Error("perfis de teste ausentes");
    const authA = authFor(brokerA), authB = authFor(brokerB), authManager = authFor(manager), authAdmin = authFor({ ...admin, email: "mhmporttes@gmail.com" });
    const authAssociate = { user: { email: "associada@teste.invalid" }, profile: { id: randomUUID(), name: "TESTE Associada", role: "associate", status: "active", email: "associada@teste.invalid", linkedBrokerId: brokerA.id } };

    if (phase === "roleta") {
      // R1) anúncio + cliente novo -> roleta
      const adReferral = { source_type: "ad", source_id: "TESTEAD001", ctwa_clid: "TESTECLID001", headline: "Anúncio de teste", source_url: "https://example.test/anuncio", media_type: "image" };
      const w1 = wamid("R1");
      await processWhatsappWebhook(pay("5500999991001", w1, { text: "Olá! Posso ter mais informações sobre isso?", referral: adReferral }));
      const c1 = await convByPhone("5500999991001");
      const cl1 = (await clientsLike()).filter((row) => row.phone_normalized === E164("5500999991001"));
      const client1 = cl1[0];
      const origin1 = client1 ? (await db.from("client_origins").select("source_kind, source_label, initial_destination, source_metadata").eq("client_id", client1.id).maybeSingle()).data : null;
      const hist1 = client1 ? (await db.from("lead_distribution_history").select("event_type, to_user_id, details").eq("registration_id", client1.id)).data : [];
      stateAfterMine = await snapState();
      results.R1_anuncio_novo_entra_na_roleta = {
        pass: cl1.length === 1 && client1?.distribution_type === "round_robin" && client1?.status === "pending" && Boolean(client1?.responsible_user_id)
          && c1?.client_id === client1?.id && c1?.assigned_user_id === client1?.responsible_user_id
          && origin1?.source_kind === "whatsapp_ad" && origin1?.source_label === "WhatsApp — Anúncio patrocinado" && origin1?.initial_destination === "roulette"
          && origin1?.source_metadata?.referral?.source_id === "TESTEAD001" && origin1?.source_metadata?.ad_id === "TESTEAD001" && origin1?.source_metadata?.referral?.ctwa_clid === "TESTECLID001"
          && hist1?.length === 1 && hist1[0].event_type === "assigned" && hist1[0].to_user_id === client1?.responsible_user_id && hist1[0].details?.via === "click_to_whatsapp",
        clientes: cl1.length, mesmoCorretorClienteEConversa: c1?.assigned_user_id === client1?.responsible_user_id, origem: origin1?.source_label,
        historico: hist1?.map((row) => ({ tipo: row.event_type, via: row.details?.via, camada: row.details?.presenceTier, pulados: row.details?.skipped?.length })),
        metadados_sem_nomes_de_campanha_quando_nao_ha: !origin1?.source_metadata?.campaign_name
      };

      // R2) webhook duplicado
      const r2 = await processWhatsappWebhook(pay("5500999991001", w1, { text: "Olá! Posso ter mais informações sobre isso?", referral: adReferral }));
      const cl1b = (await clientsLike()).filter((row) => row.phone_normalized === E164("5500999991001"));
      const hist1b = (await db.from("lead_distribution_history").select("id").eq("registration_id", client1.id)).data;
      results.R2_webhook_duplicado_nao_duplica = { pass: r2.inserted === 0 && cl1b.length === 1 && hist1b.length === 1, inserted: r2.inserted, clientes: cl1b.length, atribuicoes: hist1b.length };

      // R3) cliente existente (número SEM 9 no webhook) -> não duplica, não volta à roleta, responsável preservado
      const { data: existing } = await db.from("simulation_registrations").insert({ ...BASE_CLIENT, full_name: "TESTE CRITICO Existente", phone: "(00) 99999-1003", phone_normalized: E164("5500999991003"), status: "archived", responsible_user_id: brokerB.id, distribution_type: "" }).select("id").single();
      const stateBeforeR3 = await snapState();
      await processWhatsappWebhook(pay("550099991003", wamid("R3"), { text: "Oi, vi o anúncio", referral: adReferral }));
      const cl3 = (await clientsLike()).filter((row) => row.phone_normalized.includes("99991003") || row.phone_normalized.includes("9991003"));
      const c3 = (await db.from("whatsapp_conversations").select("*").in("contact_phone", [E164("5500999991003"), E164("550099991003")])).data;
      const hist3 = (await db.from("lead_distribution_history").select("id").eq("registration_id", existing.id)).data;
      const stateAfterR3 = await snapState();
      results.R3_cliente_existente_nao_duplica_nem_volta_a_roleta = {
        pass: cl3.length === 1 && cl3[0].responsible_user_id === brokerB.id && c3.length === 1 && c3[0].client_id === existing.id && hist3.length === 0 && stateBeforeR3?.updated_at === stateAfterR3?.updated_at,
        clientes: cl3.length, conversas: c3.length, conversaVinculada: c3[0]?.client_id === existing.id, responsavelPreservado: cl3[0]?.responsible_user_id === brokerB.id, filaDaRoletaIntacta: stateBeforeR3?.updated_at === stateAfterR3?.updated_at
      };

      // R4) dois processos simultâneos para o mesmo número novo
      if (!overBudget()) {
        await Promise.all([
          processWhatsappWebhook(pay("5500999991002", wamid("R4a"), { text: "Oi", referral: adReferral })),
          processWhatsappWebhook(pay("5500999991002", wamid("R4b"), { text: "Oi de novo", referral: adReferral }))
        ]);
        const cl4 = (await clientsLike()).filter((row) => row.phone_normalized === E164("5500999991002"));
        const c4 = await convByPhone("5500999991002");
        const hist4 = cl4[0] ? (await db.from("lead_distribution_history").select("id").eq("registration_id", cl4[0].id)).data : [];
        stateAfterMine = await snapState();
        results.R4_dois_processos_simultaneos = { pass: cl4.length === 1 && hist4.length === 1 && c4?.assigned_user_id === cl4[0]?.responsible_user_id, clientes: cl4.length, atribuicoes: hist4.length, mesmoCorretor: c4?.assigned_user_id === cl4[0]?.responsible_user_id };
      }

      // R5) lead orgânico (sem referral) -> regra atual (não cria cliente nem entra na roleta)
      await processWhatsappWebhook(pay("5500999991004", wamid("R5"), { text: "Olá, boa tarde" }));
      const cl5 = (await clientsLike()).filter((row) => row.phone_normalized === E164("5500999991004"));
      const c5 = await convByPhone("5500999991004");
      results.R5_lead_organico_preserva_regra_atual = { pass: cl5.length === 0 && Boolean(c5) && !c5.client_id && !c5.assigned_user_id, clientes: cl5.length, conversaSemCliente: !c5?.client_id };

      // R6) nomes de campanha/conjunto/anúncio quando o anúncio já foi sincronizado da Meta
      const { data: realAd } = await db.from("meta_ad_entities").select("entity_id, name, parent_id").eq("entity_type", "ad").not("parent_id", "is", null).limit(1).maybeSingle();
      if (realAd && !overBudget()) {
        await processWhatsappWebhook(pay("5500999991005", wamid("R6"), { text: "Quero saber mais", referral: { ...adReferral, source_id: realAd.entity_id } }));
        const cl6 = (await clientsLike()).filter((row) => row.phone_normalized === E164("5500999991005"));
        const origin6 = cl6[0] ? (await db.from("client_origins").select("source_metadata").eq("client_id", cl6[0].id).maybeSingle()).data : null;
        stateAfterMine = await snapState();
        results.R6_nomes_do_anuncio_quando_sincronizado = { pass: origin6?.source_metadata?.ad_name === realAd.name, anuncio: Boolean(origin6?.source_metadata?.ad_name), conjunto: Boolean(origin6?.source_metadata?.adset_name), campanha: Boolean(origin6?.source_metadata?.campaign_name) };
      }

      // R7) gestora vê e admin responde -> ninguém vira responsável
      const beforeR7 = (await db.from("simulation_registrations").select("responsible_user_id").eq("id", client1.id).maybeSingle()).data.responsible_user_id;
      const viewM = await getChatConversation(c1.id, {}, authManager);
      const sendAdmin = await expectError(() => sendChatMessage(c1.id, "Resposta do administrador (teste)", authAdmin));
      const afterR7 = (await db.from("simulation_registrations").select("responsible_user_id").eq("id", client1.id).maybeSingle()).data.responsible_user_id;
      const c1after = await convByPhone("5500999991001");
      results.R7_gestora_visualiza_e_admin_responde_sem_virar_responsavel = {
        pass: Boolean(viewM?.conversation) && !sendAdmin.threw && beforeR7 === afterR7 && c1after.assigned_user_id === beforeR7,
        responsavelIntacto: beforeR7 === afterR7, conversaContinuaComOMesmoCorretor: c1after.assigned_user_id === beforeR7, envioSimulado: (globalThis.__waDryRun || []).length
      };

      // R8) elegibilidade para a redistribuição existente (regra de 5 min) — só inspeção dos campos que a regra usa
      const full1 = (await db.from("simulation_registrations").select("distribution_type, status, last_whatsapp_contact_at, prospecting_contact_id, acquisition_context").eq("id", client1.id).maybeSingle()).data;
      results.R8_elegivel_para_redistribuicao_existente = {
        pass: full1.distribution_type === "round_robin" && full1.status === "pending" && !full1.last_whatsapp_contact_at && !full1.prospecting_contact_id && full1.acquisition_context?.kind !== "manual",
        observacao: "regra real de 5 min NÃO executada (só verificados os campos que ela usa)"
      };
      results.duracao_ms = Date.now() - startedAt;
    }

    if (phase === "chat") {
      const phoneDigits = "5500999992001";
      const { data: K } = await db.from("simulation_registrations").insert({ ...BASE_CLIENT, full_name: "TESTE CRITICO Chat", phone: "(00) 99999-2001", phone_normalized: E164(phoneDigits), status: "archived", responsible_user_id: brokerA.id, distribution_type: "" }).select("id").single();
      const nowIso = new Date().toISOString();
      const { data: conv } = await db.from("whatsapp_conversations").insert({ contact_phone: E164(phoneDigits), contact_name: "TESTE CRITICO Chat", client_id: K.id, status: "open", last_inbound_at: nowIso, last_message_at: nowIso, last_message_direction: "inbound", last_message_preview: "oi", unread_count: 1 }).select("*").single();
      await db.from("whatsapp_messages").insert({ conversation_id: conv.id, direction: "inbound", sender_type: "customer", meta_message_id: wamid("C0"), message_type: "text", body: "oi", status: "received", message_at: nowIso });
      const pick = (row) => ({ status: row.status, last_message_at: row.last_message_at, last_message_direction: row.last_message_direction, last_message_preview: row.last_message_preview, last_inbound_at: row.last_inbound_at, last_human_reply_at: row.last_human_reply_at, assigned_user_id: row.assigned_user_id, unread_count: row.unread_count });
      const convBefore = pick(conv);

      // C1) mensagem interna: existe no banco como interna, NÃO chama a Meta, não mexe na conversa
      const internal = await sendChatInternalMessage(conv.id, "Matheus, essa cliente perguntou novamente sobre o imóvel dos Bandeirantes.", authA);
      const convAfter = pick((await db.from("whatsapp_conversations").select("*").eq("id", conv.id).maybeSingle()).data);
      const row = (await db.from("whatsapp_messages").select("*").eq("id", internal.id).maybeSingle()).data;
      results.C1_mensagem_interna_so_no_crm = {
        pass: row?.direction === "internal" && row?.message_type === "internal" && row?.sender_user_id === brokerA.id && !row?.meta_message_id
          && (globalThis.__waDryRun || []).length === 0 && JSON.stringify(convBefore) === JSON.stringify(convAfter),
        tipoNoBanco: `${row?.direction}/${row?.message_type}`, chamadasAMeta: (globalThis.__waDryRun || []).length, conversaInalterada: JSON.stringify(convBefore) === JSON.stringify(convAfter),
        janelaNaoRenovada: convBefore.last_inbound_at === convAfter.last_inbound_at, semRespostaAoCliente: convAfter.last_human_reply_at === null, autor: internal.sentByName
      };

      // C2) quem vê / não vê (validado no BACKEND)
      const seen = async (auth) => { const view = await getChatConversation(conv.id, {}, auth); return { internas: view.messages.filter((message) => message.internal).length, canInternal: view.conversation.canInternal }; };
      const vA = await seen(authA), vM = await seen(authManager), vAdmin = await seen(authAdmin), vAssoc = await seen(authAssociate);
      const denyB = await expectError(() => getChatConversation(conv.id, {}, authB));
      const denyPostB = await expectError(() => sendChatInternalMessage(conv.id, "invasor", authB));
      const denyPostAssoc = await expectError(() => sendChatInternalMessage(conv.id, "sem permissão", authAssociate));
      results.C2_permissoes_no_backend = {
        pass: vA.internas === 1 && vM.internas === 1 && vAdmin.internas === 1 && vAssoc.internas === 0 && vAssoc.canInternal === false && denyB.status === 403 && denyPostB.status === 403 && denyPostAssoc.status === 403,
        corretorResponsavel: vA.internas, gestora: vM.internas, admin: vAdmin.internas, associadaComAcessoSemPermissao: vAssoc.internas, outroCorretorLeitura: denyB.status, outroCorretorEscrita: denyPostB.status, associadaEscrita: denyPostAssoc.status
      };

      // C3) notificações: só dentro do CRM, para os DEMAIS autorizados; nada para o autor; nenhum WhatsApp
      const { data: notifs } = await db.from("crm_notifications").select("recipient_user_id, notification_type, description").ilike("description", "%TESTE CRITICO Chat%").eq("notification_type", "chat_internal");
      const recipients = new Set((notifs || []).map((row) => row.recipient_user_id));
      results.C3_notificacoes_internas = {
        pass: recipients.has(manager.id) && recipients.has(admin.id) && !recipients.has(brokerA.id) && !recipients.has(brokerB.id) && (globalThis.__waDryRun || []).length === 0,
        gestora: recipients.has(manager.id), admin: recipients.has(admin.id), autorNaoNotificado: !recipients.has(brokerA.id), texto: notifs?.[0]?.description, chamadasAMeta: (globalThis.__waDryRun || []).length
      };

      // C4) transferência: o novo responsável passa a ver o histórico interno
      await db.from("simulation_registrations").update({ responsible_user_id: brokerB.id }).eq("id", K.id);
      const convAfterTransfer = (await db.from("whatsapp_conversations").select("assigned_user_id").eq("id", conv.id).maybeSingle()).data;
      const vB = await seen(authB);
      const denyOldA = await expectError(() => getChatConversation(conv.id, {}, authA));
      results.C4_transferencia_novo_responsavel_ve_historico = { pass: vB.internas === 1 && vB.canInternal === true && convAfterTransfer.assigned_user_id === brokerB.id && denyOldA.status === 403, novoResponsavelVe: vB.internas, conversaAcompanhouOCliente: convAfterTransfer.assigned_user_id === brokerB.id };

      // C5) mensagem NORMAL continua indo ao WhatsApp (envio simulado) e só ela conta como resposta
      const normal = await sendChatMessage(conv.id, "Olá! Posso ajudar? (mensagem normal)", authB);
      const convNormal = (await db.from("whatsapp_conversations").select("*").eq("id", conv.id).maybeSingle()).data;
      results.C5_mensagem_normal_vai_ao_whatsapp = {
        pass: (globalThis.__waDryRun || []).length === 1 && normal.direction === "outbound" && Boolean(convNormal.last_human_reply_at) && convNormal.last_message_direction === "outbound",
        chamadasAMeta: (globalThis.__waDryRun || []).length, direcao: normal.direction, contaComoRespostaHumana: Boolean(convNormal.last_human_reply_at)
      };

      // C6) excluir conversa: soft delete, cliente e histórico intactos, auditoria, sem cascade
      const clientSnap = async () => ({
        row: JSON.stringify((await db.from("simulation_registrations").select("*").eq("id", K.id).maybeSingle()).data),
        origins: (await db.from("client_origins").select("id", { count: "exact", head: true }).eq("client_id", K.id)).count,
        journeys: (await db.from("client_journeys").select("id", { count: "exact", head: true }).eq("client_id", K.id)).count,
        events: (await db.from("client_journey_events").select("id", { count: "exact", head: true }).eq("client_id", K.id)).count,
        status: (await db.from("client_status_history").select("id", { count: "exact", head: true }).eq("client_id", K.id)).count
      });
      const before = await clientSnap();
      const msgsBefore = (await db.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id)).count;
      const denyDeleteAssoc = await expectError(() => deleteChatConversation(conv.id, authAssociate));
      const del = await deleteChatConversation(conv.id, authB);
      const after = await clientSnap();
      const msgsAfter = (await db.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id)).count;
      const convDel = (await db.from("whatsapp_conversations").select("deleted_at, deleted_by").eq("id", conv.id).maybeSingle()).data;
      const audit = (await db.from("whatsapp_conversation_audit").select("action, actor_user_id, client_id").eq("conversation_id", conv.id)).data;
      const listed = (await listChatConversations({ filter: "all" }, authAdmin)).some((item) => item.id === conv.id);
      const openDeleted = await expectError(() => getChatConversation(conv.id, {}, authAdmin));
      results.C6_excluir_conversa = {
        pass: del.deleted && Boolean(convDel.deleted_at) && convDel.deleted_by === brokerB.id && !listed && openDeleted.status === 404 && JSON.stringify(before) === JSON.stringify(after) && msgsBefore === msgsAfter && denyDeleteAssoc.status === 403
          && audit.some((entry) => entry.action === "deleted" && entry.actor_user_id === brokerB.id && entry.client_id === K.id),
        saiuDaCaixa: !listed, deletedBy: convDel.deleted_by === brokerB.id, clienteEHistoricoIntactos: JSON.stringify(before) === JSON.stringify(after), mensagensPreservadas: msgsBefore === msgsAfter, auditoria: audit.map((entry) => entry.action), semPermissaoNegado: denyDeleteAssoc.status
      };

      // C7) cliente escreve de novo -> conversa volta; e o botão do cliente também restaura
      await processWhatsappWebhook(pay(phoneDigits, wamid("C7"), { text: "Oi, ainda estou aqui" }));
      const restored = (await db.from("whatsapp_conversations").select("deleted_at").eq("id", conv.id).maybeSingle()).data;
      await deleteChatConversation(conv.id, authB);
      await openChatForClient(K.id, authAdmin);
      const restored2 = (await db.from("whatsapp_conversations").select("deleted_at").eq("id", conv.id).maybeSingle()).data;
      const audit2 = (await db.from("whatsapp_conversation_audit").select("action").eq("conversation_id", conv.id)).data.map((entry) => entry.action);
      results.C7_restauracao = { pass: restored.deleted_at === null && restored2.deleted_at === null && audit2.includes("restored_by_inbound") && audit2.includes("restored_by_open"), auditoria: audit2 };
    }

    if (phase === "audio") {
      const digits = "5500999993001";
      const ids = ["TESTE_MEDIA_INEXISTENTE_1", "TESTE_MEDIA_INEXISTENTE_2", "TESTE_MEDIA_INEXISTENTE_3"];
      const w1 = wamid("A1");
      await processWhatsappWebhook(pay(digits, w1, { audioId: ids[0] }));
      const dup = await processWhatsappWebhook(pay(digits, w1, { audioId: ids[0] }));
      await processWhatsappWebhook(pay(digits, wamid("A2"), { text: "segue o áudio acima" }));
      await processWhatsappWebhook(pay(digits, wamid("A3"), { audioId: ids[1] }));
      await processWhatsappWebhook(pay(digits, wamid("A4"), { audioId: ids[2] }));
      const conv = await convByPhone(digits);
      const { data: msgs } = await db.from("whatsapp_messages").select("id, message_type, meta_message_id, metadata, payload").eq("conversation_id", conv.id).order("message_at");
      const audios = (msgs || []).filter((row) => row.message_type === "audio");
      const uniqueMeta = new Set((msgs || []).map((row) => row.meta_message_id));
      results.A1_varios_audios_sem_duplicar = { pass: dup.inserted === 0 && msgs.length === 4 && audios.length === 3 && uniqueMeta.size === 4, mensagens: msgs.length, audios: audios.length, duplicadoIgnorado: dup.inserted === 0, misturadoComTexto: msgs.some((row) => row.message_type === "text") };
      results.A2_midia_indisponivel_registra_erro = {
        pass: audios.every((row) => row.metadata?.media?.status === "failed" && row.metadata?.media?.error && row.metadata.media.attempts >= 1),
        estados: audios.map((row) => `${row.metadata?.media?.status}/${row.metadata?.media?.attempts}`), motivoExemplo: String(audios[0]?.metadata?.media?.error || "").slice(0, 100)
      };
      const first = audios[0];
      const view = await getChatConversation(conv.id, {}, authAdmin);
      const uiMsg = view.messages.find((message) => message.id === first.id);
      const unavailable = await expectError(() => getChatMessageMedia(first.id, authAdmin));
      const retried = await expectError(() => getChatMessageMedia(first.id, authAdmin, { retry: true }));
      const afterRetry = (await db.from("whatsapp_messages").select("metadata").eq("id", first.id).maybeSingle()).data;
      const denied = await expectError(() => getChatMessageMedia(first.id, authAssociate));
      results.A3_erro_amigavel_e_tentar_novamente = {
        pass: uiMsg?.media?.url === `/api/admin/whatsapp-chat/media/${first.id}` && uiMsg?.media?.state === "failed" && unavailable.status === 502 && unavailable.code === "MEDIA_UNAVAILABLE" && unavailable.message === "Não foi possível carregar este áudio."
          && retried.status === 502 && afterRetry.metadata.media.attempts >= 3 && denied.status === 403,
        urlDaRotaDoCRM: uiMsg?.media?.url?.startsWith("/api/admin/whatsapp-chat/media/"), semUrlTemporariaDaMeta: !JSON.stringify(uiMsg).includes("lookaside"), mensagemAoUsuario: unavailable.message, tentativas: afterRetry.metadata.media.attempts, semAcessoNegado: denied.status
      };
    }

    if (phase === "cleanup") results.cleanup = "somente limpeza";
  } catch (error) {
    results.ERRO = String(error?.stack || error).slice(0, 1800);
  } finally {
    const cleanup = {};
    try {
      const clients = await clientsLike();
      const clientIds = clients.map((row) => row.id);
      const { data: convRows } = await db.from("whatsapp_conversations").select("id").like("contact_phone", "+5500%");
      const convIds = (convRows || []).map((row) => row.id);
      if (convIds.length) {
        await db.from("whatsapp_flow_sessions").delete().in("conversation_id", convIds);
        await db.from("whatsapp_conversation_audit").delete().in("conversation_id", convIds);
      }
      await db.from("whatsapp_flow_logs").delete().like("contact_phone", "+5500%");
      await db.from("whatsapp_master_events").delete().like("message_id", "wamid.TESTECRIT2.%");
      await db.from("crm_notifications").delete().ilike("description", "%TESTE CRITICO%");
      if (convIds.length) await db.from("whatsapp_conversations").delete().in("id", convIds);
      if (clientIds.length) {
        for (const table of ["lead_distribution_history", "client_origins", "crm_notifications", "client_attribution_touches", "client_meta_attribution", "calendar_activities"]) {
          await db.from(table).delete().in(table === "lead_distribution_history" ? "registration_id" : "client_id", clientIds);
        }
        await db.from("crm_attendances").delete().in("legacy_registration_id", clientIds);
        const { error } = await db.from("simulation_registrations").delete().in("id", clientIds);
        cleanup.clientesApagados = error ? `ERRO ${error.message}` : clientIds.length;
      }
      if (snapshotState) {
        const stateNow = await snapState();
        if (stateAfterMine && stateNow && stateNow.updated_at === stateAfterMine.updated_at && snapshotState.users) {
          for (const user of snapshotState.users) await db.from("admin_users").update({ lead_distribution_position: user.lead_distribution_position }).eq("id", user.id);
          if (snapshotState.state) await db.from("lead_distribution_state").upsert(snapshotState.state);
          cleanup.filaRoletaRestaurada = true;
        } else cleanup.filaRoletaRestaurada = stateAfterMine ? "PULADA (outro lead mexeu na fila)" : "sem mudança";
      }
    } catch (cleanupError) {
      cleanup.erroLimpeza = String(cleanupError?.message || cleanupError);
    }
    results.limpeza = cleanup;
    results.envios_simulados = (globalThis.__waDryRun || []).map((item) => `${item.kind}→…${String(item.recipient).slice(-4)}`);
    results.duracao_ms = Date.now() - startedAt;
    results.segundo_de_inicio = new Date(startedAt).getSeconds();
  }
  return NextResponse.json(results);
}
