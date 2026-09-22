export function dailyGoalPercent(done, target) {
  if (target <= 0) return 0;
  if (done >= target) return 100 + Math.floor(done - target);
  return Math.min(99, Math.round((Math.max(0, done) / target) * 100));
}
