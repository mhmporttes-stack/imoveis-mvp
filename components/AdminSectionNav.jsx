import Link from "next/link";
import { getAdminFromCookies, isPrimaryAdminEmail } from "@/lib/admin-auth";

export default async function AdminSectionNav({ active = "properties" }) {
  const admin = await getAdminFromCookies();
  const canAccessFinancial = admin.ok && isPrimaryAdminEmail(admin.user?.email);
  const links = [
    { href: "/admin", label: "IMÓVEIS", key: "properties" },
    { href: "/admin/depoimentos", label: "DEPOIMENTOS", key: "testimonials" },
    { href: "/admin/simulacoes", label: "CLIENTES", key: "simulations" },
    { href: "/admin/captacoes", label: "CAPTAÇÕES", key: "captacoes" },
    ...(canAccessFinancial ? [{ href: "/admin/financeiro", label: "FINANCEIRO", key: "financial" }] : []),
    { href: "/admin/relatorio-diario", label: "RELATÓRIO DIÁRIO", key: "daily-report" }
  ];

  return (
    <nav className="container-page mb-8 flex flex-wrap gap-3" aria-label="Categorias administrativas">
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
  );
}
