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
// z-40: os painéis dos ícones (Notificações, WhatsApp, Google Contacts) abrem para baixo e precisam ficar POR CIMA da barra de busca
// fixa das telas (sticky z-20, ex.: Clientes) — com z-20 a busca cobria o painel.
const INDICATOR_POSITION = "absolute right-1.5 top-1 z-40 flex items-center gap-1 max-lg:[&>span>button]:h-7 max-lg:[&>span>button]:w-7 lg:right-3";
// Desktop: no Campeão da Semana o indicador fica logo abaixo do título; no Melhor do Dia, no topo.
const WEEKLY_TOP = "lg:top-[1.625rem]";
const DAILY_TOP = "lg:top-2";
// Grade do card: no celular o rótulo ocupa a linha de cima (ao lado só o indicador);
// no desktop a foto ocupa as duas linhas e o rótulo fica sobre o nome.
const CARD_GRID = "grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start items-center lg:content-center gap-x-2 gap-y-1.5 [grid-template-areas:'label_label'_'photo_text'] lg:gap-x-3 lg:gap-y-0.5 lg:[grid-template-areas:'photo_label'_'photo_text']";
const LABEL = "block truncate pr-6 text-[9.5px] min-[390px]:text-[10px] font-black uppercase leading-4 tracking-normal min-[390px]:tracking-wide [grid-area:label] lg:self-end lg:pr-12 lg:text-[11px]";
const PHOTO = "relative z-10 shrink-0 [grid-area:photo]";
const TEXT = "relative z-10 min-w-0 leading-tight [grid-area:text] lg:self-start";
const NAME = "block truncate text-sm font-extrabold text-ink lg:max-w-[calc(100%-2.75rem)] lg:text-[17px]";
// Foto: 42px no celular, tamanho original no desktop (o Avatar usa estilo inline; !important ganha dele).
// Visual novo (dono, 2026-10-22): cards na superfície do painel com borda dourada (semana) ou azul (dia), brilho que
// passa devagar, anel pulsando em volta da foto e a coroa ♛ dourada flutuando (app/globals.css: .mm-crown etc.).
const PHOTO_WEEKLY = "border-2 !border-[#F2C66D] max-lg:!h-[42px] max-lg:!w-[42px] max-lg:!text-[15px]";
const PHOTO_DAILY = "border-2 !border-accent max-lg:!h-[42px] max-lg:!w-[42px] max-lg:!text-[15px]";
const CARD_BASE = "mm-champion relative overflow-hidden rounded-card border bg-white px-2.5 py-2 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-float motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:px-4 lg:py-3";
const WEEKLY_CARD = `${CARD_BASE} mm-champion-weekly border-[#F0D9A6]`;
const DAILY_CARD = `${CARD_BASE} mm-champion-daily border-accent-line`;

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
    // Desempenho (2026-10-20): pausa com a aba/app oculto; ao voltar a ficar visível atualiza na hora.
    const loadIfVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const interval = setInterval(loadIfVisible, REFRESH_MS);
    document.addEventListener("visibilitychange", loadIfVisible);
    // Atualiza na virada semanal sem esperar o intervalo normal de 5 min.
    const nextMonday = new Date();
    nextMonday.setUTCHours(3, 1, 0, 0);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + ((8 - nextMonday.getUTCDay()) % 7));
    if (nextMonday.getTime() <= Date.now()) nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    const weeklyTimer = setTimeout(loadIfVisible, nextMonday.getTime() - Date.now() + 1000);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", loadIfVisible);
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
    <div className={`grid w-full grid-cols-2 gap-2 pb-1 pt-2 lg:items-stretch lg:gap-3 ${showMyRank
      ? "lg:grid-cols-[1fr_1fr_0.8fr]"
      : "lg:grid-cols-2"}`}>
      <div className="relative flex min-w-0">
        <SceneTransitionLink href="/admin/meta-diaria" direction="forward" title="Ver desempenho" className={`${WEEKLY_CARD} ${CARD_GRID}`}>
          <span aria-hidden="true" className="mm-scan" />
          <span className={`${LABEL} text-warning`}>{weekly ? weeklyChampionTitle(weekly.gender) : "Campeão da Semana"}</span>
          {weekly ? (
            <>
              <span className={`${PHOTO} mm-pulse-ring mm-pulse-gold rounded-full`}>
                <Avatar name={weekly.name} photoUrl={weekly.photoUrl} size={58} className={PHOTO_WEEKLY} />
                <span aria-hidden="true" className="mm-crown absolute -right-1 -top-2 text-sm leading-none lg:-right-1.5 lg:-top-3 lg:text-lg">♛</span>
              </span>
              <span className={TEXT}>
                <PersonName name={weekly.name} />
                <span className="block truncate text-xs font-medium text-muted lg:text-[13px]"><b className="text-[13px] font-extrabold text-warning lg:text-[15px]">{formatPoints(weekly.points)} pontos</b><span className="max-lg:hidden"> semana anterior</span></span>
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
          <span aria-hidden="true" className="mm-scan" />
          <span className={`${LABEL} text-accent-text max-lg:!pr-[4.25rem] lg:!pr-[6.5rem]`}>Melhor do Dia</span>
          {daily ? (
            <>
              <span className={`${PHOTO} mm-pulse-ring rounded-full`}>
                <Avatar name={daily.name} photoUrl={daily.photoUrl} size={58} className={PHOTO_DAILY} />
                <span aria-hidden="true" className="mm-float absolute -right-1 -top-2 text-sm leading-none text-accent lg:-right-1.5 lg:-top-3 lg:text-lg">✦</span>
              </span>
              <span className={TEXT}>
                <PersonName name={daily.name} />
                <span className="block truncate text-xs font-medium text-muted lg:text-[13px]"><b className="text-[13px] font-extrabold text-accent-text lg:text-[15px]">{formatPoints(daily.points)} pontos</b><span className="max-lg:hidden"> hoje</span></span>
              </span>
            </>
          ) : (
            <EmptyState tone="daily" text="Ainda sem pontos hoje" />
          )}
        </SceneTransitionLink>
        {dailyIndicator ? <span className={`${INDICATOR_POSITION} ${DAILY_TOP}`}>{dailyIndicator}</span> : null}
      </div>
      {showMyRank ? (
        <div className="col-span-2 flex min-w-0 items-center gap-2 rounded-card border border-line bg-white px-3 py-1.5 text-ink lg:col-span-1 lg:px-3.5 lg:py-2.5">
          <RankingIcon />
          <span className="shrink-0 text-xs font-bold text-muted">Sua posição hoje:</span>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-sm font-black text-accent-text">{data.myRank}º</span>
          <span className="min-w-0 truncate text-sm font-extrabold text-ink">{formatPoints(data.myPoints)} pts</span>
        </div>
      ) : null}
    </div>
  );
}

