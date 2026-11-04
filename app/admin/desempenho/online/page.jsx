import { redirect } from "next/navigation";
import { requireBrokerManagementPage } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Online (dono, 2026-11-04): "remova aquela aba online, migrando ela e juntando-a com a aba início". A presença da equipe agora é a
// seção "Online" do Início (components/inicio/InicioOnline.jsx, logo abaixo do Lote de SMS). Esta rota fica só para os links antigos
// (avisos, Henry, atalhos salvos): confere o perfil (admin geral/gestor) e leva ao Início.
export default async function AdminOnlinePresencePage() {
  await requireBrokerManagementPage();
  redirect("/admin/inicio#online");
}
