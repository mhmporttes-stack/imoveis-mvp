import { redirect } from "next/navigation";
import AdminTwoFactorSettings from "@/components/AdminTwoFactorSettings";
import { isOwnerAdminEmail, requireAdminPage } from "@/lib/admin-auth";
import { getTwoFactorStatus } from "@/lib/admin-two-factor";

export const dynamic = "force-dynamic";

// Segurança da conta do dono: verificação em duas etapas (regra do dono, 2026-10-08). Só a conta REAL do dono vê.
export default async function AdminSecurityPage() {
  const auth = await requireAdminPage();
  const realUser = auth.realUser || auth.user;
  if (!isOwnerAdminEmail(realUser?.email)) redirect("/admin");

  let status = null;
  let error = "";
  try {
    status = await getTwoFactorStatus(realUser.id);
  } catch (loadError) {
    console.error("Falha ao carregar a verificacao em duas etapas.", loadError?.message || loadError);
    error = "Não foi possível carregar a verificação em duas etapas agora. Tente novamente em instantes.";
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page">
        <div className="mx-auto w-full max-w-[640px]">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Minha conta</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-navy">Segurança da conta</h1>
          <p className="mt-3 leading-7 text-muted">Conta: {realUser.email}</p>
          {auth.accountSwitchMode ? (
            <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              Você está em “Alterar conta”. Esta configuração vale para a SUA conta, não para a conta selecionada.
            </p>
          ) : null}
          <div className="mt-6">
            {error ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>
            ) : (
              <AdminTwoFactorSettings initialStatus={status} />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
