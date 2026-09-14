"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";

const REFRESH_MS = 5 * 60 * 1000;

// Widget global de gamificação: mostra o líder do ranking diário (mesmo
// critério da Meta Diária > Desempenho Diário) em qualquer tela do painel.
// Busca uma vez ao montar (o layout autenticado mantém este componente
// vivo entre navegações do App Router) e atualiza periodicamente — nunca a
// cada troca de página.
export default function TopRankingBadge() {
  const [data, setData] = useState(null);
  const router = useRouter();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/daily-goal/top-ranking");
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setData(payload);
      } catch {
        // Falha silenciosa: é um widget decorativo, não deve interromper a navegação.
      }
    }

    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (!data?.top1) return null;

  return (
    <button
      type="button"
      onClick={() => router.push("/admin/meta-diaria")}
      title="Ver Desempenho Diário"
      className="fixed right-3 top-3 z-40 flex max-w-[190px] items-center gap-2 rounded-full border border-amber-200 bg-white/95 py-1.5 pl-1.5 pr-3 shadow-[0_8px_24px_rgba(13,59,102,0.14)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(13,59,102,0.2)] sm:right-5 sm:top-5"
    >
      <span className="relative shrink-0">
        <Avatar name={data.top1.name} photoUrl={data.top1.photoUrl} size={36} />
        <span className="absolute -right-1 -top-1.5 text-sm leading-none">🏆</span>
      </span>
      <span className="min-w-0 text-left leading-tight">
        <span className="block text-[9px] font-black uppercase tracking-[0.08em] text-amber-600">Top 1 do dia</span>
        <span className="block truncate text-xs font-extrabold text-navy">{data.top1.name}</span>
        {!data.isMeTop1 && data.myRank ? (
          <span className="block truncate text-[10px] font-bold text-muted">Sua posição hoje: {data.myRank}º lugar</span>
        ) : null}
      </span>
    </button>
  );
}
