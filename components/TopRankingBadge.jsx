"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";

const REFRESH_MS = 5 * 60 * 1000;

// Widget global de gamificação: mostra o líder do ranking diário (mesma
// fonte de "Ranking da Equipe", via getDailyTeamRankingSnapshot) em
// qualquer tela do painel. Vive dentro da barra fixa do layout (não é mais
// um elemento flutuante) — busca uma vez ao montar (o layout autenticado
// mantém este componente vivo entre navegações do App Router) e atualiza
// periodicamente, nunca a cada troca de página.
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
      className="flex min-w-0 max-w-[220px] items-center gap-2 rounded-full border border-amber-200 bg-amber-50/70 py-1 pl-1 pr-3 transition hover:border-amber-300 hover:bg-amber-50 sm:max-w-[260px]"
    >
      <span className="relative shrink-0">
        <Avatar name={data.top1.name} photoUrl={data.top1.photoUrl} size={32} />
        <span className="absolute -right-1 -top-1.5 text-sm leading-none">🏆</span>
      </span>
      <span className="min-w-0 text-left leading-tight">
        <span className="block truncate text-xs font-extrabold text-navy">{data.top1.name}</span>
        <span className="block truncate text-[10px] font-bold text-amber-700">
          Top 1 do dia · {formatPoints(data.top1.points)} pts
        </span>
        {!data.isMeTop1 && data.myRank ? (
          <span className="block truncate text-[10px] font-bold text-muted">Sua posição hoje: {data.myRank}º lugar</span>
        ) : null}
      </span>
    </button>
  );
}

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}
