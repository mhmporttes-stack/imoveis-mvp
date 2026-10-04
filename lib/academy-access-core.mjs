// Quem é o aluno e se pode gravar (puro, testável). A Academia sempre usa o perfil EFETIVO da sessão
// (auth.profile.id = admin_users.id); nunca um userId vindo de corpo/URL.
// Regra do dono (2026-10-04, ACA-10): em "Alterar conta" a Academia é SOMENTE LEITURA — mostra o progresso do
// perfil emulado, mas nenhuma tentativa, conclusão ou matrícula é gravada.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveAcademyActor(auth) {
  const profile = auth?.profile || {};
  const name = profile.name || "";
  if (!UUID_RE.test(String(profile.id || ""))) {
    // perfil de contingência (sem linha em admin_users): não há onde gravar progresso
    return { userId: null, name, readOnly: true, reason: "no_profile" };
  }
  if (auth?.accountSwitchMode) return { userId: profile.id, name, readOnly: true, reason: "account_switch" };
  return { userId: profile.id, name, readOnly: false, reason: null };
}

export class AcademyError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export function assertCanWriteOwnProgress(actor) {
  if (!actor?.userId) throw new AcademyError("no_profile", 403);
  if (actor.readOnly) throw new AcademyError(actor.reason === "account_switch" ? "read_only_account_switch" : "read_only", 403);
  return actor;
}

// Gestão de conteúdo e liberações (F3): quem age é o perfil efetivo (Admin ou Gerente, já filtrado pelo guard da rota).
// Em "Alterar conta" a gestão é SOMENTE LEITURA (ACA-10 estendida ao conteúdo): ninguém edita/publica/libera "como" outro perfil.
// `userId` pode ser null (perfil de contingência do dono, sem linha em admin_users): o e-mail fica no registro.
export function resolveManagementActor(auth) {
  const profile = auth?.profile || {};
  return {
    userId: UUID_RE.test(String(profile.id || "")) ? profile.id : null,
    email: String(auth?.realUser?.email || auth?.user?.email || profile.email || "").trim().toLowerCase(),
    readOnly: Boolean(auth?.accountSwitchMode)
  };
}

export function assertCanManage(actor) {
  if (actor.readOnly) throw new AcademyError("read_only_account_switch", 403);
  return actor;
}
