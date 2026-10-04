import AcademiaApp from "@/components/academia/AcademiaApp";
import { isGeneralAdmin, requireAdminPage } from "@/lib/admin-auth";
import { resolveAcademyActor } from "@/lib/academy-access-core.mjs";
import { getAcademyService } from "@/lib/academy-server";

export const metadata = {
  title: "Academia · Matheus Machado",
  robots: { index: false, follow: false }
};

const BACK_HREF = "/admin/simulacoes";

// Server Component: carrega do banco o estado do PRÓPRIO aluno (perfil efetivo da sessão) e entrega ao app, que
// é um client component. O gabarito nunca vai junto (lib/academy-service.mjs). Em "Alterar conta" a tela mostra o
// progresso do perfil escolhido em modo somente leitura (ACA-10).
export default async function AcademiaPage() {
  const auth = await requireAdminPage();
  let data = null;
  try {
    const service = getAcademyService();
    if (service) data = await service.loadStudent(resolveAcademyActor(auth));
  } catch (error) {
    console.error("academia: falha ao carregar o estado do aluno", error?.cause?.message || error?.message || error);
  }
  if (!data || data.status !== "ok") {
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
        <p>
          A Academia não está disponível agora.{" "}
          <a href={BACK_HREF}>Voltar ao CRM</a>
        </p>
      </main>
    );
  }
  // Admin e Gerente (efetivos) veem o atalho da gestão; a página e as rotas conferem de novo no servidor.
  const canManage = isGeneralAdmin(auth) || auth?.profile?.role === "manager";
  return <AcademiaApp initial={data} backHref={BACK_HREF} manageHref={canManage ? "/academia/editor" : null} />;
}
