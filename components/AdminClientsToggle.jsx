import Link from "next/link";

export default function AdminClientsToggle({ active = "list" }) {
  const views = [
    { href: "/admin/simulacoes", label: "Lista de clientes", key: "list" },
    { href: "/admin/calendario", label: "Calendário", key: "calendar" }
  ];

  return (
    <div className="container-page -mt-3 mb-6">
      <div className="inline-flex rounded-full border border-navy/10 bg-white p-1 shadow-sm" aria-label="Alternar visualizacao de clientes">
        {views.map((view) => (
          <Link
            key={view.key}
            href={view.href}
            className={`rounded-full px-5 py-2 text-sm font-extrabold transition duration-200 ${
              active === view.key
                ? "bg-navy text-white shadow-soft"
                : "text-navy hover:bg-brand/10 hover:text-brand"
            }`}
          >
            {view.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
