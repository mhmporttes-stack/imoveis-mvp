import Link from "next/link";
import AdminPropertyList from "@/components/AdminPropertyList";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import { requireAdminPage } from "@/lib/admin-auth";
import { canManageProperties, listProperties } from "@/lib/properties";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminPage();

  if (!canManageProperties()) {
    return <AdminDisabled />;
  }

  let properties = [];

  try {
    properties = await listProperties();
  } catch (error) {
    return <AdminDataError error={error} />;
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área administrativa</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Painel de empreendimentos</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Gerencie o portfólio, edite informações comerciais e publique páginas individuais.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/admin/novo" className="premium-button-primary">Novo empreendimento</Link>
          <AdminLogoutButton />
        </div>
      </section>
      <AdminPropertyList properties={properties} />
    </main>
  );
}

function AdminDisabled() {
  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Area administrativa</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Painel temporariamente desativado</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          Configure o Supabase para gerenciar empreendimentos em producao ou use SQLite no ambiente local.
        </p>
        <Link href="/" className="mt-8 inline-flex premium-button-primary">Voltar para o site</Link>
      </section>
    </main>
  );
}

function AdminDataError({ error }) {
  const message = error?.message || "Erro desconhecido ao conectar com o Supabase.";
  const hint = getAdminErrorHint(message);

  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-red-200 bg-white p-10 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-red-600">Area administrativa</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Nao foi possivel carregar o painel</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
          O login funcionou, mas o Supabase retornou um erro ao carregar os empreendimentos.
        </p>

        <div className="mt-8 grid gap-4 rounded-2xl border border-red-100 bg-red-50 p-5 text-red-800">
          <p className="text-sm font-black uppercase tracking-[0.16em]">Erro retornado</p>
          <p className="break-words font-bold">{message}</p>
        </div>

        {hint ? (
          <div className="mt-5 rounded-2xl border border-blue-100 bg-[#F4F9FF] p-5 text-navy">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Como resolver</p>
            <p className="mt-2 font-bold leading-7">{hint}</p>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/admin" className="premium-button-primary">Tentar novamente</Link>
          <Link href="/" className="premium-button-secondary">Voltar para o site</Link>
        </div>
      </section>
    </main>
  );
}

function getAdminErrorHint(message) {
  const normalized = message.toLowerCase();

  if (normalized.includes("relation") && normalized.includes("properties")) {
    return "A tabela public.properties ainda nao existe no Supabase. Abra o SQL Editor do Supabase e execute o arquivo supabase/schema.sql do projeto.";
  }

  if (normalized.includes("schema cache") && normalized.includes("properties")) {
    return "A tabela public.properties ou alguma coluna esperada nao foi encontrada. Execute novamente o schema.sql no Supabase.";
  }

  if (normalized.includes("invalid api key") || normalized.includes("jwt")) {
    return "Confira se SUPABASE_SERVICE_ROLE_KEY esta correta e marcada para Producao na Vercel. Depois faca um novo redeploy.";
  }

  if (normalized.includes("permission denied")) {
    return "A chave configurada nao tem permissao de escrita. Use a service role key ou a chave secret do Supabase somente no servidor.";
  }

  return "Veja os logs do deployment na Vercel para confirmar o detalhe do erro e confira se as variaveis do Supabase estao em Producao.";
}
