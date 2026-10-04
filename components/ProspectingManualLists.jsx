"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, Printer } from "lucide-react";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { MANUAL_LIST_SIZE, contactCountLabel, formatDateTimeSaoPaulo } from "@/lib/prospecting-manual-list-core.mjs";

// "Imprimir lista" (2026-10-04): reserva até 30 contatos da Base da Imobiliária para prospecção MANUAL (papel)
// de um corretor/associado e baixa o PDF A4. Só admin e gestor veem esta seção (a trava real está nas rotas
// /api/prospecting/manual-lists). Reimprimir/visualizar nunca escolhe contatos novos: usa a lista gravada.
// Telefones são dado pessoal: nada vai para URL pública; o PDF só vem de rota autenticada (sem cache).

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function downloadListPdf(listId) {
  const response = await fetch(`/api/prospecting/manual-lists/${listId}/pdf`, { cache: "no-store" });
  if (!response.ok) throw new Error((await readJson(response)).error || "Não foi possível baixar o PDF.");
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "lista-prospeccao.pdf";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

export default function ProspectingManualLists() {
  const [confirmAction, confirmElement] = useConfirm();
  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [brokerId, setBrokerId] = useState("");
  const [filterBrokerId, setFilterBrokerId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [created, setCreated] = useState(null);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [viewing, setViewing] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const generatingRef = useRef(false);

  const load = useCallback(async (filter, offset = 0) => {
    const query = new URLSearchParams();
    if (filter) query.set("brokerId", filter);
    if (offset) query.set("offset", String(offset));
    const response = await fetch(`/api/prospecting/manual-lists?${query.toString()}`, { cache: "no-store" });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || "Não foi possível carregar as listas.");
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    setLoadError("");
    load(filterBrokerId).then((data) => { if (active) setOverview(data); }).catch((error) => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [filterBrokerId, load]);

  const enabled = overview?.enabled !== false;
  const brokers = overview?.brokers || [];
  const selectedBroker = brokers.find((broker) => broker.id === brokerId);

  async function generate() {
    if (!selectedBroker || generatingRef.current) return;
    const ok = await confirmAction({
      title: `Imprimir lista para ${selectedBroker.name}?`,
      description: `Isto vai reservar ${MANUAL_LIST_SIZE} contatos para ${selectedBroker.name}. Eles não serão entregues a mais ninguém. Continuar?`,
      confirmLabel: "Reservar e gerar PDF"
    });
    if (!ok || generatingRef.current) return;
    // Uma chave por confirmação: clique repetido/reenvio devolve a MESMA lista, nunca outra.
    const requestKey = crypto.randomUUID();
    generatingRef.current = true;
    setGenerating(true);
    setActionError("");
    setCreated(null);
    try {
      const response = await fetch("/api/prospecting/manual-lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brokerId: selectedBroker.id, requestKey }) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível criar a lista.");
      setCreated({ ...data, brokerName: selectedBroker.name });
      setOverview(await load(filterBrokerId));
      try { await downloadListPdf(data.listId); } catch (error) { setActionError(`${error.message} A lista já foi criada: use "Baixar PDF".`); }
    } catch (error) {
      setActionError(error.message);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  async function reprint(list) {
    setBusyId(`pdf:${list.id}`);
    setActionError("");
    try { await downloadListPdf(list.id); } catch (error) { setActionError(error.message); } finally { setBusyId(""); }
  }

  async function view(list) {
    setBusyId(`view:${list.id}`);
    setActionError("");
    try {
      const response = await fetch(`/api/prospecting/manual-lists/${list.id}`, { cache: "no-store" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível abrir a lista.");
      setViewing(data);
    } catch (error) { setActionError(error.message); } finally { setBusyId(""); }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const data = await load(filterBrokerId, overview.lists.length);
      setOverview((current) => ({ ...current, lists: [...current.lists, ...data.lists], hasMore: data.hasMore }));
    } catch (error) { setActionError(error.message); } finally { setLoadingMore(false); }
  }

  return (
    <section aria-labelledby="manual-lists-title" className="rounded-card border border-line bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-info-soft text-info"><Printer className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h3 id="manual-lists-title" className="text-base font-semibold text-navy">Lista para imprimir</h3>
          <p className="mt-0.5 text-sm text-ink-2">Reserva {MANUAL_LIST_SIZE} contatos da Base da Imobiliária para um corretor ou associado ligar à mão. Os contatos reservados saem da fila de todo mundo.</p>
        </div>
      </div>

      {loadError ? <p role="alert" className="mt-4 rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{loadError}</p> : null}
      {!overview && !loadError ? <p className="mt-4 text-sm font-semibold text-muted">Carregando…</p> : null}

      {overview ? (
        <>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-semibold text-navy">
              Corretor ou associado
              <select className="mt-1.5 h-11 w-full rounded-control border border-line bg-white px-3 text-base font-medium text-ink outline-none focus:border-brand sm:text-sm" value={brokerId} onChange={(event) => setBrokerId(event.target.value)} disabled={generating}>
                <option value="">Selecione…</option>
                {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}{broker.role === "associate" ? " (associado)" : ""}</option>)}
              </select>
            </label>
            <Button onClick={generate} disabled={!enabled || !brokerId || generating} loading={generating} className="sm:w-auto">
              <Printer className="h-4 w-4" aria-hidden="true" />{generating ? "Gerando…" : "Imprimir lista"}
            </Button>
          </div>
          {!enabled ? <p role="status" className="mt-3 text-sm font-semibold text-navy">{overview.message || "Recurso ainda não ativado no banco."}</p> : null}
          {actionError ? <p role="alert" className="mt-3 rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{actionError}</p> : null}

          {created ? (
            <div role="status" className="mt-4 flex flex-col gap-3 rounded-control border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-emerald-900">
                <p className="font-semibold">{created.already ? `A lista nº ${created.numero} já tinha sido criada` : `Lista nº ${created.numero} criada com ${created.contactCount} ${created.contactCount === 1 ? "contato" : "contatos"}`} para {created.brokerName}.</p>
                {created.contactCount < MANUAL_LIST_SIZE ? <p className="mt-0.5">Havia só {created.contactCount} {created.contactCount === 1 ? "contato elegível" : "contatos elegíveis"} agora; a lista saiu com {created.contactCount === 1 ? "ele" : "eles"}.</p> : null}
              </div>
              <Button variant="secondary" onClick={() => reprint({ id: created.listId })} disabled={busyId === `pdf:${created.listId}`}><Download className="h-4 w-4" aria-hidden="true" />Baixar PDF</Button>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-sm font-semibold text-navy">Histórico de listas</h4>
            <label className="text-sm text-ink-2">
              <span className="sr-only">Filtrar por corretor ou associado</span>
              <select className="h-10 w-full rounded-control border border-line bg-white px-3 text-base font-medium text-ink outline-none focus:border-brand sm:w-64 sm:text-sm" value={filterBrokerId} onChange={(event) => setFilterBrokerId(event.target.value)}>
                <option value="">Todos os associados</option>
                {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}
              </select>
            </label>
          </div>

          {overview.lists?.length ? (
            <ul className="mt-3 divide-y divide-line rounded-control border border-line">
              {overview.lists.map((list) => (
                <li key={list.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-navy"><FileText className="h-4 w-4 text-brand" aria-hidden="true" />Lista nº {list.numero}<span className="font-medium text-ink-2">· {list.brokerName || "—"}</span></p>
                    <p className="mt-0.5 text-sm text-ink-2">{formatDateTimeSaoPaulo(list.createdAt)} · {contactCountLabel(list.contactCount)}{list.generatedByName ? ` · gerada por ${list.generatedByName}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" size="sm" onClick={() => view(list)} disabled={busyId === `view:${list.id}`}><Eye className="h-4 w-4" aria-hidden="true" />Visualizar</Button>
                    <Button variant="secondary" size="sm" onClick={() => reprint(list)} disabled={busyId === `pdf:${list.id}`}><Printer className="h-4 w-4" aria-hidden="true" />Reimprimir</Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-control bg-mist px-3 py-3 text-sm text-ink-2">{enabled ? "Nenhuma lista gerada ainda." : "O histórico aparece aqui quando o recurso for ativado."}</p>
          )}
          {overview.hasMore ? <div className="mt-3 text-center"><Button variant="secondary" size="sm" onClick={loadMore} loading={loadingMore}>Ver mais listas</Button></div> : null}
        </>
      ) : null}

      <Sheet open={Boolean(viewing)} onClose={() => setViewing(null)} title={viewing ? `Lista nº ${viewing.list.numero}` : ""} description={viewing ? `${viewing.list.brokerName} · ${formatDateTimeSaoPaulo(viewing.list.createdAt)} · ${contactCountLabel(viewing.list.contactCount)}` : ""} footer={viewing ? <Button variant="secondary" block onClick={() => reprint(viewing.list)}><Printer className="h-4 w-4" aria-hidden="true" />Reimprimir PDF</Button> : null}>
        {viewing ? (
          <ol className="divide-y divide-line text-sm">
            {viewing.items.map((item) => (
              <li key={item.position} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0"><span className="mr-2 font-semibold text-muted">{String(item.position).padStart(2, "0")}.</span><span className="text-ink">{item.name}</span></span>
                <span className="shrink-0 font-semibold tabular-nums text-navy">{item.phoneFormatted}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </Sheet>
      {confirmElement}
    </section>
  );
}
