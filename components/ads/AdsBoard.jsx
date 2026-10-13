"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, ImageOff, MessageCircle } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Sheet from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";

// Área ANÚNCIOS (pedido do dono, 2026-10-13): um card por anúncio da Meta,
// baixo (≥ 4 por tela no celular), com miniatura, título, tipo
// (WhatsApp/Cadastro), situação e 4 números; o resto fica no detalhe.
// Somente leitura — nunca altera nada na Meta. Dados e julgamento vêm prontos
// do servidor (lib/meta-ads-board.js). Visual = padrão do painel (Manrope,
// componentes de components/ui): o dono reprovou a fonte de destaque e o
// visual "de carrossel" da 1ª versão — não reintroduza fonte decorativa aqui.

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" }
];

const KIND_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "cadastro", label: "Cadastro" }
];

const TONE_BADGE = { good: "success", warn: "warning", bad: "danger", neutral: "neutral" };
const TONE_LABEL = { good: "Bom", warn: "Atenção", bad: "Ruim", neutral: "Aprendendo" };
const TONE_BOX = {
  good: "border-success-line bg-success-soft",
  warn: "border-warning-line bg-warning-soft",
  bad: "border-danger-line bg-danger-soft",
  neutral: "border-line bg-mist"
};
const TONE_TITLE = { good: "text-success", warn: "text-warning", bad: "text-danger", neutral: "text-ink" };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const INT = new Intl.NumberFormat("pt-BR");
const DEC1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DEC2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isNil = (value) => value === null || value === undefined || !Number.isFinite(Number(value));
const money = (value) => (isNil(value) ? "—" : BRL.format(Number(value)));
const moneyShort = (value) => (isNil(value) ? "—" : (Number(value) >= 1000 ? BRL0 : BRL).format(Number(value)));
const num = (value) => (isNil(value) ? "—" : INT.format(Number(value)));
const pct = (value) => (isNil(value) ? "—" : `${DEC2.format(Number(value))}%`);
const freq = (value) => (isNil(value) ? "—" : `${DEC1.format(Number(value))}x`);

function statusOf(ad) {
  if (ad.status !== "active") return { tone: "neutral", label: "Pausado" };
  const tone = ad.health?.tone || "neutral";
  return { tone, label: ad.health?.label || TONE_LABEL[tone] };
}

function KindBadge({ kind }) {
  if (kind === "whatsapp") return <Badge icon={MessageCircle}>WhatsApp</Badge>;
  if (kind === "cadastro") return <Badge icon={ClipboardCheck}>Cadastro</Badge>;
  return <Badge>Outro</Badge>;
}

function StatusBadge({ ad }) {
  const { tone, label } = statusOf(ad);
  return (
    <Badge tone={TONE_BADGE[tone]} dot>
      {label}
    </Badge>
  );
}

