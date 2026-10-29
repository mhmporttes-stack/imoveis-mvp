"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import Sheet from "@/components/ui/Sheet";
import Button, { buttonClasses } from "@/components/ui/Button";
import { LineChart, SERIES_COLORS } from "@/components/economic/EconomicCharts";
import { isPageHidden, onPageVisibilityChange } from "@/components/page-visibility";
import { BRAND_SIGNATURE, brDateLabel, buildInstallmentMessage, directionTone, formatBrl, formatValue, labelMonth, monthKey, saoPauloDay } from "@/lib/economic-indicators-core.mjs";

// Card "Radar Econômico" (dono, 2026-10-29 — ECON-1), terceiro card da barra ao lado de Campeão da Semana / Melhor do
// Dia. Tira ECON-2 (dono, 2026-10-29): mini-cards (Selic, Caixa + média dos bancos, TR, INCC-DI, IPCA, renda ou
// desemprego, MCMV cadastrado à mão) com seta e minigráfico REAL dos últimos 6 meses; celular = carrossel com encaixe
// (~2,5 visíveis). Tocar abre o detalhe (12 meses, fonte oficial, data da divulgação). Selo "mudou hoje" quando a
// divulgação nova entrou hoje. Botão "Como isso afeta a parcela" monta texto para WhatsApp só com os números mostrados.
// IPCA/INCC: queda verde, alta vermelha (directionTone). Só lê /api/admin/economic-indicators/radar (banco, cache 30 s).
const REFRESH_MS = 30 * 60 * 1000;
const DATE = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
const FULL_DATE = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

const TONE_CLASS = { good: "text-success", bad: "text-danger", neutral: "text-ink-2" };
const FALLBACK_TILES = [{ code: "ipca", name: "IPCA" }, { code: "incc", name: "INCC-DI" }];
const SOURCE_NAME = { BCB: "Banco Central do Brasil", IBGE: "IBGE", FGV: "FGV (republicado pelo Banco Central)" };

// Dono, 2026-10-29: IPCA/INCC — queda verde, alta vermelha, estável neutra (ícone + aria-label, não só cor).
function Arrow({ direction, code, tone }) {
  const cls = `h-3.5 w-3.5 shrink-0 ${TONE_CLASS[tone || directionTone(code, direction)]}`;
  if (direction === "up") return <ArrowUpRight aria-label="alta" className={cls} />;
  if (direction === "down") return <ArrowDownRight aria-label="queda" className={cls} />;
  if (direction === "stable") return <ArrowRight aria-label="estável" className={cls} />;
  return null;
}

function pathFor(values, width, height, pad = 1.5) {
  const nums = (values || []).filter((v) => Number.isFinite(v));
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const span = Math.max(...nums) - min || 1;
  return nums.map((v, i) => `${i ? "L" : "M"}${((i / (nums.length - 1)) * width).toFixed(1)},${(pad + (1 - (v - min) / span) * (height - pad * 2)).toFixed(1)}`).join(" ");
}

