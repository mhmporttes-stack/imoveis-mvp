"use client";

import { useEffect, useMemo, useState } from "react";

// Cena de busca do Henry (pedido do dono, 2026-10-22: "quando ele procurar arquivos ou informações no CRM, a tela atrás
// dele deve mostrar dados um pouco transparentes; quando falar de um corretor, vem uma cena como se ele buscasse o
// corretor e, quando encontra, aparece um cardzinho com a foto do corretor conectado a ele").
//   HenryDataScene  — camadas TRANSPARENTES (~12%) de "painel do CRM" passando atrás do anel: números, linhas de lista,
//                     mini gráficos e etapas do funil, conforme o assunto do evento de progresso. Dados FICTÍCIOS gerados
//                     aqui (nenhum dado real, nenhum nome de cliente). Some com fade quando ele começa a responder.
//   HenryBrokerCards — "scanner" entre cards desfocados enquanto procura; achou → card com a FOTO (photo_url do painel),
//                     o primeiro nome e 1–2 números, ligado ao anel por uma linha de luz animada. Até 3 cards.
//   HenryDetailPanel — o detalhe completo da resposta (relatório/corretor/cliente) em lista, na tela (a voz só resume).
// Paleta do Henry: navy #07111F, ciano #4FC3E0, dourado suave #F3DCA6. CSS puro (sem biblioteca), pausa com a aba oculta,
// prefers-reduced-motion = parado.

const ACCENT = "#4FC3E0";
const GOLD = "#F3DCA6";

const CSS = `
@keyframes henry-data-rise { from { transform: translateY(0); } to { transform: translateY(-50%); } }
@keyframes henry-data-drift { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-14px, 8px); } }
@keyframes henry-scan { 0% { left: -12%; } 100% { left: 100%; } }
@keyframes henry-flow { to { stroke-dashoffset: -40; } }
@keyframes henry-card-in { from { opacity: 0; transform: translateX(-12px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes henry-card-in-up { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes henry-spin { to { transform: rotate(360deg); } }
.henry-data-col { animation: henry-data-rise linear infinite; }
.henry-data-chart { animation: henry-data-drift ease-in-out infinite; }
.henry-scan-beam { animation: henry-scan 1.6s ease-in-out infinite alternate; }
.henry-flow { animation: henry-flow 1.2s linear infinite; }
.henry-card { animation: henry-card-in 420ms cubic-bezier(.2,.8,.2,1) both; }
.henry-card-up { animation: henry-card-in-up 420ms cubic-bezier(.2,.8,.2,1) both; }
.henry-spin { animation: henry-spin 2.4s linear infinite; }
.henry-paused .henry-data-col, .henry-paused .henry-data-chart, .henry-paused .henry-scan-beam, .henry-paused .henry-flow, .henry-paused .henry-spin { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .henry-data-col, .henry-data-chart, .henry-scan-beam, .henry-flow, .henry-spin { animation: none !important; }
  .henry-card, .henry-card-up { animation: none !important; }
}
`;

export function HenrySceneStyles() {
  return <style>{CSS}</style>;
}

// Aba oculta → animações pausadas (economia de CPU/bateria).
export function useTabHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return hidden;
}

// Gerador determinístico (mesmo assunto = mesma "tela"), só para números de enfeite.
function seeded(seed) {
  let value = seed % 2147483647 || 1;
  return () => {
    value = (value * 48271) % 2147483647;
    return value / 2147483647;
  };
}

const STAGES = ["Prospecção", "Atendimento", "Simulação", "Documentação", "Aprovação", "Aprovados", "Reunião", "Venda"];
const STATUS = ["Em atendimento", "Simulação enviada", "Aguardando documentação", "Aguardando aprovação", "Tentando contato"];
const TOPIC_SEED = { geral: 11, relatorio: 23, funil: 37, ranking: 41, clientes: 53, corretor: 67, meta: 79, whatsapp: 97, internet: 101 };
const SITES = ["noticias", "clima", "portal", "guia", "mapa", "jornal", "consulta", "agenda"];

