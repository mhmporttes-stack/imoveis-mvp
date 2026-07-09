import PropertyForm from "@/components/PropertyForm";
import { canUseLocalDatabase } from "@/lib/runtime";

export default function NewPropertyPage() {
  if (!canUseLocalDatabase) {
    return (
      <main className="bg-mist py-14">
        <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo cadastro</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Cadastro desativado em producao</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            O painel local com SQLite fica disponivel apenas em desenvolvimento nesta versao.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo cadastro</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Cadastrar empreendimento</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Preencha manualmente ou use IA para gerar um rascunho a partir de site, PDF ou e-book.</p>
      </section>
      <PropertyForm />
    </main>
  );
}
