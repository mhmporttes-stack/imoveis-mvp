import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { listAdminProfiles } from "@/lib/admin-profiles";
import { calculateCrmMetrics } from "@/lib/crm";
import { listSimulationRegistrations } from "@/lib/simulation-registrations";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const auth = await requireGeneralAdminPage("/admin/simulacoes");
  const [profiles, registrations] = await Promise.all([
    listAdminProfiles(),
    listSimulationRegistrations({ auth })
  ]);

  const rows = profiles.map((profile) => ({
    profile,
    metrics: calculateCrmMetrics(registrations.filter((item) => item.responsibleUserId === profile.id))
  }));

  return (
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Desempenho</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">Indicadores operacionais por corretor.</p>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="performance" />
      <section className="container-page overflow-hidden rounded-[28px] border border-line bg-white shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-navy text-sm text-white">
              <tr>
                <Th>Corretor</Th><Th>Clientes hoje</Th><Th>Aguardando ação</Th><Th>Atividades hoje</Th><Th>Atrasadas</Th><Th>Concluídas</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ profile, metrics }) => (
                <tr key={profile.id} className="border-t border-line text-sm font-bold text-navy">
                  <Td>{profile.name}</Td><Td>{metrics.clientsToday}</Td><Td>{metrics.awaitingAction}</Td><Td>{metrics.activitiesToday}</Td><Td>{metrics.overdueActivities}</Td><Td>{metrics.completedActivities}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Th({ children }) { return <th className="px-5 py-4 font-black">{children}</th>; }
function Td({ children }) { return <td className="px-5 py-4">{children}</td>; }
