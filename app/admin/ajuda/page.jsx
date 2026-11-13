import { redirect } from "next/navigation";
import SupportQueue from "@/components/support/SupportQueue";
import { isOwnerAdminEmail, requireAdminPage } from "@/lib/admin-auth";
import { listSupportQueue } from "@/lib/support-tickets";
import { canSeeSupportQueue } from "@/lib/support-tickets-core.mjs";

export const dynamic = "force-dynamic";

// Fila de chamados da Ajuda (dono, 2026-11-13): SÓ o dono, conta real, fora de "Alterar conta". Gestor e demais perfis
// são levados de volta ao painel (a API também recusa com 403).
export default async function AdminSupportPage() {
  const auth = await requireAdminPage();
  if (!canSeeSupportQueue({ accountSwitchMode: Boolean(auth.accountSwitchMode), isOwner: isOwnerAdminEmail(auth.user?.email) })) redirect("/admin");

  let tickets = [];
  let error = "";
  try {
    tickets = await listSupportQueue(auth);
  } catch (loadError) {
    error = loadError?.message || "Não consegui carregar os chamados agora.";
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page">
        <h1 className="text-2xl font-semibold text-navy">Chamados de ajuda</h1>
        <p className="mt-1 text-sm text-ink-2">O que os corretores relataram pelo botão "?". Só você vê esta fila.</p>
        <SupportQueue initialTickets={tickets} initialError={error} />
      </section>
    </main>
  );
}
