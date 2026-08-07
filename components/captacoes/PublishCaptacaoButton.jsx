"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";

export default function PublishCaptacaoButton({ captacaoId, propertyId = "" }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function publishDraft() {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/captacoes/${captacaoId}/publish`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível criar o rascunho.");
      const nextPropertyId = payload.property?.id || propertyId;
      if (nextPropertyId) {
        router.push(`/admin/empreendimentos/${nextPropertyId}`);
      } else {
        router.refresh();
      }
    } catch (publishError) {
      setError(publishError.message || "Não foi possível criar o rascunho.");
      setIsLoading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={publishDraft}
        disabled={isLoading}
        className="premium-button-primary inline-flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-70"
      >
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <FilePlus2 className="h-5 w-5" aria-hidden="true" />}
        {propertyId ? "Abrir rascunho do imóvel" : "Criar rascunho de imóvel"}
      </button>
      {error ? <p className="text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
