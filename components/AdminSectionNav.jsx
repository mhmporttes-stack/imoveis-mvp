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
  const links = isBroker && !isAdmin
    ? [
        { href: "/admin/simulacoes", label: "CLIENTES", key: "simulations" },
        { href: "/admin/novo", label: "CADASTRAR IMÓVEL", key: "new-property" },
        { href: "/admin/relatorio-diario", label: "RELATÓRIO DIÁRIO", key: "daily-report" }
      ]
    : [
        { href: "/admin", label: "IMÓVEIS", key: "properties" },
        { href: "/admin/depoimentos", label: "DEPOIMENTOS", key: "testimonials" },
        { href: "/admin/simulacoes", label: "CLIENTES", key: "simulations" },
        { href: "/admin/captacoes", label: "CAPTAÇÕES", key: "captacoes" },
        { href: "/admin/financeiro", label: "FINANCEIRO", key: "financial" },
        { href: "/admin/relatorio-diario", label: "RELATÓRIO DIÁRIO", key: "daily-report" },
        { href: "/admin/calendario", label: "CALENDÁRIO", key: "calendar" },
        { href: "/admin/corretores", label: "CORRETORES", key: "brokers" }
      ];

  return (
    <div className="container-page mb-8 space-y-3">
      <nav className="flex flex-wrap gap-3" aria-label="Categorias administrativas">
        {links.map((link) => (
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
        ))}
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
