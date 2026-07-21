"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteRegistrationButton({ registrationId, registrationName }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(`Excluir o cadastro de "${registrationName}"? Esta ação não pode ser desfeita.`);
    if (!confirmed) return;

    setDeleting(true);
    setError("");

    try {
      const response = await fetch(`/api/simulation-registrations/${registrationId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "Não foi possível excluir este cadastro.");
        return;
      }

      router.push("/admin/cadastros");
      router.refresh();
    } catch {
      setError("Não foi possível excluir este cadastro. Tente novamente.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="container-page">
      <div className="rounded-[28px] border border-red-100 bg-white p-6 shadow-soft sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Zona de exclusão</p>
        <div className="mt-4 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <p className="max-w-2xl text-muted">
            Exclua este cadastro somente se ele não precisar mais aparecer na área administrativa.
          </p>
          <button
            className="premium-button border border-red-200 bg-white text-red-700 hover:bg-red-50 hover:shadow-soft disabled:pointer-events-none disabled:opacity-60"
            disabled={deleting}
            onClick={handleDelete}
            type="button"
          >
            <Trash2 className="mr-2 h-5 w-5" aria-hidden="true" />
            {deleting ? "Excluindo..." : "Excluir cadastro"}
          </button>
        </div>
        {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p> : null}
      </div>
    </div>
  );
}