// Linhas de "painel" por assunto (fictícias: contagens, barras e rótulos genéricos; nenhum nome real).
function linesFor(topic, column, random) {
  const lines = [];
  for (let index = 0; index < 16; index += 1) {
    const n = Math.round(random() * 180) + 2;
    const pct = Math.round(random() * 100);
    const bar = "▮".repeat(1 + Math.round(random() * 7)) + "▯".repeat(Math.round(random() * 3));
    const kind = topic === "relatorio" || topic === "geral" ? ["funil", "ranking", "clientes", "meta"][(index + column) % 4] : topic;
    if (kind === "funil") lines.push({ text: `${STAGES[(index + column) % STAGES.length]}`, value: String(n), bar: pct });
    else if (kind === "ranking" || kind === "corretor") lines.push({ text: `${(index % 9) + 1}º  ●●●●`, value: `${n * 2} pts`, bar: pct });
    else if (kind === "clientes") lines.push({ text: `Cliente ••••  ${STATUS[(index + column) % STATUS.length]}`, value: `${Math.round(random() * 12)}d`, bar: null });
    else if (kind === "meta") lines.push({ text: `Meta ${bar}`, value: `${pct}%`, bar: null });
    else if (kind === "internet") lines.push({ text: `▤  www.${SITES[(index + column) % SITES.length]}••••.com.br`, value: `${Math.round(random() * 9) + 1} min`, bar: pct });
    else if (kind === "whatsapp") lines.push({ text: `Número ${(index % 2) + 1}  ●  ${random() > 0.2 ? "conectado" : "reconectando"}`, value: "", bar: null });
    else lines.push({ text: `Registro ${1000 + Math.round(random() * 8999)}`, value: String(n), bar: pct });
  }
  return lines;
}

function sparkPoints(random, width = 120, height = 36) {
  return Array.from({ length: 9 }, (_, index) => `${Math.round((index / 8) * width)},${Math.round(height - 4 - random() * (height - 8))}`).join(" ");
}

