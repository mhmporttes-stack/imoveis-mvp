import { redirect } from "next/navigation";
import AdminLoginForm from "@/components/AdminLoginForm";
import { getAdminFromCookies } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }) {
  const { error } = await searchParams;
  const session = await getAdminFromCookies();

  if (session.ok) {
    redirect("/admin");
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page grid min-h-[62vh] items-center">
        <div className="mx-auto w-full max-w-[520px] rounded-[28px] border border-line bg-white p-8 shadow-soft md:p-10">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-4xl font-black leading-tight text-navy">Entrar no painel</h1>
          <p className="mt-4 leading-7 text-muted">
            Acesse com o e-mail e senha do administrador para gerenciar os empreendimentos.
          </p>
          <div className="mt-8">
            <AdminLoginForm initialError={error || ""} />
          </div>
        </div>
      </section>
    </main>
  );
}
