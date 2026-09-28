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
    // Atualiza na virada semanal sem esperar o intervalo normal de 5 min.
    const nextMonday = new Date();
    nextMonday.setUTCHours(3, 1, 0, 0);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + ((8 - nextMonday.getUTCDay()) % 7));
    if (nextMonday.getTime() <= Date.now()) nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    const weeklyTimer = setTimeout(load, nextMonday.getTime() - Date.now() + 1000);
    return () => {
      active = false;
      clearInterval(interval);
      clearTimeout(weeklyTimer);
    };
  }, []);

  if (!data?.top1 && !data?.weeklyTop1) return null;

  return (
    <div className="flex min-w-0 max-w-[calc(100vw-1.5rem)] flex-col items-end gap-1 py-1 sm:max-w-[280px]">
      {data.weeklyTop1 ? (
        <RankingLeader person={data.weeklyTop1} label="Melhor da Semana" onClick={() => router.push("/admin/meta-diaria")} />
      ) : null}
      {data.top1 ? (
        <RankingLeader person={data.top1} label="Melhor do Dia" onClick={() => router.push("/admin/meta-diaria")} />
      ) : null}
      {data.top1 && !data.isMeTop1 && data.myRank ? (
        <span className="pr-2 text-right text-[10px] font-bold text-muted">
          Sua posição hoje: {data.myRank}º lugar — {formatPoints(data.myPoints)} pontos
        </span>
      ) : null}
    </div>
  );
}

function RankingLeader({ person, label, onClick }) {
  return (
    <button type="button" onClick={onClick} title="Ver Desempenho Diário"
      className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-amber-200 bg-amber-50/70 py-1 pl-1 pr-3 transition hover:border-amber-300 hover:bg-amber-50">
      <span className="relative shrink-0">
        <Avatar name={person.name} photoUrl={person.photoUrl} size={32} />
        <span className="absolute -right-1 -top-1.5 text-sm leading-none">🏆</span>
      </span>
      <span className="min-w-0 text-left leading-tight">
        <span className="block truncate text-xs font-extrabold text-navy">{person.name}</span>
        <span className="block whitespace-nowrap text-[10px] font-bold text-amber-700">{label} · {formatPoints(person.points)} pts</span>
      </span>
    </button>
  );
}

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}
