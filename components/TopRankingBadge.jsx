"use client";

import { useEffect, useState } from "react";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import Avatar from "@/components/Avatar";
import { weeklyChampionTitle } from "@/lib/ranking-display.mjs";

const REFRESH_MS = 5 * 60 * 1000;

// Widget global de gamificação: mostra o líder do ranking diário (mesma
// fonte de "Ranking da Equipe", via getDailyTeamRankingSnapshot) em
// qualquer tela do painel. Vive dentro da barra fixa do layout (não é mais
// um elemento flutuante) — busca uma vez ao montar (o layout autenticado
// mantém este componente vivo entre navegações do App Router) e atualiza
// periodicamente, nunca a cada troca de página.
// weeklyIndicator / dailyIndicator: indicadores de integração (WhatsApp /
// Google Contacts, vindos do layout) exibidos DENTRO dos cards Campeão da
// Semana / Melhor do Dia, no canto superior direito do próprio card. O card
// existe sempre (sem dado = estado vazio honesto), então o indicador nunca
// fica solto na tela (o corretor precisa ver a conexão).
// Sem transform: um transform viraria o bloco de referência dos modais
// `fixed` dos indicadores.
// Celular (pedido do dono, 2026-10-12): os dois cards lado a lado, metade da
// largura cada, compactos (rótulo em cima, foto de 42px, nome em 1 linha,
// pontos). Desktop (lg): como antes — foto grande à esquerda e texto ao lado.
const INDICATOR_POSITION = "absolute right-1.5 top-1 z-20 max-lg:[&>span>button]:h-7 max-lg:[&>span>button]:w-7 lg:right-3";
// Desktop: no Campeão da Semana o indicador fica logo abaixo do título; no Melhor do Dia, no topo.
const WEEKLY_TOP = "lg:top-[1.625rem]";
const DAILY_TOP = "lg:top-2";
// Grade do card: no celular o rótulo ocupa a linha de cima (ao lado só o indicador);
// no desktop a foto ocupa as duas linhas e o rótulo fica sobre o nome.
const CARD_GRID = "grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start items-center lg:content-center gap-x-2 gap-y-1.5 [grid-template-areas:'label_label'_'photo_text'] lg:gap-x-3 lg:gap-y-0.5 lg:[grid-template-areas:'photo_label'_'photo_text']";
const LABEL = "block truncate pr-6 text-[9.5px] min-[390px]:text-[10px] font-black uppercase leading-4 tracking-normal min-[390px]:tracking-wide [grid-area:label] lg:self-end lg:pr-12 lg:text-[11px]";
const PHOTO = "relative z-10 shrink-0 [grid-area:photo]";
const TEXT = "relative z-10 min-w-0 leading-tight [grid-area:text] lg:self-start";
const NAME = "block truncate text-sm font-extrabold text-navy lg:max-w-[calc(100%-2.75rem)] lg:text-lg";
// Foto: 42px no celular, tamanho original no desktop (o Avatar usa estilo inline; !important ganha dele).
const PHOTO_WEEKLY = "border-2 !border-[#DBA735] shadow-sm max-lg:!h-[42px] max-lg:!w-[42px] max-lg:!text-[15px]";
const PHOTO_DAILY = "border-2 !border-[#A9C8EC] max-lg:!h-[42px] max-lg:!w-[42px] max-lg:!text-[15px]";
const WEEKLY_CARD = "relative overflow-hidden rounded-2xl border border-[#E9CB73] bg-[#FFF9E9] px-2.5 py-2 text-left shadow-[0_3px_18px_rgba(203,159,59,0.14)] transition hover:bg-[#FFF4D8] lg:rounded-3xl lg:px-3.5 lg:py-3";
const DAILY_CARD = "relative overflow-hidden rounded-2xl border border-[#C9DDF6] bg-[#F8FBFF] px-2.5 py-2 text-left shadow-[0_2px_12px_rgba(37,99,172,0.07)] transition hover:bg-[#EDF6FF] lg:rounded-3xl lg:px-3.5 lg:py-3";

