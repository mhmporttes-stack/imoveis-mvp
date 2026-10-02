"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, CircleAlert, Megaphone, Search, Settings2, X } from "lucide-react";
import Accordion from "@/components/ui/Accordion";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { inputClasses } from "@/components/ui/Field";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import ManualText from "@/components/manual/ManualText";
import { topicIcon } from "@/components/manual/manual-icons";
import {
  SEARCH_DEBOUNCE_MS, apiErrorMessage, createDebouncer, formatUpdatedDate, resolveOpening, searchPlan,
  sectionDomId, showAckButton, showNewBadge
} from "@/lib/manual-ui-core.mjs";

// Manual do CRM (leitura). Os dados chegam já filtrados por perfil no servidor.
export default function ManualBrowser({ initialTopics = [], initialNews = [], initialError = "", manageHref = "" }) {
  const [topics] = useState(initialTopics);
  const [news, setNews] = useState(initialNews);
  const [tab, setTab] = useState("topics");
  const [topicSlug, setTopicSlug] = useState("");
  const [openIds, setOpenIds] = useState([]);
  const [highlightSlug, setHighlightSlug] = useState("");
  const [scrollId, setScrollId] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ state: "idle", results: [] });
  const [busyId, setBusyId] = useState("");
  const [notify, toastElement] = useToast();
  const searchSeq = useRef(0);

  const topic = useMemo(() => topics.find((item) => item.slug === topicSlug) || null, [topics, topicSlug]);
  const unreadNews = news.filter((item) => showAckButton(item)).length;

  const applyOpening = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const opening = resolveOpening({ hash: window.location.hash, novidade: params.get("novidade") || "", topics, news });
    if (opening.view === "news") {
      setTab("news");
      setHighlightSlug(opening.newsSlug);
      setScrollId(`novidade-${opening.newsSlug}`);
    } else if (opening.view === "topic") {
      setTab("topics");
      setTopicSlug(opening.topicSlug);
      if (opening.sectionSlug) {
        const id = sectionDomId(opening.topicSlug, opening.sectionSlug);
        setOpenIds([id]);
        setScrollId(id);
      } else {
        setOpenIds([]);
        setScrollId("manual-topo");
      }
    } else {
      setTab("topics");
      setTopicSlug("");
    }
  }, [topics, news]);

  useEffect(() => {
    applyOpening();
    window.addEventListener("hashchange", applyOpening);
    return () => window.removeEventListener("hashchange", applyOpening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scrollId) return undefined;
    const frame = requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(scrollId)?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      setScrollId("");
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollId, topicSlug, tab]);

  // Busca com debounce; respostas atrasadas são descartadas.
  const runSearch = useMemo(() => createDebouncer(async (text) => {
    const plan = searchPlan(text);
    if (!plan.run) { setSearch({ state: "idle", results: [] }); return; }
    const seq = ++searchSeq.current;
    setSearch((current) => ({ ...current, state: "loading" }));
    try {
      const response = await fetch(`/api/admin/manual/search?q=${encodeURIComponent(plan.q)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (seq !== searchSeq.current) return;
      if (!response.ok) throw new Error(apiErrorMessage(response.status, data.error));
      setSearch({ state: "done", results: Array.isArray(data.results) ? data.results : [] });
    } catch {
      if (seq === searchSeq.current) setSearch({ state: "error", results: [] });
    }
  }, SEARCH_DEBOUNCE_MS), []);
  useEffect(() => () => runSearch.cancel(), [runSearch]);

  function onQueryChange(value) {
    setQuery(value);
    if (!searchPlan(value).run) {
      searchSeq.current += 1;
      runSearch.cancel();
      setSearch({ state: "idle", results: [] });
      return;
    }
    setSearch((current) => ({ ...current, state: "loading" }));
    runSearch(value);
  }

  function openTopic(slug, sectionSlug = "") {
    setTab("topics");
    setTopicSlug(slug);
    const id = sectionSlug ? sectionDomId(slug, sectionSlug) : "";
    setOpenIds(id ? [id] : []);
    setScrollId(id || "manual-topo");
    window.history.replaceState(null, "", `/admin/manual#${slug}${sectionSlug ? `/${sectionSlug}` : ""}`);
  }

  function backToTopics() {
    setTopicSlug("");
    setOpenIds([]);
    window.history.replaceState(null, "", "/admin/manual");
    setScrollId("manual-topo");
  }

  function toggleSection(id, open) {
    setOpenIds((current) => (open ? [...current, id] : current.filter((item) => item !== id)));
  }

  async function acknowledge(item) {
    setBusyId(item.id);
    try {
      const response = await fetch(`/api/admin/manual/news/${item.id}/read`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(response.status, data.error));
      setNews((current) => current.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      notify("Leitura confirmada.");
    } catch (error) {
      notify(error.message || "Não foi possível confirmar agora.", "danger");
    } finally {
      setBusyId("");
    }
  }

  const empty = !initialError && topics.length === 0 && news.length === 0;
  const searching = query.trim().length >= 2;

  return (
    <section className="container-page space-y-6" id="manual-topo">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-1.5">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-navy [text-wrap:balance]">Manual do CRM</h1>
        <p className="text-[15px] text-ink-2">Como usar cada parte do sistema, passo a passo e sem complicação.</p>
      </div>
        {manageHref ? <Button href={manageHref} variant="secondary" size="sm"><Settings2 className="h-4 w-4" aria-hidden="true" /> Gerenciar</Button> : null}
      </header>

      {initialError ? (
        <Card>
          <EmptyState
            tone="danger"
            icon={CircleAlert}
            title="Não foi possível carregar o Manual"
            description={initialError}
            action={<Button variant="secondary" onClick={() => window.location.reload()}>Tentar de novo</Button>}
          />
        </Card>
      ) : empty ? (
        <Card><EmptyState icon={BookOpen} title="O manual ainda está sendo preparado" description="Assim que houver conteúdo publicado, ele aparece aqui." /></Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <nav aria-label="Seções do Manual" className="flex gap-1 border-b border-line">
              {[{ key: "topics", label: "Tópicos", Icon: BookOpen }, { key: "news", label: "Novidades", Icon: Megaphone }].map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={tab === key ? "page" : undefined}
                  className={cx(
                    "-mb-px inline-flex min-h-touch items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors duration-150 ease-out-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none",
                    tab === key ? "border-brand text-navy" : "border-transparent text-muted hover:text-navy"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                  {key === "news" && unreadNews > 0 ? (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-2xs font-semibold text-white" aria-label={`${unreadNews} para confirmar`}>{unreadNews}</span>
                  ) : null}
                </button>
              ))}
            </nav>
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Buscar no Manual"
                aria-label="Buscar no Manual"
                className={cx(inputClasses, "pl-9 pr-9")}
              />
              {query ? (
                <button type="button" onClick={() => onQueryChange("")} aria-label="Limpar busca" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          {searching ? (
            <SearchResults
              search={search}
              query={query}
              onOpen={(hit) => { openTopic(hit.topicSlug, hit.sectionSlug); setQuery(""); setSearch({ state: "idle", results: [] }); }}
            />
          ) : tab === "news" ? (
            <NewsList news={news} highlightSlug={highlightSlug} busyId={busyId} onAck={acknowledge} />
          ) : topic ? (
            <TopicView topic={topic} openIds={openIds} onToggle={toggleSection} onBack={backToTopics} />
          ) : (
            <TopicGrid topics={topics} onOpen={(slug) => openTopic(slug)} />
          )}
        </>
      )}
      {/* Reservado: card "Ainda ficou com alguma dúvida?" (canal em decisão do dono). Não renderiza nada. */}
      {toastElement}
    </section>
  );
}

function TopicGrid({ topics, onOpen }) {
  if (!topics.length) return <Card><EmptyState icon={BookOpen} title="Nenhum tópico publicado ainda" description="As novidades aparecem na aba ao lado." /></Card>;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {topics.map((topic) => {
        const Icon = topicIcon(topic.icon);
        return (
          <li key={topic.slug}>
            <button
              type="button"
              onClick={() => onOpen(topic.slug)}
              className="group flex h-full w-full flex-col gap-3 rounded-card border border-line bg-white p-4 text-left transition-[border-color,background-color] duration-150 ease-out-ui hover:border-info-line hover:bg-info-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.99] motion-reduce:transition-none sm:p-5"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-control bg-info-soft text-brand"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                {showNewBadge(topic) ? <Badge tone="info" dot>Novo</Badge> : null}
              </span>
              <span className="space-y-1">
                <span className="block text-base font-semibold text-navy">{topic.title}</span>
                {topic.description ? <span className="block text-sm text-ink-2">{topic.description}</span> : null}
              </span>
              <span className="mt-auto text-xs font-medium text-muted">{topic.sections.length} {topic.sections.length === 1 ? "assunto" : "assuntos"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TopicView({ topic, openIds, onToggle, onBack }) {
  const Icon = topicIcon(topic.icon);
  const items = topic.sections.map((section) => {
    const updated = formatUpdatedDate(section.last_updated_at);
    return {
      id: sectionDomId(topic.slug, section.slug),
      title: section.title,
      badge: showNewBadge(section) ? <Badge tone="info" dot>Novo</Badge> : null,
      children: (
        <div className="space-y-4">
          <ManualText body={section.body} />
          {updated ? <p className="text-xs text-muted">Última atualização: {updated}</p> : null}
        </div>
      )
    };
  });
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar aos tópicos</Button>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-info-soft text-brand"><Icon className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id={sectionDomId(topic.slug, "")} className="scroll-mt-24 text-xl font-semibold text-navy">{topic.title}</h2>
          {topic.description ? <p className="text-sm text-ink-2">{topic.description}</p> : null}
        </div>
      </div>
      <Accordion items={items} openIds={openIds} onToggle={onToggle} />
    </div>
  );
}

function SearchResults({ search, query, onOpen }) {
  if (search.state === "loading" || search.state === "idle") return <SkeletonList rows={3} label="Buscando…" />;
  if (search.state === "error") return <Card><EmptyState tone="danger" icon={CircleAlert} title="A busca não respondeu" description="Tente novamente em instantes." /></Card>;
  if (!search.results.length) return <Card><EmptyState icon={Search} title="Nada encontrado" description={`Nenhum assunto combina com “${query.trim()}”. Tente outra palavra.`} /></Card>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white" aria-label="Resultados da busca">
      {search.results.map((hit) => (
        <li key={`${hit.topicSlug}/${hit.sectionSlug}`}>
          <button type="button" onClick={() => onOpen(hit)} className="flex min-h-touch w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors duration-150 ease-out-ui hover:bg-mist/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand motion-reduce:transition-none">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted">{hit.topicTitle}</span>
            <span className="text-[15px] font-semibold text-navy">{hit.title}</span>
            {hit.snippet ? <span className="line-clamp-2 text-sm text-ink-2">{hit.snippet}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function NewsList({ news, highlightSlug, busyId, onAck }) {
  if (!news.length) return <Card><EmptyState icon={Megaphone} title="Sem novidades por enquanto" description="Quando o CRM mudar, o aviso aparece aqui." /></Card>;
  return (
    <ul className="space-y-3">
      {news.map((item) => {
        const date = formatUpdatedDate(item.published_at);
        const highlighted = highlightSlug === item.slug;
        return (
          <li key={item.id} id={`novidade-${item.slug}`} className="scroll-mt-24">
            <Card className={cx("space-y-3 transition-colors duration-300", highlighted && "ring-2 ring-brand/40")}>
              <div className="flex flex-wrap items-center gap-2">
                {showNewBadge(item) ? <Badge tone="info" dot>Novo</Badge> : null}
                {item.important ? <Badge tone="warning">Importante</Badge> : null}
                {date ? <span className="text-xs text-muted">{date}</span> : null}
              </div>
              <h3 className="text-base font-semibold text-navy">{item.title}</h3>
              <ManualText body={item.body} />
              {item.requires_ack ? (
                item.read ? (
                  <p className="text-xs font-medium text-success">Leitura confirmada</p>
                ) : (
                  <Button size="sm" loading={busyId === item.id} onClick={() => onAck(item)}>Li e entendi</Button>
                )
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