function Thumb({ ad, className }) {
  const [failed, setFailed] = useState(false);
  const paused = ad.status !== "active";
  if (!ad.thumbnailUrl || failed) {
    return (
      <div className={cx("flex shrink-0 items-center justify-center rounded-control bg-mist ring-1 ring-line", className)} aria-hidden="true">
        {ad.thumbnailUrl ? (
          <ImageOff size={18} className="text-faint" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/assets/matheus-machado-symbol.png" alt="" className="w-1/2 opacity-30" />
        )}
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
      className={cx("shrink-0 rounded-control object-cover ring-1 ring-line", paused && "opacity-60 grayscale", className)}
    />
  );
}

// Uma célula de número: valor em cima, rótulo embaixo, mesmo tamanho em todas.
function Stat({ label, value, strong = false }) {
  return (
    <div className="min-w-0">
      <p className={cx("truncate text-sm tabular-nums leading-5", strong ? "font-bold text-navy" : "font-semibold text-ink")}>{value}</p>
      <p className="truncate text-xs leading-4 text-muted">{label}</p>
    </div>
  );
}

function AdCard({ ad, onOpen }) {
  const m = ad.metrics;
  return (
    <button
      type="button"
      onClick={() => onOpen(ad)}
      className="w-full min-w-0 rounded-card border border-line bg-white p-3 text-left transition-colors duration-150 hover:border-brand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:bg-mist"
    >
      <div className="flex items-center gap-3">
        <Thumb ad={ad} className="size-11" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-5 text-ink">{ad.name}</p>
          <div className="mt-1 flex items-center gap-1.5 overflow-hidden">
            <KindBadge kind={ad.kind} />
            <StatusBadge ad={ad} />
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-line pt-2.5">
        <Stat label="Custo/lead" value={money(m.costPerResult)} strong />
        <Stat label="Leads" value={num(m.results)} />
        <Stat label="No CRM" value={num(m.crmLeads)} />
        <Stat label="Frequência" value={freq(m.frequency)} />
      </div>
    </button>
  );
}

function SummaryBar({ summary }) {
  return (
    <div className="grid grid-cols-4 gap-2 rounded-card border border-line bg-white px-3 py-2.5">
      <Stat label="Investido" value={moneyShort(summary?.spend)} />
      <Stat label="Leads" value={num(summary?.results)} />
      <Stat label="Custo/lead" value={money(summary?.costPerResult)} />
      <Stat label="Ativos" value={num(summary?.activeCount)} />
    </div>
  );
}

function Chips({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-1.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={cx(
            "min-h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition-colors duration-150",
            value === option.key ? "border-navy bg-navy text-white" : "border-line bg-white text-ink-2 hover:border-brand/40"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AdDetail({ ad, onClose }) {
  if (!ad) return null;
  const m = ad.metrics;
  const isWhatsapp = ad.kind === "whatsapp";
  const rows = [
    ["Investido", money(m.spend)],
    [isWhatsapp ? "Custo por conversa" : "Custo por lead", money(m.costPerResult)],
    [isWhatsapp ? "Conversas iniciadas" : "Leads (Meta)", num(m.results)],
    ["Clientes no CRM", num(m.crmLeads)],
    ["Custo por cliente no CRM", money(m.crmCostPerLead)],
    ["Frequência (vezes por pessoa)", freq(m.frequency)],
    ["Alcance (pessoas)", num(m.reach)],
    ["Impressões", num(m.impressions)],
    ["Cliques no link", num(m.linkClicks ?? m.clicks)],
    ["CTR (taxa de cliques)", pct(m.ctr)],
    ["CPM (custo por mil)", money(m.cpm)],
    ["CPC (custo por clique)", money(m.cpc)]
  ];
  return (
    <Sheet open={Boolean(ad)} onClose={onClose} title={<span className="line-clamp-2">{ad.name}</span>} description={ad.campaignShort || ad.campaignName || ""}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Thumb ad={ad} className="size-16" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <KindBadge kind={ad.kind} />
              <StatusBadge ad={ad} />
            </div>
            <p className="text-xs text-muted">{[ad.statusLabel, ad.periodLabel].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        {ad.recommendations?.length ? (
          <section aria-label="Recomendações" className="space-y-2">
            {ad.recommendations.map((rec, index) => (
              <div key={index} className={cx("rounded-control border px-3 py-2.5", TONE_BOX[rec.tone] || TONE_BOX.neutral)}>
                <p className={cx("text-sm font-semibold", TONE_TITLE[rec.tone] || TONE_TITLE.neutral)}>{rec.title}</p>
                {rec.detail ? <p className="mt-0.5 text-sm text-ink-2">{rec.detail}</p> : null}
              </div>
            ))}
          </section>
        ) : null}

        <section aria-label="Números do anúncio">
          <dl className="divide-y divide-line rounded-control border border-line">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="min-w-0 text-sm text-ink-2">{label}</dt>
                <dd className="shrink-0 text-sm font-semibold tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 space-y-0.5 text-xs text-muted">
            {ad.campaignName ? <p className="break-words">Campanha: {ad.campaignName}</p> : null}
            {ad.adsetName ? <p className="break-words">Conjunto: {ad.adsetName}</p> : null}
            <p>Dados da Meta. Somente leitura: nada é alterado no anúncio por aqui.</p>
          </div>
        </section>
      </div>
    </Sheet>
  );
}

export default function AdsBoard({ initialData = null, initialError = "", initialPeriod = "7d" }) {
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
    <div className="min-h-[calc(100dvh-4rem)] bg-mist pb-16 text-ink">
      <div className="container-page space-y-3 pt-3 md:pt-6">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight text-navy md:text-2xl">Anúncios</h1>
            <p className="truncate text-xs text-muted">{data?.syncedAtLabel ? `Meta Ads · atualizado ${data.syncedAtLabel}` : "Meta Ads"}</p>
          </div>
          <Chips options={PERIODS} value={period} onChange={setPeriod} label="Período" />
        </header>

        <SummaryBar summary={data?.summary} />

        <div className="flex items-center justify-between gap-2">
          <Chips options={KIND_FILTERS} value={kind} onChange={setKind} label="Tipo de anúncio" />
          <button
            type="button"
            aria-pressed={onlyActive}
            onClick={() => setOnlyActive((value) => !value)}
            className={cx(
              "min-h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition-colors duration-150",
              onlyActive ? "border-navy bg-navy text-white" : "border-line bg-white text-ink-2 hover:border-brand/40"
            )}
          >
            Só ativos
          </button>
        </div>

        {error ? <p role="alert" className="rounded-control border border-danger-line bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">{error}</p> : null}

        {loading && !data ? (
          <div role="status" className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-[118px] animate-pulse rounded-card border border-line bg-white" />
            ))}
            <span className="sr-only">Carregando anúncios</span>
          </div>
        ) : ads.length ? (
          <div className={cx("grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3", loading && "opacity-60")}>
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} onOpen={setSelected} />
            ))}
          </div>
        ) : (
          <p className="rounded-card border border-line bg-white px-4 py-8 text-center text-sm text-muted">
            {data?.configured === false ? "A integração com a Meta Ads não está configurada." : `Nenhum anúncio ${onlyActive ? "ativo " : ""}neste filtro.`}
          </p>
        )}
      </div>
      <AdDetail ad={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