export default function TopRankingBadge({ weeklyIndicator = null, dailyIndicator = null }) {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

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
      } finally {
        if (active) setLoaded(true);
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

  // Antes da primeira resposta nada é desenhado (evita o indicador pular de
  // lugar e remontar quando os cards aparecem).
  if (!loaded) return null;
  const weekly = data?.weeklyTop1 || null;
  const daily = data?.top1 || null;
  const showMyRank = Boolean(daily && !data.isMeTop1 && data.myRank);

  return (
    <div className={`grid w-full grid-cols-2 gap-2 py-2 lg:items-stretch lg:py-2.5 ${showMyRank
      ? "max-w-5xl lg:grid-cols-[1.3fr_1fr_0.9fr]"
      : "max-w-3xl lg:grid-cols-[1.3fr_1fr]"}`}>
      <div className="relative flex min-w-0">
        <SceneTransitionLink href="/admin/meta-diaria" direction="forward" title="Ver desempenho" className={`${WEEKLY_CARD} ${CARD_GRID}`}>
          <Laurel className="-left-2 bottom-0 max-lg:hidden" />
          <Laurel className="-right-2 bottom-0 -scale-x-100 max-lg:hidden" />
          <span className={`${LABEL} text-[#9B6419]`}>👑 {weekly ? weeklyChampionTitle(weekly.gender) : "Campeão da Semana"}</span>
          {weekly ? (
            <>
              <span className={PHOTO}><Avatar name={weekly.name} photoUrl={weekly.photoUrl} size={64} className={PHOTO_WEEKLY} /></span>
              <span className={TEXT}>
                <span className={NAME}>{weekly.name}</span>
                <span className="block truncate text-xs font-extrabold text-[#B77C17] lg:text-base">{formatPoints(weekly.points)} pontos</span>
                <span className="block truncate text-[10px] font-medium text-slate-600 lg:text-xs">Semana anterior</span>
              </span>
            </>
          ) : (
            <EmptyState tone="weekly" text="Ainda sem campeão" />
          )}
        </SceneTransitionLink>
        {weeklyIndicator ? <span className={`${INDICATOR_POSITION} ${WEEKLY_TOP}`}>{weeklyIndicator}</span> : null}
      </div>
      <div className="relative flex min-w-0">
        <SceneTransitionLink href="/admin/meta-diaria" direction="forward" title="Ver desempenho" className={`${DAILY_CARD} ${CARD_GRID}`}>
          <span className={`${LABEL} text-[#2370BC]`}>🥇 Melhor do Dia</span>
          {daily ? (
            <>
              <span className={PHOTO}><Avatar name={daily.name} photoUrl={daily.photoUrl} size={58} className={PHOTO_DAILY} /></span>
              <span className={TEXT}>
                <span className={NAME}>{daily.name}</span>
                <span className="block truncate text-xs font-extrabold text-[#2370BC] lg:text-base">{formatPoints(daily.points)} pontos <span className="font-medium text-slate-500">hoje</span></span>
              </span>
            </>
          ) : (
            <EmptyState tone="daily" text="Ainda sem pontos hoje" />
          )}
        </SceneTransitionLink>
        {dailyIndicator ? <span className={`${INDICATOR_POSITION} ${DAILY_TOP}`}>{dailyIndicator}</span> : null}
      </div>
      {showMyRank ? (
        <div className="col-span-2 flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-navy shadow-[0_2px_10px_rgba(13,59,102,0.06)] lg:col-span-1 lg:rounded-3xl lg:px-3.5 lg:py-2.5">
          <RankingIcon />
          <span className="shrink-0 text-xs font-bold text-slate-600">Sua posição hoje:</span>
          <span className="rounded-full bg-[#E2F0FF] px-2.5 py-1 text-sm font-black text-[#176BC4]">{data.myRank}º</span>
          <span className="min-w-0 truncate text-sm font-extrabold text-navy">{formatPoints(data.myPoints)} pts</span>
        </div>
      ) : null}
    </div>
  );
}

// Card sem dado (ex.: dia ainda sem pontos): mesmo tamanho do card preenchido,
// com um círculo tracejado no lugar da foto — nunca um ícone solto na tela.
function EmptyState({ tone, text }) {
  const ring = tone === "weekly" ? "border-[#DBA735]/60" : "border-[#A9C8EC]";
  return (
    <>
      <span className={PHOTO}>
        <span aria-hidden="true" className={`block h-[42px] w-[42px] rounded-full border-2 border-dashed ${ring} lg:h-[58px] lg:w-[58px]`} />
      </span>
      <span className={TEXT}>
        <span className="block text-xs font-bold leading-snug text-slate-500 lg:text-sm">{text}</span>
      </span>
    </>
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
