"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

// Liga/desliga do fluxo de clientes que esfriaram (só admin geral; POST /api/admin/cooled-clients/settings).
export default function CooledFlowToggle({ enabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function toggle() {
    const next = !enabled;
    if (next && !window.confirm("Ligar o fluxo? A partir da próxima rodada (até 10 min), cada corretor com cliente esfriado recebe a janela obrigatória.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/cooled-clients/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      router.refresh();
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={enabled ? "secondary" : "primary"} loading={busy} onClick={toggle}>{enabled ? "Desligar fluxo" : "Ligar fluxo"}</Button>
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
