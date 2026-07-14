import Link from "next/link";

export default function AdminSectionNav({ active = "properties" }) {
  const links = [
    { href: "/admin", label: "Empreendimentos", key: "properties" },
    { href: "/admin/depoimentos", label: "Depoimentos", key: "testimonials" }
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
