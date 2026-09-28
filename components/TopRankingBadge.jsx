"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { weeklyChampionTitle } from "@/lib/ranking-display.mjs";

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
    <div className="grid w-full max-w-lg gap-1.5 py-2 sm:grid-cols-2">
      {data.weeklyTop1 ? (
        <RankingLeader person={data.weeklyTop1} label={weeklyChampionTitle(data.weeklyTop1.gender)} weekly onClick={() => router.push("/admin/meta-diaria")} />
      ) : null}
      {data.top1 ? (
        <RankingLeader person={data.top1} label="Melhor do Dia" onClick={() => router.push("/admin/meta-diaria")} />
      ) : null}
      {data.top1 && !data.isMeTop1 && data.myRank ? (
        <span className="text-center text-[11px] font-bold text-muted sm:col-span-2">
          Sua posição hoje: {data.myRank}º lugar — {formatPoints(data.myPoints)} pontos
        </span>
      ) : null}
    </div>
  );
}

function RankingLeader({ person, label, weekly = false, onClick }) {
  return (
    <button type="button" onClick={onClick} title="Ver desempenho"
      className={`flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2 text-left transition ${weekly
        ? "border-navy bg-navy text-white hover:bg-navy/90"
        : "border-amber-200 bg-amber-50 text-navy hover:bg-amber-100"}`}>
      <span className="relative shrink-0">
        <Avatar name={person.name} photoUrl={person.photoUrl} size={36} />
        <span className="absolute -right-1 -top-1 text-sm leading-none" aria-hidden="true">{weekly ? "🏆" : "★"}</span>
      </span>
      <span className="min-w-0 leading-tight">
        <span className={`block text-[10px] font-black uppercase tracking-wide ${weekly ? "text-blue-100" : "text-amber-700"}`}>{label}</span>
        <span className="block truncate text-sm font-extrabold">{person.name}</span>
        <span className={`block text-xs font-bold ${weekly ? "text-blue-100" : "text-amber-700"}`}>{formatPoints(person.points)} pontos</span>
      </span>
    </button>
  );
}

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}
