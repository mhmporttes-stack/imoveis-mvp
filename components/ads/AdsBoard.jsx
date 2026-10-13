"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, ImageOff, MessageCircle, RefreshCw } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";
import { anton } from "./ads-fonts";

// Área ANÚNCIOS (pedido do dono, 2026-10-13): cada anúncio da Meta vira um
// card baixo (≥ 4 por tela no celular) com miniatura, título, tipo
// (WhatsApp/Cadastro), custo por resultado e status; o resto fica no detalhe.
// Somente leitura — nunca altera nada na Meta. Dados e regras de
// recomendação vêm prontos do servidor (lib/meta-ads-board.js).
// Aparência escolhida pelo dono (2026-10-13, versão B): painel claro, cards
// com o DNA dos carrosséis (número em Anton, rótulos espaçados, azul da marca).

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" }
];

const KIND_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "cadastro", label: "Cadastro" },
  { key: "outro", label: "Outro" }
];

const THEMES = {
  claro: {
    page: "bg-mist text-ink",
    eyebrow: "text-brand",
    title: "text-navy",
    sub: "text-muted",
    chip: "border-line bg-white text-ink-2 hover:border-brand/40",
    chipOn: "border-navy bg-navy text-white",
    summary: "border-line bg-white",
    card: "border-line bg-white hover:border-brand/40",
    thumbRing: "ring-black/5",
    thumbEmpty: "bg-[#0A1430]",
    name: "text-navy",
    label: "text-muted",
    accent: "text-brand",
    hero: "text-navy",
    value: "text-ink",
    pill: "border-line text-ink-2",
    tone: { good: "#079455", warn: "#DC6803", bad: "#D92D20", neutral: "#98A2B3" }
  }
};

const TONE_LABEL = { good: "Bom", warn: "Atenção", bad: "Ruim", neutral: "Aprendendo" };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const INT = new Intl.NumberFormat("pt-BR");
const DEC1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DEC2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(value, compact = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return (compact && Number(value) >= 100 ? BRL0 : BRL).format(Number(value));
}
function num(value) {
  return value === null || value === undefined ? "—" : INT.format(Number(value));
}
function pct(value) {
  return value === null || value === undefined ? "—" : `${DEC2.format(Number(value))}%`;
}
function freq(value) {
  return value === null || value === undefined ? "—" : `${DEC1.format(Number(value))}×`;
}

