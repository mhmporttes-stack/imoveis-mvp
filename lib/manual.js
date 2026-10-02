import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { isGeneralAdminProfile, isOwnerAdminEmail } from "@/lib/admin-profiles";
import { createAlertsForAudience } from "@/lib/crm-alerts";
import { createManualService } from "@/lib/manual-service.mjs";

// Acesso a dados do Manual (service role, SOMENTE servidor). O papel usado é
// SEMPRE o efetivo (auth.profile). Aprovar/publicar: só o dono.
const service = createManualService({
  get db() { return getSupabaseAdminClient(); },
  createAlerts: (definition, buildRow) => createAlertsForAudience(definition, buildRow),
  isOwner: (auth) => isOwnerAdminEmail(auth?.user?.email),
  viewerOf: (auth) => {
    const profile = auth?.profile;
    if (!profile?.id) return null;
    return { id: profile.id, role: isGeneralAdminProfile(profile) ? "admin" : profile.role };
  }
});

export const {
  getVisibleManual, searchManual, listVisibleNews, markNewsRead, adminOverview, createTopic, updateTopic, createSection,
  updateSection, approveVersion, listVersions, createNews, updateNews, listNewsReads, reorder, setStatus, seedStructure
} = service;
