import { redirect } from "next/navigation";
import ExtensionsAdmin from "@/components/extensoes/ExtensionsAdmin";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { getExtensionsOverview } from "@/lib/browser-extensions";

export const dynamic = "force-dynamic";

// Extensões do Chrome do dono (EXT-1, dono, 2026-10-29): só o administrador geral REAL — em "Alterar conta" volta para
// o painel (as rotas usam requireRealGeneralAdminApi).
export default async function AdminExtensionsPage() {
  const auth = await requireGeneralAdminPage();
  if (auth.accountSwitchMode) redirect("/admin");
  const overview = await getExtensionsOverview();
  return (
    <main className="bg-mist py-14">
      <ExtensionsAdmin initialOverview={overview} />
    </main>
  );
}
