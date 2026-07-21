import AdminResetPasswordForm from "@/components/AdminResetPasswordForm";

export const dynamic = "force-dynamic";

export default function AdminResetPasswordPage() {
  return (
    <main className="bg-mist py-14">
      <section className="container-page grid min-h-[62vh] items-center">
        <div className="mx-auto w-full max-w-[520px] rounded-[28px] border border-line bg-white p-8 shadow-soft md:p-10">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-4xl font-black leading-tight text-navy">Redefinir senha</h1>
          <p className="mt-4 leading-7 text-muted">
            Digite uma nova senha para continuar acessando o painel administrativo.
          </p>
          <div className="mt-8">
            <AdminResetPasswordForm />
          </div>
        </div>
      </section>
    </main>
  );
}
