import AdminViewAsBanner from "@/components/AdminViewAsBanner";
import TopRankingBadge from "@/components/TopRankingBadge";
import { getAdminFromCookies } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }) {
  const auth = await getAdminFromCookies();

  return (
    <>
      {auth.ok ? (
        // Uma única faixa fixa no topo (sticky, não flutuante — participa do
        // fluxo normal do layout, por isso nunca cobre o conteúdo abaixo).
        // O aviso de "ver como" (quando ativo) e a barra com o Top 1 do
        // ranking diário vivem dentro dela, empilhados sem sobreposição.
        <div className="sticky top-0 z-[150]">
          {auth.accountSwitchMode ? (
            <AdminViewAsBanner name={auth.profile.name} category={roleLabel(auth.profile.role)} />
          ) : null}
          <header className="flex h-12 items-center justify-end border-b border-line bg-white/95 px-3 backdrop-blur sm:h-14 sm:px-6">
            <TopRankingBadge />
          </header>
        </div>
      ) : null}
      {children}
    </>
  );
}

function roleLabel(role) {
  if (role === "admin") return "Administrador geral";
  if (role === "manager") return "Gestor";
  if (role === "associate") return "Associado";
  return "Corretor";
}
