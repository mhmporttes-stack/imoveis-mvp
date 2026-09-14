import AdminViewAsBanner from "@/components/AdminViewAsBanner";
import NewClientSoundListener from "@/components/NewClientSoundListener";
import TopRankingBadge from "@/components/TopRankingBadge";
import { getAdminFromCookies } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }) {
  const auth = await getAdminFromCookies();

  return (
    <>
      {auth.ok ? <NewClientSoundListener userId={auth.profile?.id} /> : null}
      {auth.ok ? (
        // Uma única faixa fixa no topo (sticky, não flutuante — participa do
        // fluxo normal do layout, por isso nunca cobre o conteúdo abaixo).
        // O aviso de "ver como" (quando ativo) e a barra com o Top 1 do
        // ranking diário vivem dentro dela, empilhados sem sobreposição.
        <div className="sticky top-0 z-[150]">
          {auth.accountSwitchMode ? (
            <AdminViewAsBanner name={auth.profile.name} category={roleLabel(auth.profile.role)} />
          ) : null}
          {/* pt-[env(safe-area-inset-top)]: no iPhone com notch/Dynamic
              Island (PWA em modo standalone, viewport-fit=cover já
              configurado), o topo da tela fica por baixo da barra de
              status do sistema — sem esse respiro o conteúdo do cabeçalho
              nasceria atrás dela. O fundo da barra continua se estendendo
              até o topo real (comportamento padrão esperado em PWAs). */}
          <header className="flex min-h-12 items-center justify-end border-b border-line bg-white/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:min-h-14 sm:px-6">
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
