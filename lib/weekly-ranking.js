import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getPerformanceOverview } from "./performance-overview";
import { previousRankingWeek } from "./weekly-ranking-period.mjs";

const fullVisibilityAuth = { ok: true, user: { email: "" }, profile: { id: "", role: "admin" } };
const pending = new Map();

export async function getWeeklyRankingWinner() {
  const week = previousRankingWeek();
  // v2 descarta o resultado congelado antes da exclusão de gerentes.
  const id = `ranking_week_v2_${week.startDate}`;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("crm_settings").select("setting_value").eq("id", id).maybeSingle();
  if (error) throw error;
  if (data) return data.setting_value?.winner || null;

  // Rede de segurança se o cron falhar: o primeiro acesso consolida uma vez.
  if (!pending.has(id)) {
    const task = (async () => {
      const overview = await getPerformanceOverview({ period: "custom", startDate: week.startDate, endDate: week.endDate }, fullVisibilityAuth);
      const top = overview.ranking[0];
      const winner = top ? { brokerId: top.profile.id, name: top.profile.name, gender: top.profile.gender || "", photoUrl: top.profile.photoUrl || "", points: top.points } : null;
      // A chave semanal e ignoreDuplicates congelam o primeiro resultado mesmo
      // com execuções simultâneas em instâncias distintas.
      const { error: saveError } = await supabase.from("crm_settings").upsert({
        id, setting_value: { winner, startDate: week.startDate, endDate: week.endDate }
      }, { onConflict: "id", ignoreDuplicates: true });
      if (saveError) throw saveError;
      const { data: saved, error: readError } = await supabase.from("crm_settings").select("setting_value").eq("id", id).single();
      if (readError) throw readError;
      return saved.setting_value?.winner || null;
    })().finally(() => pending.delete(id));
    pending.set(id, task);
  }
  return pending.get(id);
}