export function HenryDataScene({ active = false, topic = "geral", mobile = false }) {
  const hidden = useTabHidden();
  const columns = mobile ? 3 : 5;
  const data = useMemo(() => {
    const random = seeded(TOPIC_SEED[topic] || 7);
    return {
      columns: Array.from({ length: columns }, (_, column) => ({ lines: linesFor(topic, column, random), speed: 26 + Math.round(random() * 18), offset: Math.round(random() * 10) })),
      charts: Array.from({ length: mobile ? 2 : 4 }, () => ({ points: sparkPoints(random), bars: Array.from({ length: 6 }, () => 6 + Math.round(random() * 26)), x: Math.round(random() * 80) + 5, y: Math.round(random() * 70) + 10, speed: 7 + Math.round(random() * 6) }))
    };
  }, [topic, columns, mobile]);
  return (
    <div
      aria-hidden="true"
      data-henry-data-scene={active ? topic : "off"}
      className={`pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-700 ease-out motion-reduce:transition-none ${hidden ? "henry-paused" : ""}`}
      style={{ opacity: active ? 1 : 0, maskImage: "radial-gradient(ellipse 62% 70% at 50% 48%, transparent 0%, transparent 22%, #000 48%, #000 66%, transparent 92%)", WebkitMaskImage: "radial-gradient(ellipse 62% 70% at 50% 48%, transparent 0%, transparent 22%, #000 48%, #000 66%, transparent 92%)" }}
    >
      <div className="absolute inset-0 flex justify-between gap-6 px-6 font-mono text-[11px] leading-[22px] md:px-10 md:text-[12px]" style={{ opacity: 0.1, color: "#CFE9F3" }}>
        {data.columns.map((column, index) => (
          <div key={index} className="relative h-full w-full overflow-hidden" style={{ marginTop: `${column.offset}vh` }}>
            <div className="henry-data-col" style={{ animationDuration: `${column.speed}s` }}>
              {[...column.lines, ...column.lines].map((line, lineIndex) => (
                <div key={lineIndex} className="flex items-center gap-2 whitespace-nowrap">
                  <span className="truncate">{line.text}</span>
                  {line.bar != null ? <span className="inline-block h-[5px] rounded-full" style={{ width: `${Math.max(8, line.bar * 0.5)}px`, background: lineIndex % 3 ? ACCENT : GOLD }} /> : null}
                  <span className="ml-auto tabular-nums" style={{ color: lineIndex % 4 ? undefined : GOLD }}>{line.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {data.charts.map((chart, index) => (
        <svg
          key={index}
          viewBox="0 0 120 36"
          className="henry-data-chart absolute h-12 w-32 md:h-14 md:w-40"
          style={{ left: `${chart.x}%`, top: `${chart.y}%`, opacity: 0.12, animationDuration: `${chart.speed}s` }}
        >
          {index % 2 ? (
            chart.bars.map((height, barIndex) => <rect key={barIndex} x={barIndex * 20 + 2} y={36 - height} width="12" height={height} rx="2" fill={barIndex === 5 ? GOLD : ACCENT} />)
          ) : (
            <polyline points={chart.points} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )}
        </svg>
      ))}
    </div>
  );
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function BrokerAvatar({ broker, size = 44 }) {
  const [failed, setFailed] = useState(false);
  if (broker.photoUrl && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={broker.photoUrl} alt="" width={size} height={size} onError={() => setFailed(true)} className="shrink-0 rounded-full object-cover ring-2" style={{ width: size, height: size, "--tw-ring-color": ACCENT }} draggable={false} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full text-base font-bold ring-2" style={{ width: size, height: size, background: "#0F2A47", color: GOLD, "--tw-ring-color": ACCENT }}>
      {initialOf(broker.firstName)}
    </span>
  );
}

function BrokerCard({ broker, mobile }) {
  return (
    <div
      className={`${mobile ? "henry-card-up w-[104px] flex-col text-center" : "henry-card w-[210px]"} flex items-center gap-3 rounded-2xl px-3 py-2.5 backdrop-blur-md`}
      style={{ background: "rgba(10, 28, 50, 0.78)", boxShadow: `0 0 0 1px rgba(79,195,224,0.35), 0 10px 30px rgba(0,0,0,0.35), 0 0 24px rgba(79,195,224,0.18)` }}
      data-henry-broker-card={broker.id}
    >
      <BrokerAvatar broker={broker} size={mobile ? 40 : 44} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-white">{broker.firstName}</p>
        {broker.stats?.length ? (
          <p className={`mt-0.5 flex ${mobile ? "flex-col" : "flex-wrap gap-x-2"} text-[11px] text-white/70`}>
            {broker.stats.map((stat) => (
              <span key={stat.label}>
                <span className="font-bold tabular-nums" style={{ color: GOLD }}>{stat.value}</span> {stat.label}
              </span>
            ))}
          </p>
        ) : (
          <p className="mt-0.5 text-[11px]" style={{ color: ACCENT }}>{broker.found ? "encontrado" : "procurando…"}</p>
        )}
      </div>
    </div>
  );
}

// "Scanner": cards desfocados passando e um feixe de luz varrendo, enquanto ele procura o corretor.
function BrokerScanner({ mobile }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl ${mobile ? "h-[86px] w-[260px]" : "h-[92px] w-[230px]"}`} style={{ background: "rgba(10, 28, 50, 0.35)", boxShadow: "0 0 0 1px rgba(79,195,224,0.18)" }} data-henry-broker-scanner>
      <div className="flex h-full items-center gap-3 px-3" style={{ filter: "blur(3px)", opacity: 0.55 }}>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex w-12 shrink-0 flex-col items-center gap-1.5">
            <span className="h-9 w-9 rounded-full" style={{ background: index % 2 ? "#1B3B5E" : "#24507A" }} />
            <span className="h-1.5 w-10 rounded-full bg-white/30" />
            <span className="h-1.5 w-7 rounded-full bg-white/20" />
          </div>
        ))}
      </div>
      <span className="henry-scan-beam absolute top-0 h-full w-[12%]" style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}AA, transparent)`, boxShadow: `0 0 18px ${ACCENT}` }} />
    </div>
  );
}

// Cards ao lado do anel (computador) ou logo abaixo (celular), ligados a ele por linhas de luz.
export function HenryBrokerCards({ brokers = [], orbSize = 400, mobile = false }) {
  const hidden = useTabHidden();
  const list = brokers.slice(-3);
  if (!list.length) return null;
  const searching = list.some((broker) => !broker.found);
  const found = list.filter((broker) => broker.found);
  if (mobile) {
    const top = Math.round(orbSize * 0.86);
    return (
      <div className={`pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center ${hidden ? "henry-paused" : ""}`} style={{ top }} data-henry-brokers>
        <svg width="240" height="28" viewBox="0 0 240 28" className="overflow-visible" aria-hidden="true">
          {(found.length ? found : [null]).map((_, index, all) => {
            const x = all.length === 1 ? 120 : 120 + (index - (all.length - 1) / 2) * 112;
            return <path key={index} d={`M120 0 C120 14 ${x} 10 ${x} 28`} fill="none" stroke={ACCENT} strokeWidth="1.5" strokeDasharray="6 6" className="henry-flow" opacity="0.85" />;
          })}
        </svg>
        <div className="flex gap-2">
          {found.map((broker) => <BrokerCard key={broker.id} broker={broker} mobile />)}
          {searching && !found.length ? <BrokerScanner mobile /> : null}
        </div>
      </div>
    );
  }
  const cardHeight = 80;
  const gap = 12;
  const items = [...found.map((broker) => ({ kind: "card", broker })), ...(searching ? [{ kind: "scanner" }] : [])];
  const total = items.reduce((sum, item) => sum + (item.kind === "card" ? cardHeight : 92), 0) + gap * Math.max(0, items.length - 1);
  const left = Math.round(orbSize * 0.82);
  const centerY = orbSize / 2;
  let cursor = centerY - total / 2;
  const placed = items.map((item) => {
    const height = item.kind === "card" ? cardHeight : 92;
    const y = cursor;
    cursor += height + gap;
    return { ...item, y, mid: y + height / 2 };
  });
  return (
    <div className={`pointer-events-none absolute top-0 ${hidden ? "henry-paused" : ""}`} style={{ left, width: 320, height: orbSize }} data-henry-brokers>
      <svg className="absolute left-0 top-0 overflow-visible" width="90" height={orbSize} aria-hidden="true">
        <defs>
          <linearGradient id="henry-link" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.2" />
            <stop offset="70%" stopColor={ACCENT} stopOpacity="0.95" />
            <stop offset="100%" stopColor={GOLD} stopOpacity="0.95" />
          </linearGradient>
        </defs>
        {placed.map((item, index) => (
          <g key={index}>
            <path d={`M0 ${centerY} C40 ${centerY} 44 ${item.mid} 86 ${item.mid}`} fill="none" stroke="url(#henry-link)" strokeWidth="1.6" opacity="0.5" />
            <path d={`M0 ${centerY} C40 ${centerY} 44 ${item.mid} 86 ${item.mid}`} fill="none" stroke={GOLD} strokeWidth="2" strokeDasharray="4 16" strokeLinecap="round" className="henry-flow" />
            <circle cx="86" cy={item.mid} r="3" fill={GOLD} />
          </g>
        ))}
      </svg>
      {placed.map((item) => (
        <div key={item.kind === "card" ? item.broker.id : "scanner"} className="absolute" style={{ left: 90, top: item.y }}>
          {item.kind === "card" ? <BrokerCard broker={item.broker} /> : <BrokerScanner />}
        </div>
      ))}
    </div>
  );
}

// Detalhe da resposta na tela (relatório, corretor, cliente): título, período e seções com linhas rótulo/valor/nota.
export function HenryDetailPanel({ detail, mobile = false }) {
  if (!detail?.sections?.length) return null;
  return (
    <section
      className={`${mobile ? "w-full" : "absolute left-6 top-24 w-[min(380px,30vw)] max-h-[calc(100vh-9rem)] overflow-y-auto md:left-8"} rounded-2xl p-4 text-left`}
      style={{ background: "rgba(10, 28, 50, 0.72)", boxShadow: "0 0 0 1px rgba(79,195,224,0.22)", userSelect: "text", WebkitUserSelect: "text" }}
      aria-label={detail.title}
      data-henry-detail
    >
      <p className="text-[13px] font-bold text-white">{detail.title}</p>
      {detail.subtitle ? <p className="text-[11px] text-white/55">{detail.subtitle}</p> : null}
      <div className="mt-3 space-y-3">
        {detail.sections.map((section, index) => (
          <div key={`${section.title}-${index}`}>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: ACCENT }}>{section.title}</p>
            <ul className="space-y-0.5">
              {(section.rows || []).map((row, rowIndex) => (
                <li key={rowIndex} className="flex items-baseline gap-2 text-[12px] leading-snug text-white/85">
                  {row.href && /^https:\/\//.test(row.href) ? (
                    <a href={row.href} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate underline decoration-white/30 underline-offset-2 hover:text-white">
                      {row.label}
                    </a>
                  ) : (
                    <span className={`min-w-0 flex-1 ${row.value ? "truncate" : ""}`}>{row.label}</span>
                  )}
                  <span className="font-bold tabular-nums text-white">{row.value}</span>
                  {row.note ? <span className="text-[11px] text-white/50">{row.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// Ícone pequeno: algo sutil — arco tracejado girando enquanto busca e, quando achou um corretor, a fotinho no canto.
export function HenryIconSearchHint({ searching = false, broker = null, size = 56 }) {
  if (!searching && !broker) return null;
  return (
    <>
      {searching ? (
        <span aria-hidden="true" className="henry-spin pointer-events-none absolute rounded-full" style={{ border: `2px dashed ${ACCENT}`, opacity: 0.8, left: -5, top: -5, width: size + 10, height: size + 10 }} />
      ) : null}
      {broker ? (
        <span className="pointer-events-none absolute -left-1 -top-1" aria-hidden="true">
          <BrokerAvatar broker={broker} size={22} />
        </span>
      ) : null}
    </>
  );
}