// Celular (crítica de 2026-10-22): só o primeiro nome, para nada ser cortado no card de meia largura; o nome
// completo continua no computador e no leitor de tela.
function PersonName({ name = "" }) {
  const first = String(name).trim().split(/\s+/)[0] || name;
  return (
    <span className={NAME} title={name}>
      <span className="lg:hidden" aria-hidden="true">{first}</span>
      <span className="max-lg:sr-only">{name}</span>
    </span>
  );
}

// Card sem dado (ex.: dia ainda sem pontos): mesmo tamanho do card preenchido,
// com um círculo tracejado no lugar da foto — nunca um ícone solto na tela.
function EmptyState({ tone, text }) {
  const ring = tone === "weekly" ? "border-[#F2C66D]/70" : "border-accent-line";
  return (
    <>
      <span className={PHOTO}>
        <span aria-hidden="true" className={`block h-[42px] w-[42px] rounded-full border-2 border-dashed ${ring} lg:h-[58px] lg:w-[58px]`} />
      </span>
      <span className={TEXT}>
        <span className="block text-xs font-bold leading-snug text-muted lg:text-sm">{text}</span>
      </span>
    </>
  );
}

function RankingIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-accent stroke-2"><rect x="3" y="14" width="4" height="7" rx="1" /><rect x="10" y="9" width="4" height="12" rx="1" /><rect x="17" y="4" width="4" height="17" rx="1" /></svg>;
}

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}
