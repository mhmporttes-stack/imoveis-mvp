import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import Footer from "@/components/Footer";
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
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Pontuação</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Configure as regras utilizadas no ranking da equipe.
          </p>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="scoring" />
      <ScoringRulesManager
        canEdit={isAdmin}
        initialAdjustments={adjustments}
        initialBrokers={brokers}
        initialError={error}
        initialHistory={history}
        initialRules={rules}
      />
      <Footer />
    </main>
  );
}
