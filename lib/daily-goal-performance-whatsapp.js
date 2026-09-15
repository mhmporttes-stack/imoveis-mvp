import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getOwnerTeamDailyOverview } from "./daily-goal";
import { listAdminProfiles } from "./admin-profiles";
import { sendWhatsappTemplateMessage } from "./whatsapp-master";

// Trava simples contra reenvio no mesmo dia (mesmo padrão de
// lib/daily-report-notifications.js) — chave própria pra não colidir com a
// do relatório diário do dono.
const DISPATCH_SETTING_ID = "daily_goal_performance_whatsapp_dispatch";
const LANGUAGE_CODE = "pt_BR";

// Nomes dos 3 modelos aprovados pela Meta (ver
// app/api/admin/whatsapp-master/provision-daily-performance-templates) — um
// por faixa de desempenho, já que o texto ao redor dos parâmetros muda de
// tom e a Meta revisa o texto fixo do modelo, não permite variar por
// parâmetro livre.
const TIERS = [
  { min: 200, templateName: "corretor_resumo_diario_espetacular" },
  { min: 100, templateName: "corretor_resumo_diario_meta_batida" },
  { min: -Infinity, templateName: "corretor_resumo_diario_abaixo_meta" }
];

// Aviso diário de desempenho, 1 por corretor via WhatsApp: reaproveita
// EXATAMENTE os mesmos números que já aparecem na Meta Diária/Desempenho de
// cada um (getOwnerTeamDailyOverview, já com o percentual sem teto e o funil
// real do dia) — nenhum cálculo novo. Ranking/pontos ficam de fora de
// propósito (não pedido).
export async function sendDailyGoalPerformanceWhatsappToAllBrokers() {
  const ownerAuth = { ok: true, user: { email: "mhmporttes@gmail.com" }, profile: { id: "", role: "admin" } };
  const [overview, profiles] = await Promise.all([
    getOwnerTeamDailyOverview({ period: "today" }, ownerAuth),
    listAdminProfiles()
  ]);
  const phoneById = new Map(profiles.map((profile) => [profile.id, profile.phone || ""]));

  const results = [];
  for (const broker of overview.brokers) {
    const phone = phoneById.get(broker.brokerId) || "";
    if (!phone) {
      results.push({ brokerId: broker.brokerId, sent: false, skipped: true, reason: "Corretor sem WhatsApp cadastrado." });
      continue;
    }

    try {
      const { templateName, bodyParameters } = buildTemplatePayload(broker);
      const outcome = await sendWhatsappTemplateMessage({
        to: phone,
        templateName,
        languageCode: LANGUAGE_CODE,
        bodyParameters
      });
      results.push({ brokerId: broker.brokerId, sent: true, messageId: outcome.messageId });
    } catch (error) {
      results.push({ brokerId: broker.brokerId, sent: false, error: error?.message || "Falha ao enviar." });
    }
  }
  return results;
}

function buildTemplatePayload(broker) {
  const { done, total, percent } = broker.meta;
  const { contatos, atendimentos, simulacoes } = broker.funnel;
  const tier = pickTier(percent);

  return {
    templateName: tier.templateName,
    bodyParameters: [
      broker.name || "Corretor",
      `${done}/${total} (${percent}%)`,
      String(contatos),
      String(atendimentos),
      String(simulacoes)
    ]
  };
}

function pickTier(percent) {
  return TIERS.find((tier) => percent >= tier.min) || TIERS[TIERS.length - 1];
}

export async function wasDailyGoalPerformanceWhatsappSentOn(plainDate) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("crm_settings").select("setting_value").eq("id", DISPATCH_SETTING_ID).maybeSingle();
  if (error) throw error;
  return data?.setting_value?.lastSentDate === plainDate;
}

export async function markDailyGoalPerformanceWhatsappSentOn(plainDate) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("crm_settings").upsert({
    id: DISPATCH_SETTING_ID,
    setting_value: { lastSentDate: plainDate },
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}
