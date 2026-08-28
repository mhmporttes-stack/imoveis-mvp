import AdminMenu from "@/components/AdminMenu";
import { getAdminFromCookies } from "@/lib/admin-auth";
import {
  buildBrokerCaptacaoLink,
  buildBrokerSimulationLink,
  isGeneralAdminProfile,
  isBrokerProfile
} from "@/lib/admin-profiles";

export default async function AdminSectionNav({ active = "properties" }) {
  const admin = await getAdminFromCookies();
  const profile = admin.ok ? admin.profile : null;
  const isAdmin = isGeneralAdminProfile(profile);
  const isBroker = isBrokerProfile(profile);

  return (
    <div className="container-page mb-8 space-y-3">
      <AdminMenu active={active} isAdmin={isAdmin} isBroker={isBroker} />

      {isBroker && !isAdmin ? (
        <div className="flex flex-wrap gap-2 text-xs font-bold text-slate">
          <a className="rounded-full border border-brand/20 bg-white px-4 py-2 text-brand" href={buildBrokerSimulationLink(profile)} target="_blank" rel="noreferrer">
            Meu link de simulação
          </a>
          <a className="rounded-full border border-brand/20 bg-white px-4 py-2 text-brand" href={buildBrokerCaptacaoLink(profile)} target="_blank" rel="noreferrer">
            Meu link de captação
          </a>
        </div>
      ) : null}
    </div>
  );
}
