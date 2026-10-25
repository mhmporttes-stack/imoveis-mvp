import * as operations from "../repositories/operations.js";
import * as instancesRepo from "../repositories/instances.js";
import { localDate } from "../utils/time.js";
import { sanitizeText } from "../utils/logger.js";

// Métricas operacionais (JSON). "accepted" = aceito pelo provedor; "delivered"/"read" = só confirmação real (webhook).
export async function collectStats(ctx) {
  const [byStatus, events24h, providerErrors, processing, rejections, suppression, onboardingFailed, instances] = await Promise.all([
    operations.messageStatusCounts(ctx.db),
    operations.eventCounts(ctx.db, 24),
    operations.providerErrorCounts(ctx.db, 24),
    operations.processingStats(ctx.db, 24),
    operations.leadRejectionCounts(ctx.db, 24),
    operations.suppressionCount(ctx.db),
    operations.onboardingFailures(ctx.db),
    instancesRepo.listInstances(ctx.db)
  ]);
  let queue = null;
  if (ctx.queue) {
    try { queue = await ctx.queue.counts(); } catch (error) { queue = { error: sanitizeText(error?.message, 120) }; }
  }
  const instanceStats = await Promise.all(instances.map(async (i) => ({
    id: i.id, name: i.name, provider: i.provider, enabled: i.enabled, connection_state: i.connection_state,
    operational_state: i.operational_state, profile_state: i.profile_state, suspension_reason: i.suspension_reason,
    last_error: i.last_error, last_success_send_at: i.last_success_send_at, daily_limit: i.daily_limit,
    usage_today: await instancesRepo.getDailyUsage(ctx.db, i.id, localDate(i.timezone, ctx.now())),
    totals: { accepted: Number(i.total_accepted), delivered: Number(i.total_delivered), read: Number(i.total_read), failed: Number(i.total_failed) }
  })));
  return {
    generated_at: new Date().toISOString(),
    messages_by_status: byStatus,
    pending: (byStatus.requested || 0) + (byStatus.scheduled || 0) + (byStatus.queued || 0),
    last_24h: {
      processed: processing.processed,
      avg_processing_ms: processing.avg_ms,
      max_processing_ms: processing.max_ms,
      accepted: events24h.send_accepted || 0,
      delivered_confirmed: events24h.provider_delivered || 0,
      read_confirmed: events24h.provider_read || 0,
      retries_scheduled: events24h.send_failed_temporary || 0,
      permanent_failures: events24h.send_failed_permanent || 0,
      unknown_results: events24h.send_unknown || 0,
      provider_errors: providerErrors,
      leads_rejected_by_authorization: rejections
    },
    suppression,
    onboarding_failures_7d: onboardingFailed,
    queue,
    instances: instanceStats
  };
}
