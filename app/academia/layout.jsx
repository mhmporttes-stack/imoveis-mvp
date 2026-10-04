import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { isAcademyEnabled } from "@/lib/academy-flags";

export const dynamic = "force-dynamic";

// Sobrescreve o viewport do layout raiz (zoom travado): na Academia o zoom é
// liberado (pedido do dono). Os demais campos do raiz continuam herdados.
export const viewport = {
  maximumScale: 5,
  userScalable: true
};

export default async function AcademiaLayout({ children }) {
  // Chave desligada: a rota simplesmente não existe (404), antes de qualquer
  // checagem de sessão.
  if (!isAcademyEnabled()) notFound();
  // Mesmo login do CRM (cookies path "/"). requireAdminPage não aceita
  // fallback; sem sessão válida redireciona a /admin/login.
  await requireAdminPage();

  return (
    <div className="min-h-screen bg-white pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-navy">Academia</h1>
        <a href="/admin/simulacoes" className="text-sm text-slate underline-offset-2 hover:underline">
          Voltar ao CRM
        </a>
      </header>
      <main>{children}</main>
    </div>
  );
}
