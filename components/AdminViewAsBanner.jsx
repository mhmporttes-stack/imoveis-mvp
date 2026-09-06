"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminViewAsBanner({ name, category }) {
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();

  async function leaveView() {
    setLeaving(true);
    const response = await fetch("/api/admin/view-as", { method: "DELETE" });
    if (response.ok) {
      router.replace("/admin/corretores?tab=view-as");
      router.refresh();
      return;
    }
    setLeaving(false);
  }

  return (
    <aside className="sticky top-0 z-[150] border-b border-amber-300 bg-amber-100 px-4 py-2 text-amber-950 shadow-md">
      <div className="container-page flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <p className="font-black">Visualizando como {name} — {category}</p>
          <p className="text-sm font-bold">Modo somente leitura</p>
        </div>
        <button className="rounded-full border border-amber-700 bg-white px-4 py-2 text-sm font-black disabled:opacity-60" disabled={leaving} onClick={leaveView} type="button">
          {leaving ? "Restaurando..." : "Voltar para meu perfil"}
        </button>
      </div>
    </aside>
  );
}
