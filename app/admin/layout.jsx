import AdminViewAsBanner from "@/components/AdminViewAsBanner";
import { getAdminFromCookies } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }) {
  const auth = await getAdminFromCookies();

  return (
    <>
      {auth.ok && auth.accountSwitchMode ? (
        <AdminViewAsBanner name={auth.profile.name} category={roleLabel(auth.profile.role)} />
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
