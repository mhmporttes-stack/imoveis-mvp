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
  const showMyRank = Boolean(data.top1 && !data.isMeTop1 && data.myRank);

  return (
    <div className={`grid w-full gap-2 py-2.5 lg:items-stretch ${showMyRank
      ? "max-w-5xl lg:grid-cols-[1.3fr_1fr_0.9fr]"
      : "max-w-3xl lg:grid-cols-[1.3fr_1fr]"}`}>
      {data.weeklyTop1 ? (
        <button type="button" onClick={() => router.push("/admin/meta-diaria")} title="Ver desempenho"
          className="relative flex min-w-0 items-center gap-3 overflow-hidden rounded-3xl border border-[#E9CB73] bg-[#FFF9E9] px-3.5 py-3 text-left shadow-[0_3px_18px_rgba(203,159,59,0.14)] transition hover:bg-[#FFF4D8]">
          <Laurel className="-left-2 bottom-0" />
          <Laurel className="-right-2 bottom-0 -scale-x-100" />
          <span className="relative z-10 shrink-0">
            <Avatar name={data.weeklyTop1.name} photoUrl={data.weeklyTop1.photoUrl} size={64} className="border-2 !border-[#DBA735] shadow-sm" />
            <span className="absolute -left-2 -top-5 -rotate-12 text-3xl leading-none" aria-hidden="true">👑</span>
          </span>
          <span className="relative z-10 min-w-0 leading-tight">
            <span className="block text-[11px] font-black uppercase tracking-wide text-[#9B6419]">👑 {weeklyChampionTitle(data.weeklyTop1.gender)}</span>
            <span className="mt-0.5 block truncate text-lg font-extrabold text-navy">{data.weeklyTop1.name}</span>
            <span className="block text-base font-extrabold text-[#B77C17]">{formatPoints(data.weeklyTop1.points)} pontos</span>
            <span className="block text-xs font-medium text-slate-600">Semana anterior</span>
          </span>
        </button>
      ) : null}
      {data.top1 ? (
        <button type="button" onClick={() => router.push("/admin/meta-diaria")} title="Ver desempenho"
          className="flex min-w-0 items-center gap-3 rounded-3xl border border-[#C9DDF6] bg-[#F8FBFF] px-3.5 py-3 text-left shadow-[0_2px_12px_rgba(37,99,172,0.07)] transition hover:bg-[#EDF6FF]">
          <span className="relative shrink-0">
            <Avatar name={data.top1.name} photoUrl={data.top1.photoUrl} size={58} className="border-2 !border-[#A9C8EC]" />
            <span className="absolute -right-2 -top-3 text-2xl leading-none" aria-hidden="true">🥇</span>
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[11px] font-black uppercase tracking-wide text-[#2370BC]">Melhor do Dia</span>
            <span className="mt-0.5 block truncate text-lg font-extrabold text-navy">{data.top1.name}</span>
            <span className="block text-base font-extrabold text-[#2370BC]">{formatPoints(data.top1.points)} pontos <span className="font-medium text-slate-500">hoje</span></span>
          </span>
        </button>
      ) : null}
      {showMyRank ? (
        <div className="flex min-w-0 items-center gap-2 rounded-3xl border border-slate-200 bg-white px-3.5 py-2.5 text-navy shadow-[0_2px_10px_rgba(13,59,102,0.06)]">
          <RankingIcon />
          <span className="shrink-0 text-xs font-bold text-slate-600">Sua posição hoje:</span>
          <span className="rounded-full bg-[#E2F0FF] px-2.5 py-1 text-sm font-black text-[#176BC4]">{data.myRank}º</span>
          <span className="min-w-0 truncate text-sm font-extrabold text-navy">{formatPoints(data.myPoints)} pts</span>
        </div>
      ) : null}
    </div>
  );
}

function Laurel({ className }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 80" className={`pointer-events-none absolute h-20 w-11 fill-[#D9AB41] opacity-25 ${className}`}>
      <path d="M29 75C10 59 7 31 24 7" fill="none" stroke="#D9AB41" strokeWidth="2" />
      <ellipse cx="14" cy="57" rx="4" ry="9" transform="rotate(-40 14 57)" />
      <ellipse cx="27" cy="59" rx="4" ry="8" transform="rotate(35 27 59)" />
      <ellipse cx="11" cy="39" rx="4" ry="8" transform="rotate(-25 11 39)" />
      <ellipse cx="23" cy="40" rx="4" ry="8" transform="rotate(32 23 40)" />
      <ellipse cx="16" cy="22" rx="4" ry="8" transform="rotate(-15 16 22)" />
      <ellipse cx="28" cy="22" rx="4" ry="8" transform="rotate(35 28 22)" />
    </svg>
  );
}

function RankingIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-[#2370BC] stroke-2"><rect x="3" y="14" width="4" height="7" rx="1" /><rect x="10" y="9" width="4" height="12" rx="1" /><rect x="17" y="4" width="4" height="17" rx="1" /></svg>;
}

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}
