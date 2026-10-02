import AdminSectionNav from "@/components/AdminSectionNav";
import ManualAdmin from "@/components/manual/ManualAdmin";
import { isOwnerAdminEmail, requireGeneralAdminPage } from "@/lib/admin-auth";
import { adminOverview } from "@/lib/manual";

export const dynamic = "force-dynamic";

export const metadata = { title: "Gerenciar o Manual" };

// Administração do Manual: só admin geral efetivo. Aprovar/publicar: só o dono.
export default async function ManualManagePage() {
  const auth = await requireGeneralAdminPage("/admin/manual");
  const isOwner = isOwnerAdminEmail(auth.user?.email);
  const ownerViewingAsOther = Boolean(auth.accountSwitchMode) && !isOwner && isOwnerAdminEmail(auth.realUser?.email);
  let initial = null;
  try {
    initial = await adminOverview(auth);
  } catch (error) {
    console.error("Manual do CRM: falha ao carregar a administração", error?.message || error);
  }
  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="manual" />
      {initial ? (
        <ManualAdmin initial={initial} isOwner={isOwner} ownerViewingAsOther={ownerViewingAsOther} />
      ) : (
        <p className="container-page rounded-control bg-danger-soft px-4 py-3 text-sm font-medium text-danger">Não foi possível carregar a administração do Manual. Verifique se a migration do Manual foi aplicada no banco.</p>
      )}
    </main>
  );
}
