"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";

// Card "Radar Econômico" (dono, 2026-10-29 — ECON-1), terceiro card da barra ao lado de Campeão da Semana / Melhor do
// Dia. IPCA e INCC: última variação mensal + referência, seta neutra (sem cor de bom/ruim) e data da última atualização.
// Só lê /api/admin/economic-indicators/radar (banco). Clique abre a aba.
const REFRESH_MS = 30 * 60 * 1000;
const DATE = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

function Arrow({ direction }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-ink-2";
  if (direction === "up") return <ArrowUpRight aria-label="alta" className={cls} />;
  if (direction === "down") return <ArrowDownRight aria-label="queda" className={cls} />;
  if (direction === "stable") return <ArrowRight aria-label="estável" className={cls} />;
  return null;
}

export default function EconomicRadarCard({ className = "" }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/admin/economic-indicators/radar");
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json();
        if (active) { setData(payload); setFailed(false); }
      } catch {
        if (active) setFailed(true);
      }
    }
    load();
    const loadIfVisible = () => { if (document.visibilityState === "visible") load(); };
    const interval = setInterval(loadIfVisible, REFRESH_MS);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const items = data?.items || [];
  return (
    <SceneTransitionLink href="/admin/indicadores-economicos" direction="forward" title="Ver Indicadores Econômicos" className={`relative flex w-full min-w-0 flex-col justify-center gap-1 overflow-hidden rounded-card border border-accent-line bg-white px-2.5 py-2 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-float motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:px-4 lg:py-3 ${className}`}>
      <span aria-hidden="true" className="mm-scan" />
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-black uppercase tracking-wide text-accent-text lg:text-[11px]">Radar Econômico</span>
        <span className="truncate text-[10px] text-muted lg:text-2xs">{failed || data?.failing ? "falha na atualização" : data?.updatedAt ? `atualizado ${DATE.format(new Date(data.updatedAt))}` : ""}</span>
      </span>
      {!data && !failed ? (
        <span className="grid grid-cols-2 gap-2" aria-busy="true"><span className="h-8 animate-pulse rounded-chip bg-mist" /><span className="h-8 animate-pulse rounded-chip bg-mist" /></span>
      ) : (
        <span className="grid grid-cols-2 gap-2">
          {(items.length ? items : [{ code: "ipca", name: "IPCA" }, { code: "incc", name: "INCC-DI" }]).map((item) => (
            <span key={item.code} className="min-w-0">
              <span className="block truncate text-[11px] font-bold text-muted">{item.name}{item.reference ? ` · ${item.reference}` : ""}</span>
              <span className="flex items-center gap-1">
                <b className="truncate text-sm font-extrabold text-ink lg:text-[17px]">{item.label || "—"}</b>
                <Arrow direction={item.direction} />
              </span>
            </span>
          ))}
        </span>
      )}
    </SceneTransitionLink>
  );
}