function KindTag({ kind, className = "" }) {
  const label = kind === "whatsapp" ? "WhatsApp" : kind === "cadastro" ? "Cadastro" : "Outro";
  const Icon = kind === "whatsapp" ? MessageCircle : kind === "cadastro" ? ClipboardCheck : null;
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1", className)}>
      {Icon ? <Icon size={13} strokeWidth={1.75} aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

function StatusMark({ tone, label = null, theme, paused, className = "" }) {
  const color = paused ? theme.tone.neutral : theme.tone[tone] || theme.tone.neutral;
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 font-semibold text-ink-2", className)}>
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {paused ? "Pausado" : label || TONE_LABEL[tone] || "—"}
    </span>
  );
}

function Thumb({ ad, theme, size = "card" }) {
  const [failed, setFailed] = useState(false);
  const dims = size === "card" ? "h-20 w-14 rounded-control" : "h-[120px] w-24 rounded-card";
  const paused = ad.status !== "active";
  if (!ad.thumbnailUrl || failed) {
    return (
      <div className={cx("flex shrink-0 items-center justify-center ring-1", dims, theme.thumbEmpty, theme.thumbRing)} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {ad.thumbnailUrl ? <ImageOff size={18} className="text-white/40" /> : <img src="/assets/matheus-machado-symbol.png" alt="" className="w-1/2 opacity-40" />}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ad.thumbnailUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cx("shrink-0 object-cover ring-1", dims, theme.thumbRing, paused && "opacity-60 grayscale")}
    />
  );
}

// Card: 3 linhas numa grade fixa (título · tipo/frequência/situação · números).
// Valores numa mesma linha de base e rótulos noutra, para a leitura em coluna.
function AdCard({ ad, theme, onOpen }) {
  const tone = ad.health?.tone || "neutral";
  const paused = ad.status !== "active";
  const m = ad.metrics;
  return (
    <button
      type="button"
      onClick={() => onOpen(ad)}
      className={cx(
        "flex h-[104px] w-full items-center gap-3 overflow-hidden rounded-card border p-3 text-left transition-[transform,border-color] duration-150 ease-out-ui active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        theme.card
      )}
    >
      <Thumb ad={ad} theme={theme} />
      <span className="flex h-20 min-w-0 flex-1 flex-col justify-between">
        <span className="block min-w-0">
          <span className={cx("block truncate text-[15px] font-semibold leading-5", theme.name)}>{ad.name}</span>
          <span className={cx("flex min-w-0 items-center justify-between gap-2 text-xs leading-4", theme.label)}>
            <span className="flex min-w-0 items-center gap-1.5">
              <KindTag kind={ad.kind} />
              <span aria-hidden="true">·</span>
              <span className="truncate tabular-nums">freq. {freq(m.frequency)}</span>
            </span>
            <StatusMark label={ad.health?.label} tone={tone} theme={theme} paused={paused} />
          </span>
        </span>
        <span className="grid grid-cols-[minmax(0,1fr)_3.75rem_2.75rem_2.75rem] items-end gap-x-2">
          <span className={cx(anton.className, "block truncate text-[24px] leading-none tabular-nums", theme.hero)}>{money(m.costPerResult)}</span>
          <Metric value={money(m.spend, true)} />
          <Metric value={num(m.results)} />
          <Metric value={num(m.crmLeads)} />
          <span className={cx("mt-1 block truncate text-2xs font-semibold", theme.accent)}>por lead</span>
          <MetricLabel>investido</MetricLabel>
          <MetricLabel>leads</MetricLabel>
          <MetricLabel>no CRM</MetricLabel>
        </span>
      </span>
    </button>
  );
}

function Metric({ value }) {
  return <span className="block truncate text-right text-[13px] font-semibold leading-4 tabular-nums text-ink">{value}</span>;
}

function MetricLabel({ children }) {
  return <span className="mt-1 block truncate text-right text-2xs text-muted">{children}</span>;
}

function SummaryBar({ summary, theme }) {
  const items = [
    { label: "investido", value: money(summary?.spend, true) },
    { label: "leads", value: num(summary?.results) },
    { label: "custo por lead", value: money(summary?.costPerResult) },
    { label: "ativos", value: num(summary?.activeCount) }
  ];
  return (
    <dl className={cx("grid grid-cols-4 divide-x divide-line rounded-card border", theme.summary)}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col-reverse px-2 py-2.5 text-center sm:px-4">
          <dt className="truncate text-2xs text-muted">{item.label}</dt>
          <dd className={cx("truncate text-[15px] font-bold leading-5 tabular-nums sm:text-lg", theme.value)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ options, value, onChange, theme, label }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-1.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={cx("min-h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition-colors duration-150", value === option.key ? theme.chipOn : theme.chip)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const DETAIL_TONE_BOX = {
  good: "border-success-line bg-success-soft text-success",
  warn: "border-warning-line bg-warning-soft text-warning",
  bad: "border-danger-line bg-danger-soft text-danger",
  neutral: "border-line bg-mist text-ink-2"
};

function AdDetail({ ad, onClose }) {
  const theme = THEMES.claro;
  if (!ad) return null;
  const m = ad.metrics;
  const isWhatsapp = ad.kind === "whatsapp";
  const costLabel = isWhatsapp ? "custo por conversa" : "custo por lead";
  // [rótulo, explicação curta (opcional), valor]. O custo por resultado já é o
  // número principal do topo, por isso não se repete na lista.
  const rows = [
    ["Investido", "", money(m.spend)],
    [isWhatsapp ? "Conversas iniciadas" : "Leads", isWhatsapp ? "" : "contados pela Meta", num(m.results)],
    ["Clientes no CRM", "", m.crmLeads === null || m.crmLeads === undefined ? "Sem rastreio" : num(m.crmLeads)],
    ["Custo por cliente no CRM", "", money(m.crmCostPerLead)],
    ["Alcance", "pessoas", num(m.reach)],
    ["Impressões", "", num(m.impressions)],
    ["Frequência", "vezes por pessoa", freq(m.frequency)],
    ["Cliques no link", "", num(m.linkClicks ?? m.clicks)],
    ["CTR", "taxa de cliques", pct(m.ctr)],
    ["CPM", "custo por mil", money(m.cpm)],
    ["CPC", "custo por clique", money(m.cpc)]
  ];
  const origin = [
    ad.campaignName ? `Campanha: ${ad.campaignName}` : "",
    ad.adsetName ? `Conjunto: ${ad.adsetName}` : ""
  ].filter(Boolean);
  return (
    <Sheet
      open={Boolean(ad)}
      onClose={onClose}
      title={<span className="line-clamp-2">{ad.name}</span>}
      description={ad.campaignShort || ad.campaignName || ""}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Thumb ad={ad} theme={theme} size="detail" />
          <div className="min-w-0 flex-1">
            <p className={cx(anton.className, "truncate text-[40px] leading-none text-navy tabular-nums")}>{money(m.costPerResult)}</p>
            <p className="mt-1.5 text-xs font-semibold text-brand">{costLabel}</p>
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
              <KindTag kind={ad.kind} />
              <StatusMark label={ad.health?.label} tone={ad.health?.tone || "neutral"} theme={theme} paused={ad.status !== "active"} />
            </p>
            <p className="mt-1 text-xs text-muted">{[ad.statusLabel, ad.periodLabel].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        {ad.recommendations?.length ? (
          <section aria-label="Recomendações" className="space-y-2">
            <h3 className="text-sm font-semibold text-navy">Recomendações</h3>
            {ad.recommendations.map((rec, index) => (
              <div key={index} className={cx("rounded-control border px-3 py-2.5", DETAIL_TONE_BOX[rec.tone] || DETAIL_TONE_BOX.neutral)}>
                <p className="text-sm font-semibold">{rec.title}</p>
                {rec.detail ? <p className="mt-0.5 text-sm text-ink-2">{rec.detail}</p> : null}
              </div>
            ))}
          </section>
        ) : null}

        <section aria-label="Números do anúncio">
          <h3 className="text-sm font-semibold text-navy">Números do período</h3>
          <dl className="mt-1 divide-y divide-line">
            {rows.map(([label, hint, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="min-w-0 text-sm text-ink-2">
                  {label}
                  {hint ? <span className="ml-1.5 text-xs text-muted">{hint}</span> : null}
                </dt>
                <dd className="shrink-0 text-sm font-semibold tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
            {origin.map((line) => (
              <p key={line} className="break-words">{line}</p>
            ))}
            <p>Dados da Meta. Somente leitura: nada é alterado no anúncio por aqui.</p>
          </div>
        </section>
      </div>
    </Sheet>
  );
}

export default function AdsBoard({ initialData = null, initialError = "", initialPeriod = "7d" }) {
  const theme = THEMES.claro;
  const [period, setPeriod] = useState(initialPeriod);
  const [kind, setKind] = useState("all");
  const [onlyActive, setOnlyActive] = useState(true);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [selected, setSelected] = useState(null);
  const isFirstRender = useRef(Boolean(initialData));

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/admin/anuncios?period=${period}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os anúncios.");
        if (!cancelled) setData(payload);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const ads = useMemo(() => {
    const list = data?.ads || [];
    return list.filter((ad) => (kind === "all" || ad.kind === kind) && (!onlyActive || ad.status === "active"));
  }, [data, kind, onlyActive]);

  return (
    <div className={cx("relative min-h-[calc(100dvh-4rem)] pb-16", theme.page)}>
      <div className="container-page relative space-y-3 pt-3 md:pt-6">
        <header>
          <div className="flex items-center justify-between gap-3">
            <h1 className={cx("min-w-0 text-2xl font-extrabold leading-tight tracking-tight md:text-[28px]", theme.title)}>Anúncios</h1>
            <Chips options={PERIODS} value={period} onChange={setPeriod} theme={theme} label="Período" />
          </div>
          <p className={cx("mt-0.5 flex min-w-0 items-center gap-1 text-xs", theme.sub)}>
            <span className={cx("font-semibold", theme.eyebrow)}>Meta Ads</span>
            {data?.syncedAtLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <RefreshCw size={11} aria-hidden="true" className="shrink-0" />
                <span className="truncate">Atualizado {data.syncedAtLabel}</span>
              </>
            ) : null}
          </p>
        </header>

        <SummaryBar summary={data?.summary} theme={theme} />

        <div className="-mx-4 flex items-center gap-3 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:px-0">
          <Chips options={KIND_FILTERS} value={kind} onChange={setKind} theme={theme} label="Tipo de anúncio" />
          <span className={cx("h-5 w-px shrink-0", "bg-line")} aria-hidden="true" />
          <Chips
            options={[{ key: "active", label: "Ativos" }, { key: "all", label: "Todos" }]}
            value={onlyActive ? "active" : "all"}
            onChange={(key) => setOnlyActive(key === "active")}
            theme={theme}
            label="Situação"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">{error}</p>
        ) : null}

        {loading && !data ? (
          <div role="status" className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={cx("h-[104px] animate-pulse rounded-card border", theme.card)} />
            ))}
            <span className="sr-only">Carregando anúncios</span>
          </div>
        ) : ads.length ? (
          <div className={cx("grid gap-2 md:grid-cols-2 xl:grid-cols-3", loading && "opacity-60")}>
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} theme={theme} onOpen={setSelected} />
            ))}
          </div>
        ) : (
          <p className={cx("rounded-card border px-4 py-8 text-center text-sm", theme.summary, theme.sub)}>
            {data?.configured === false ? "A integração com a Meta Ads não está configurada." : `Nenhum anúncio ${onlyActive ? "ativo " : ""}neste filtro.`}
          </p>
        )}
      </div>
      <AdDetail ad={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
