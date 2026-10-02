import AdminSectionNav from "@/components/AdminSectionNav";
import ScoringRulesManager from "@/components/ScoringRulesManager";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, listAdminProfiles } from "@/lib/admin-profiles";
import {
  canLoadScoringRules,
  formatScoringRulesError,
  listCurrentScoringRules,
  listManualAdjustments,
  listScoringRuleHistory
} from "@/lib/scoring-rules";

export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  const auth = await requireBrokerManagementPage();
  const isAdmin = isGeneralAdminAuth(auth);

  let rules = [];
  let history = [];
  let adjustments = [];
  let brokers = [];
  let error = "";

  if (canLoadScoringRules()) {
    try {
      const brokerIds = isAdmin ? null : (auth.profile.managedUserIds || [auth.profile.id]);
      [rules, history, adjustments] = await Promise.all([
        listCurrentScoringRules(auth),
        listScoringRuleHistory(auth),
        listManualAdjustments(auth, { brokerIds, limit: 100 })
      ]);
    } catch (loadError) {
      error = formatScoringRulesError(loadError);
    }

    if (isAdmin) {
      try {
        brokers = (await listAdminProfiles()).filter((profile) => profile.id && profile.status !== "inactive");
      } catch {
        brokers = [];
      }
    }
  } else {
    error = "Configure o Supabase para carregar a pontuação.";
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="scoring" />
      <ScoringRulesManager
        canEdit={isAdmin}
        initialAdjustments={adjustments}
        initialBrokers={brokers}
        initialError={error}
        initialHistory={history}
        initialRules={rules}
      />
    </main>
  );
}
