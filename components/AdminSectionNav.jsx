import Link from "next/link";
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
  const brokerLinks = [
    { href: "/admin/simulacoes", label: "CLIENTES", key: "simulations" },
    { href: "/admin/novo", label: "CADASTRAR IMÓVEL", key: "new-property" },
    { href: "/admin/relatorio-diario", label: "RELATÓRIO DIÁRIO", key: "daily-report" }
  ];
  const adminGroups = [
    {
      label: "CLIENTES",
      items: [
        { href: "/admin/calendario", label: "CALENDÁRIO", key: "calendar" },
        { href: "/admin/simulacoes", label: "CADASTROS", key: "simulations", activeKeys: ["registrations"] }
      ]
    },
    {
      label: "CADASTROS",
      items: [
        { href: "/admin", label: "Imóveis", key: "properties" },
        { href: "/admin/depoimentos", label: "Depoimentos", key: "testimonials" },
        { href: "/admin/captacoes", label: "Captações", key: "captacoes" }
      ]
    },
    {
      label: "ADMINISTRATIVO",
      align: "right",
      items: [
        { href: "/admin/financeiro", label: "Financeiro", key: "financial" },
        { href: "/admin/relatorio-diario", label: "Relatório Diário", key: "daily-report" },
        { href: "/admin/corretores", label: "Corretores", key: "brokers" }
      ]
    }
  ];

  const isActiveItem = (item) => item.key === active || item.activeKeys?.includes(active);
  const isActiveGroup = (group) => group.items.some(isActiveItem);

  return (
    <div className="container-page mb-8 space-y-3">
      <nav className="flex flex-wrap gap-3" aria-label="Categorias administrativas">
        {isBroker && !isAdmin
          ? brokerLinks.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className={`inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-extrabold transition duration-300 ${
                  active === link.key
                    ? "bg-navy text-white shadow-soft"
                    : "border border-navy/15 bg-white text-navy hover:-translate-y-0.5 hover:border-brand hover:shadow-soft"
                }`}
              >
                {link.label}
              </Link>
            ))
          : adminGroups.map((group) => {
              const groupActive = isActiveGroup(group);

              return (
                <details key={group.label} className="group relative">
                  <summary
                    className={`inline-flex min-h-12 cursor-pointer list-none items-center justify-center rounded-full px-6 text-sm font-extrabold transition duration-300 marker:hidden [&::-webkit-details-marker]:hidden ${
                      groupActive
                        ? "bg-navy text-white shadow-soft"
                        : "border border-navy/15 bg-white text-navy hover:-translate-y-0.5 hover:border-brand hover:shadow-soft"
                    }`}
                  >
                    {group.label}
                    <span className="ml-2 text-xs transition duration-200 group-open:rotate-180" aria-hidden="true">
                      v
                    </span>
                  </summary>
                  <div
                    className={`absolute z-50 mt-2 w-[min(78vw,260px)] rounded-2xl border border-navy/10 bg-white p-2 shadow-soft ${
                      group.align === "right" ? "right-0" : "left-0"
                    }`}
                  >
                    {group.items.map((item) => (
                      <Link
                        key={item.key}
                        href={item.href}
                        className={`block rounded-xl px-4 py-3 text-sm font-extrabold transition duration-200 ${
                          isActiveItem(item)
                            ? "bg-brand text-white"
                            : "text-navy hover:bg-brand/10 hover:text-brand"
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </details>
              );
            })}
      </nav>

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
