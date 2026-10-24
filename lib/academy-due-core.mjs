// Prazo da Formação obrigatória enquanto a Academia não está pronta (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24, ACA-11:
// "A academia ainda não está pronta."). Matrícula criada pela regra automática `new_user` (source `auto_new_broker`):
//   - trilha sem nenhuma versão COMPLETA publicada (só versões com settings.partial = true) → sem prazo valendo: nunca
//     "atrasado" e o prazo não é exibido;
//   - depois da 1ª publicação completa → o prazo conta a partir dessa publicação (mesmo número de dias da matrícula,
//     due_at − created_at), nunca antes do prazo gravado: prazo efetivo = máx(due_at, publicação completa + dias).
// Calculado na leitura: nada é regravado no banco. Matrícula manual/recomendação/reciclagem não muda.
export const NEW_USER_ENROLLMENT_SOURCE = "auto_new_broker";

export function isPartialVersion(version) {
  const partial = version?.settings?.partial;
  return partial === true || partial === "true";
}

// trackId → instante (ms) da 1ª publicação de uma versão completa (publicada ou já aposentada), se houver.
export function completePublicationByTrack(versions = []) {
  const out = new Map();
  for (const v of versions || []) {
    if (!v?.track_id || !v.published_at || isPartialVersion(v)) continue;
    const at = Date.parse(v.published_at);
    if (!Number.isFinite(at)) continue;
    if (!out.has(v.track_id) || at < out.get(v.track_id)) out.set(v.track_id, at);
  }
  return out;
}

// Prazo que vale hoje para a matrícula (ISO ou null) + se está suspenso por formação parcial.
export function effectiveEnrollmentDue(enrollment, completeAtByTrack = new Map()) {
  const dueAt = enrollment?.due_at || null;
  if (!dueAt || enrollment.source !== NEW_USER_ENROLLMENT_SOURCE) return { dueAt, suspended: false };
  const completeAt = completeAtByTrack.get(enrollment.track_id);
  if (completeAt === undefined) return { dueAt: null, suspended: true };
  const dueMs = Date.parse(dueAt);
  const createdMs = Date.parse(enrollment.created_at);
  const spanMs = Number.isFinite(createdMs) && dueMs > createdMs ? dueMs - createdMs : 0;
  return { dueAt: new Date(Math.max(dueMs, completeAt + spanMs)).toISOString(), suspended: false };
}