// Minigráfico dos últimos ~6 meses (valores reais da série). Só enfeite visual: o valor está no texto.
function Sparkline({ values }) {
  const d = pathFor(values, 60, 16);
  if (!d) return <span aria-hidden="true" className="block h-4" />;
  return (
    <svg aria-hidden="true" viewBox="0 0 60 16" preserveAspectRatio="none" className="block h-4 w-full text-accent">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Fundo: a linha real (INCC-DI; sem 3 meses, Selic) a 10% de opacidade, deriva lenta só por transform (globals.css).
function Backdrop({ tiles }) {
  const pick = tiles.find((t) => t.code === "incc" && t.history?.length >= 3) || tiles.find((t) => t.code === "selic" && t.history?.length >= 3);
  const d = pathFor(pick?.history?.map((p) => p.value), 400, 60, 6);
  if (!d) return null;
  return (
    <svg aria-hidden="true" viewBox="0 0 400 60" preserveAspectRatio="none" className="mm-radar-backdrop">
      <path d={`${d} L400,60 L0,60 Z`} fill="currentColor" opacity="0.35" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function subline(tile) {
  if (tile.code === "financiamento") return tile.average ? `média ${tile.average.label}` : tile.reference;
  if (tile.twelveMonthsLabel && (tile.code === "incc" || tile.code === "ipca")) return `12m ${tile.twelveMonthsLabel}`;
  return tile.reference || "";
}

function ariaFor(tile) {
  const parts = [tile.fullName || tile.name, tile.label || "sem dado", tile.reference];
  if (tile.code === "financiamento" && tile.average) parts.push(`média dos bancos ${tile.average.label}`);
  if (tile.twelveMonthsLabel) parts.push(`${tile.twelveMonthsLabel} em 12 meses`);
  if (tile.releasedToday) parts.push("mudou hoje");
  return `${parts.filter(Boolean).join(", ")}. Abrir detalhe.`;
}

function MiniCard({ tile, onOpen }) {
  const clickable = Boolean(tile.label);
  return (
    <li className="min-w-0 shrink-0 basis-[38%] snap-start sm:basis-[30%] lg:basis-[38%] xl:basis-[30%]">
      <button
        type="button"
        disabled={!clickable}
        onClick={() => onOpen(tile)}
        aria-label={clickable ? ariaFor(tile) : `${tile.name}: sem dado`}
        className="flex h-full w-full min-w-0 flex-col gap-0.5 rounded-chip border border-line bg-white/85 px-2 py-1.5 text-left transition-transform duration-150 ease-out-ui active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-default"
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[11px] font-bold text-muted">{tile.name}</span>
          {tile.releasedToday ? <span className="shrink-0 rounded-full bg-accent-strong px-1.5 text-[9px] font-black uppercase leading-4 text-on-accent">mudou hoje</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <b className="truncate text-sm font-extrabold text-ink lg:text-[15px]">{tile.label || "—"}</b>
          <Arrow direction={tile.direction} code={tile.code} tone={tile.tone} />
        </span>
        <span className="truncate text-[10px] text-muted">{subline(tile)}</span>
        {tile.spark?.length ? <Sparkline values={tile.spark} /> : null}
      </button>
    </li>
  );
}

function sourceText(tile) {
  if (tile.code === "mcmv") return tile.sourceLabel;
  return `${SOURCE_NAME[tile.source] || tile.source} — ${tile.sourceLabel}`;
}

function Detail({ tile, open, onClose }) {
  const unit = { code: tile?.code, unit: tile?.unit };
  const series = useMemo(() => {
    if (!tile?.history?.length) return [];
    const main = [{ code: tile.code, name: tile.code === "financiamento" ? (tile.caixa ? "Caixa" : "Média dos bancos") : tile.name, color: SERIES_COLORS[0], points: tile.history }];
    if (tile.code === "financiamento" && tile.caixa && tile.averageHistory?.length) main.push({ code: "media", name: "Média dos bancos", color: SERIES_COLORS[2], points: tile.averageHistory });
    return main;
  }, [tile]);
  return (
    <Sheet open={open} onClose={onClose} title={tile ? tile.fullName || tile.name : "Detalhe"} description={tile?.description || ""}>
      {tile ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <b className="text-2xl font-black text-ink">{tile.label}</b>
            <span className="flex items-center gap-1 text-sm text-ink-2">
              <Arrow direction={tile.direction} code={tile.code} tone={tile.tone} />
              {tile.reference}
            </span>
            {tile.releasedToday ? <span className="rounded-full bg-accent-strong px-2 py-0.5 text-[11px] font-black uppercase text-on-accent">mudou hoje</span> : null}
          </div>
          {tile.twelveMonthsLabel ? <p className="text-sm text-ink-2">Acumulado em 12 meses: <b className="text-ink">{tile.twelveMonthsLabel}</b></p> : null}
          {tile.code === "financiamento" ? (
            <p className="text-sm text-ink-2">
              {tile.caixa ? <>Caixa: <b className="text-ink">{tile.caixa.label}</b> · </> : null}
              Média de {tile.average.count} instituições: <b className="text-ink">{tile.average.label}</b>. Média de mercado — <b>não é a taxa oferecida a um cliente</b>.
            </p>
          ) : null}
          {tile.code === "mcmv" ? (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Faixas do Minha Casa Minha Vida</caption>
              <thead><tr className="text-xs text-muted"><th className="py-1 font-bold">Faixa</th><th className="py-1 font-bold">Renda até</th><th className="py-1 font-bold">Teto do imóvel</th></tr></thead>
              <tbody>
                {tile.faixas.map((f) => (
                  <tr key={f.nome} className="border-t border-line"><td className="py-1.5 font-bold text-ink">{f.nome}</td><td className="py-1.5">{f.rendaAte ? formatBrl(f.rendaAte) : "—"}</td><td className="py-1.5">{f.tetoImovel ? formatBrl(f.tetoImovel) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div>
              <p className="mb-1 text-xs font-bold text-muted">Últimos 12 meses</p>
              <LineChart series={series} formatValue={(v) => formatValue(unit, v)} formatDate={(d) => labelMonth(monthKey(d))} emptyText="Ainda sem histórico suficiente." />
            </div>
          )}
          <p className="rounded-chip border border-line bg-mist px-3 py-2 text-xs text-ink-2">
            <b className="text-ink">Fonte:</b> {sourceText(tile)}
            {tile.collectedAt ? <> · divulgação recebida pelo CRM em {FULL_DATE.format(new Date(tile.collectedAt))}</> : null}
          </p>
          <SceneTransitionLink href="/admin/indicadores-economicos" direction="forward" className={buttonClasses({ variant: "secondary", size: "sm", className: "justify-self-start" })}>
            Ver todos os indicadores
          </SceneTransitionLink>
        </div>
      ) : null}
    </Sheet>
  );
}

function InstallmentSheet({ open, tiles, onClose }) {
  const [sign, setSign] = useState(true);
  const [copied, setCopied] = useState("");
  const text = useMemo(() => buildInstallmentMessage(tiles, { sign }), [tiles, sign]);
  const textRef = useRef(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Texto copiado. É só colar no WhatsApp.");
    } catch {
      textRef.current?.select();
      setCopied("Não foi possível copiar sozinho: o texto está selecionado, copie manualmente.");
    }
  }
  return (
    <Sheet open={open} onClose={() => { setCopied(""); onClose(); }} title="Como isso afeta a parcela" description="Texto pronto só com os números oficiais do Radar. Não promete aprovação, taxa nem valor de parcela.">
      {text ? (
        <div className="grid gap-3">
          <textarea ref={textRef} readOnly value={text} rows={12} aria-label="Texto para o WhatsApp" className="w-full rounded-control border border-line bg-mist p-3 text-sm text-ink" />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={sign} onChange={(e) => setSign(e.target.checked)} className="h-4 w-4 accent-accent" />
            Assinar com “{BRAND_SIGNATURE}”
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}>Copiar texto</Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary" })}>
              Abrir no WhatsApp
            </a>
          </div>
          {copied ? <p role="status" className="text-sm font-medium text-success">{copied}</p> : null}
        </div>
      ) : (
        <p className="text-sm text-muted">Ainda não há números oficiais carregados para montar o texto.</p>
      )}
    </Sheet>
  );
}

export default function EconomicRadarCard({ className = "" }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [detail, setDetail] = useState(null); // continua montado durante a saída animada do Sheet
  const [detailOpen, setDetailOpen] = useState(false);
  const [installmentOpen, setInstallmentOpen] = useState(false);
  const stripRef = useRef(null);

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
    setHidden(isPageHidden());
    const loadIfVisible = () => { if (!isPageHidden()) load(); };
    const interval = setInterval(loadIfVisible, REFRESH_MS);
    // Aba oculta (ou app de desktop minimizado): o gráfico de fundo e o brilho param.
    const stopWatchingVisibility = onPageVisibilityChange(() => setHidden(isPageHidden()));
    return () => { active = false; clearInterval(interval); stopWatchingVisibility(); };
  }, []);

  const items = data?.items || [];
  const tiles = data?.tiles?.length ? data.tiles : items.length ? items : FALLBACK_TILES;
  const hasNumbers = tiles.some((t) => t.label);
  const today = data?.today || saoPauloDay(new Date());

  function scroll(direction) {
    const el = stripRef.current;
    if (!el) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.75, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <section aria-label="Radar Econômico" className={`relative flex w-full min-w-0 flex-col justify-center gap-1 overflow-hidden rounded-card border border-accent-line bg-white px-2.5 py-2 text-left lg:px-3 lg:py-2.5 ${hidden ? "mm-radar-paused" : ""} ${className}`}>
      <span aria-hidden="true" className="mm-scan" />
      <Backdrop tiles={tiles} />
      <span className="relative flex items-center justify-between gap-2">
        <SceneTransitionLink href="/admin/indicadores-economicos" direction="forward" title="Ver Indicadores Econômicos" className="truncate rounded-chip text-[10px] font-black uppercase tracking-wide text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:text-[11px]">
          Radar Econômico
        </SceneTransitionLink>
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[10px] text-muted lg:text-2xs">{failed || data?.failing ? "falha na atualização" : data?.updatedAt ? `atualizado ${DATE.format(new Date(data.updatedAt))}` : ""}</span>
          <button type="button" onClick={() => scroll(-1)} aria-label="Indicadores anteriores" className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" onClick={() => scroll(1)} aria-label="Próximos indicadores" className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </span>
      </span>
      {!data && !failed ? (
        <span className="relative flex gap-2" aria-busy="true"><span className="h-14 basis-[38%] animate-pulse rounded-chip bg-mist" /><span className="h-14 basis-[38%] animate-pulse rounded-chip bg-mist" /><span className="h-14 basis-[24%] animate-pulse rounded-chip bg-mist" /></span>
      ) : (
        <ul ref={stripRef} role="list" aria-label={`Indicadores de ${brDateLabel(today)}`} className="mm-noscroll relative flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-px-0.5 px-0.5 py-0.5">
          {tiles.map((tile) => <MiniCard key={tile.code} tile={tile} onOpen={(t) => { setDetail(t); setDetailOpen(true); }} />)}
          {hasNumbers ? (
            <li className="min-w-0 shrink-0 basis-[38%] snap-start sm:basis-[30%] lg:basis-[38%] xl:basis-[30%]">
              <button type="button" onClick={() => setInstallmentOpen(true)} className="flex h-full w-full flex-col justify-center gap-1 rounded-chip border border-accent-line bg-accent-soft px-2 py-1.5 text-left text-accent-text transition-transform duration-150 ease-out-ui active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none motion-reduce:active:scale-100">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span className="text-[12px] font-extrabold leading-tight">Como isso afeta a parcela</span>
                <span className="text-[10px] text-ink-2">texto para WhatsApp</span>
              </button>
            </li>
          ) : null}
        </ul>
      )}
      <Detail tile={detail} open={detailOpen} onClose={() => setDetailOpen(false)} />
      <InstallmentSheet open={installmentOpen} tiles={tiles} onClose={() => setInstallmentOpen(false)} />
    </section>
  );
}
