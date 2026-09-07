"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminViewAsSelector({ users }) {
  const [profileId, setProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const selected = users.find((user) => user.id === profileId);

  async function startView(event) {
    event.preventDefault();
    if (!profileId) return;
    setLoading(true);
    setError("");

    const response = await fetch("/api/admin/view-as", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload.error || "Nao foi possivel alterar a conta.");
      setLoading(false);
      return;
    }

    router.replace(payload.redirectTo || "/admin/simulacoes");
    router.refresh();
  }

  return (
    <section className="container-page rounded-[28px] border border-line bg-white p-6 shadow-soft md:p-8">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Acesso rápido</p>
      <h2 className="mt-2 text-3xl font-black text-navy">Alterar conta</h2>
      <p className="mt-3 max-w-2xl font-semibold text-muted">Acesse uma conta ativa sem informar novamente login e senha.</p>

      <form className="mt-6 flex flex-col gap-4 md:flex-row md:items-end" onSubmit={startView}>
        <label className="grid flex-1 gap-2 text-sm font-black text-navy">
          Usuario ativo
          <select className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">Selecione um usuario</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name} — {roleLabel(user.role)}</option>)}
          </select>
        </label>
        <button className="premium-button-primary min-h-14 disabled:cursor-not-allowed disabled:opacity-50" disabled={!selected || loading} type="submit">
          {loading ? "Alterando..." : "Alterar conta"}
        </button>
      </form>
      {selected ? <p className="mt-4 text-sm font-bold text-muted">Selecionado: <strong className="text-navy">{selected.name} — {roleLabel(selected.role)}</strong></p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}
    </section>
  );
}

function roleLabel(role) {
  if (role === "admin") return "Administrador geral";
  if (role === "manager") return "Gestor";
  if (role === "associate") return "Associado";
  return "Corretor";
}
