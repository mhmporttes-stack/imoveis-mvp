"use client";

import { useState } from "react";
import { CAPTACAO_STATUS_OPTIONS, captacaoStatusClasses } from "@/lib/captacoes-schema";

export default function CaptacaoStatusSelect({ captacaoId, initialStatus = "nova" }) {
  const [status, setStatus] = useState(initialStatus);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function updateStatus(nextStatus) {
    setStatus(nextStatus);
    setIsSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/captacoes/${captacaoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o status.");
    } catch (updateError) {
      setStatus(status);
      setError(updateError.message || "Não foi possível atualizar o status.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      <select
        value={status}
        onChange={(event) => updateStatus(event.target.value)}
        disabled={isSaving}
        className={`min-h-11 rounded-full border px-4 text-sm font-black outline-none transition focus:ring-4 focus:ring-brand/15 ${captacaoStatusClasses(status)}`}
      >
        {CAPTACAO_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {error ? <p className="text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
