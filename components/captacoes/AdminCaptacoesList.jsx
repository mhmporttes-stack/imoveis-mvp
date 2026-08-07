"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Filter, Home, MapPin, MessageCircle, Search, Trash2 } from "lucide-react";
import { formatDateSaoPaulo } from "@/lib/date-utils";
import {
  CAPTACAO_STATUS_OPTIONS,
  CAPTACAO_TYPE_OPTIONS,
  captacaoStatusClasses,
  formatCaptacaoMoney,
  formatCaptacaoPhone,
  formatCaptacaoStatus,
  formatCaptacaoType,
  getCaptacaoWhatsApp
} from "@/lib/captacoes-schema";

export default function AdminCaptacoesList({ captacoes = [] }) {
  const router = useRouter();
  const [items, setItems] = useState(captacoes);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState("");
  const [isDeleting, setIsDeleting] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();

    return items.filter((captacao) => {
      const haystack = [
        captacao.ownerName,
        captacao.ownerPhone,
        captacao.ownerEmail,
        captacao.neighborhood,
        captacao.city,
        captacao.street,
        formatCaptacaoType(captacao.propertyType, captacao.propertyTypeOther),
        formatCaptacaoStatus(captacao.status)
      ].join(" ").toLowerCase();

      return (!term || haystack.includes(term)) &&
        (!status || captacao.status === status) &&
        (!type || captacao.propertyType === type);
    });
  }, [items, query, status, type]);

  const statusCounts = useMemo(() => {
    return items.reduce((acc, captacao) => {
      acc[captacao.status] = (acc[captacao.status] || 0) + 1;
      return acc;
    }, {});
  }, [items]);

  async function removeCaptacao(captacao) {
    if (!confirm(`Excluir a captação de "${captacao.ownerName}"?`)) return;

    setIsDeleting(captacao.id);
    setError("");

    try {
      const response = await fetch(`/api/captacoes/${captacao.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível excluir a captação.");
      setItems((current) => current.filter((item) => item.id !== captacao.id));
      router.refresh();
    } catch (deleteError) {
      setError(deleteError.message || "Não foi possível excluir a captação.");
    } finally {
      setIsDeleting("");
    }
  }

  return (
    <section className="container-page grid gap-5">
      <div className="rounded-[28px] border border-line bg-white p-5 shadow-soft md:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_260px_220px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar captação..."
              className="min-h-14 w-full rounded-2xl border border-line bg-white pl-14 pr-4 text-base font-bold text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          </label>

          <label className="relative">
            <Filter className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" aria-hidden="true" />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="min-h-14 w-full rounded-2xl border border-line bg-white pl-14 pr-4 text-base font-black text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            >
              <option value="">Todos os status</option>
              {CAPTACAO_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({statusCounts[option.value] || 0})
                </option>
              ))}
            </select>
          </label>

          <label className="relative">
            <Home className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" aria-hidden="true" />
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="min-h-14 w-full rounded-2xl border border-line bg-white pl-14 pr-4 text-base font-black text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            >
              <option value="">Todos os tipos</option>
              {CAPTACAO_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 text-sm font-extrabold text-muted">
          <span className="rounded-full bg-[#E9F2FF] px-4 py-2 text-navy">{filtered.length} de {items.length} captações</span>
          {query || status || type ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatus("");
                setType("");
              }}
              className="rounded-full border border-line bg-white px-4 py-2 text-navy transition hover:border-brand"
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</div>
      ) : null}

      {filtered.length ? (
        <div className="grid gap-4">
          {filtered.map((captacao) => (
            <article key={captacao.id} className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${captacaoStatusClasses(captacao.status)}`}>
                      {formatCaptacaoStatus(captacao.status)}
                    </span>
                    <span className="rounded-full bg-[#E9F2FF] px-3 py-1 text-xs font-black text-navy">
                      {formatCaptacaoType(captacao.propertyType, captacao.propertyTypeOther)}
                    </span>
                    <span className="rounded-full border border-line px-3 py-1 text-xs font-bold text-muted">
                      {formatDateSaoPaulo(captacao.createdAt)}
                    </span>
                  </div>

                  <h2 className="mt-3 truncate text-2xl font-black text-navy">{captacao.ownerName}</h2>
                  <p className="mt-2 flex items-center gap-2 text-sm font-bold text-muted">
                    <MapPin className="h-4 w-4 text-brand" aria-hidden="true" />
                    {[captacao.neighborhood, captacao.city, captacao.state].filter(Boolean).join(" · ") || "Localização a confirmar"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold text-muted">
                    <span>WhatsApp: {formatCaptacaoPhone(captacao.ownerPhone)}</span>
                    {captacao.intendedPrice ? <span>Valor: {formatCaptacaoMoney(captacao.intendedPrice)}</span> : null}
                    {captacao.requestsEvaluation ? <span>Solicitou avaliação</span> : null}
                    {captacao.photos?.length ? <span>{captacao.photos.length} foto(s)</span> : null}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[440px]">
                  <Link className="premium-button-secondary justify-center" href={`/admin/captacoes/${captacao.id}`}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Abrir
                  </Link>
                  {getCaptacaoWhatsApp(captacao.ownerPhone) ? (
                    <a
                      className="premium-button-secondary justify-center"
                      href={getCaptacaoWhatsApp(captacao.ownerPhone)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      WhatsApp
                    </a>
                  ) : (
                    <span className="premium-button-secondary justify-center opacity-50">Sem WhatsApp</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeCaptacao(captacao)}
                    disabled={isDeleting === captacao.id}
                    className="premium-button-secondary justify-center text-red-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Excluir
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-[28px] border border-line bg-white p-12 text-center shadow-soft">
          <h2 className="text-2xl font-black text-navy">Nenhuma captação encontrada</h2>
          <p className="mt-3 text-muted">Quando um proprietário enviar um imóvel, ele aparecerá aqui.</p>
        </div>
      )}
    </section>
  );
}
