"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";

// ROL-2f (dono, 2026-10-13): avisa quem participa da roleta e está FORA dela
// por não ter vindo à imobiliária. Some sozinho quando o CRM detecta a chegada
// (Wi-Fi da imobiliária) ou quando o dono/gestora libera o dia.
const POLL_MS = 3 * 60 * 1000;
const ABSENT_UNTIL = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit" });

export default function OfficePresenceNotice() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/admin/office-presence/me", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json().catch(() => null);
        if (!cancelled && data) setStatus(data);
      } catch {
        // Falha pontual: tenta de novo no próximo ciclo.
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  if (!status?.ruleEnabled || !status.inRoulette || status.eligible) return null;
  return (
    <div role="status" className="container-page pt-3">
      <div className="flex items-start gap-2.5 rounded-control border border-warning-line bg-warning-soft px-3 py-2.5 text-sm text-warning">
        <Building2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        {status.absence ? (
          // "Marcar ausente" (dono, 2026-10-17): o Wi-Fi não conta enquanto a ausência vale.
          <p>
            <span className="font-semibold">Você está fora da roleta.</span> Você foi marcado como ausente
            {status.absence.markedByName ? ` por ${status.absence.markedByName}` : ""} até {ABSENT_UNTIL.format(new Date(Date.parse(status.absence.absentUntil) - 1))}. Fale
            com a gestão se você está na imobiliária.
          </p>
        ) : (
          <p>
            <span className="font-semibold">Você está fora da roleta.</span> Venha à imobiliária e conecte o celular no Wi-Fi de lá para voltar a receber
            leads.
          </p>
        )}
      </div>
    </div>
  );
}
