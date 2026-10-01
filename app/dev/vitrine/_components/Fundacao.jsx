"use client";

import { useState } from "react";
import { CalendarDays, Inbox, MessageCircle, Plus, Search, TriangleAlert } from "lucide-react";
import Badge, { CountBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field, { inputClasses } from "@/components/ui/Field";
import Sheet from "@/components/ui/Sheet";
import Skeleton, { SkeletonList } from "@/components/ui/Skeleton";
import StatusBadge from "@/components/ui/StatusBadge";

// Vitrine da Fundação do sistema visual: tokens + componentes de
// components/ui/. Dados fictícios. Serve também para o comparativo de fonte
// (?fonte=manrope|inter).
const TIPOS = [
  ["36 · herói", "text-[36px] leading-[40px] font-bold tracking-[-0.02em]", "R$ 254.000"],
  ["28 · título de página", "text-[28px] leading-[34px] font-semibold tracking-[-0.015em]", "Clientes"],
  ["22 · título de seção", "text-[22px] leading-[28px] font-semibold tracking-[-0.01em]", "Precisam de ação agora"],
  ["18 · destaque", "text-lg font-semibold", "Fernanda Ribeiro"],
  ["16 · corpo mobile", "text-base", "Prefere contato por WhatsApp à noite."],
  ["14 · corpo app", "text-sm", "Simulação enviada há 2 dias · Bruno"],
  ["13 · secundário", "text-[13px] text-ink-2", "Última interação hoje às 09:12"],
  ["12 · meta", "text-xs text-muted", "Cadastro 21/09/2026 · #C1513"],
  ["11 · micro-rótulo", "text-2xs font-semibold uppercase tracking-wide text-muted", "Próxima atividade"]
];

const STATUS_EXEMPLOS = ["automated_service", "pending", "in_service", "awaiting_return", "documentation_pending", "approval_pending", "restriction", "approved", "meeting_pending", "sale_completed", "archived", "do_not_contact"];

export default function Fundacao() {
  const [sheet, setSheet] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <main className="min-h-screen bg-mist py-8">
      <div className="container-page space-y-6">
        <header>
          <p className="text-2xs font-semibold uppercase tracking-wide text-brand">Sistema visual</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-[34px] tracking-[-0.015em] text-navy">Fundação</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">Tokens e componentes base. Identidade obrigatória: azul e branco + logo.</p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Card as="section" aria-labelledby="f-tipo">
            <h2 id="f-tipo" className="text-sm font-semibold text-ink">Tipografia e rampa de texto</h2>
            <dl className="mt-4 space-y-3">
              {TIPOS.map(([rotulo, classe, exemplo]) => (
                <div key={rotulo} className="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3">
                  <dt className="text-2xs text-faint">{rotulo}</dt>
                  <dd className={`truncate text-ink ${classe}`}>{exemplo}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 flex flex-wrap gap-4 border-t border-line pt-4 text-sm">
              <span className="text-ink">ink · primário</span>
              <span className="text-ink-2">ink-2 · secundário</span>
              <span className="text-muted">muted · terciário</span>
              <span className="text-faint">faint · desabilitado</span>
            </div>
            <p className="mt-4 text-sm tabular-nums text-ink">Números tabulares: 1.111,11 · 8.888,88 · 44 / 190 · 16,7%</p>
          </Card>

          <div className="space-y-6">
            <Card as="section" aria-labelledby="f-botoes">
              <h2 id="f-botoes" className="text-sm font-semibold text-ink">Botões</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button><MessageCircle className="h-4 w-4" aria-hidden="true" />WhatsApp</Button>
                <Button variant="secondary"><CalendarDays className="h-4 w-4" aria-hidden="true" />Agendar</Button>
                <Button variant="ghost">Ver detalhes</Button>
                <Button variant="danger">Arquivar</Button>
                <Button variant="danger-ghost">Cancelar atividade</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary">Pequeno</Button>
                <Button size="lg">Salvar cliente</Button>
                <Button loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1500); }}>{loading ? "Salvando…" : "Ação com envio"}</Button>
                <Button disabled>Desabilitado</Button>
                <Button size="icon" variant="secondary" aria-label="Novo cliente"><Plus className="h-5 w-5" aria-hidden="true" /></Button>
              </div>
            </Card>

            <Card as="section" aria-labelledby="f-selos">
              <h2 id="f-selos" className="text-sm font-semibold text-ink">Selos semânticos</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {STATUS_EXEMPLOS.map((status) => <StatusBadge key={status} status={status} />)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="warning" icon={TriangleAlert}>Sem contato há 3 dias</Badge>
                <Badge tone="danger" icon={TriangleAlert}>Atividade atrasada</Badge>
                <Badge>MCMV Faixa 2</Badge>
                <CountBadge count={4} label="4 não lidas" />
                <CountBadge count={120} tone="danger" label="120 pendências" />
              </div>
            </Card>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card as="section" aria-labelledby="f-campos" className="space-y-4">
            <h2 id="f-campos" className="text-sm font-semibold text-ink">Campos</h2>
            <Field label="Nome do cliente" required hint="Como aparece na lista.">
              <input className={inputClasses} placeholder="Ex.: Fernanda Ribeiro" />
            </Field>
            <Field label="Telefone" error="Informe DDD + número. Ex.: (14) 90000-0000">
              <input className={inputClasses} defaultValue="9000" inputMode="tel" />
            </Field>
            <Field label="Responsável">
              <select className={inputClasses} defaultValue="bruno">
                <option value="bruno">Bruno Fictício</option>
                <option value="ana">Ana Exemplo</option>
              </select>
            </Field>
          </Card>

          <Card as="section" aria-labelledby="f-estados" padding="none">
            <h2 id="f-estados" className="px-5 pt-5 text-sm font-semibold text-ink">Estados</h2>
            <EmptyState
              icon={Inbox}
              title="Nenhum cliente neste filtro"
              description="Tente outro status ou limpe a busca."
              action={<Button variant="secondary" size="sm">Limpar filtros</Button>}
            />
            <div className="border-t border-line">
              <EmptyState
                tone="danger"
                icon={TriangleAlert}
                title="Não foi possível carregar"
                description="A conexão caiu no meio do caminho. Seus dados estão seguros."
                action={<Button size="sm">Tentar de novo</Button>}
              />
            </div>
          </Card>

          <Card as="section" aria-labelledby="f-carregando" className="space-y-5">
            <h2 id="f-carregando" className="text-sm font-semibold text-ink">Carregando e sobreposição</h2>
            <SkeletonList rows={3} />
            <Skeleton className="h-20 w-full" rounded="rounded-card" />
            <Button variant="secondary" block onClick={() => setSheet(true)}>Abrir sheet / gaveta</Button>
          </Card>
        </div>

        <Card as="section" aria-labelledby="f-contexto" padding="none">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <h2 id="f-contexto" className="flex-1 text-sm font-semibold text-ink">Em contexto (amostra de linha de lista)</h2>
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Buscar cliente</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
              <input className={`${inputClasses} pl-9`} placeholder="Buscar nome ou telefone" />
            </label>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {[
              ["Fernanda Demo Ribeiro", "(14) 90000-0013", "meeting_pending", "Qui 15:00 · reunião", "Bruno"],
              ["Joana Exemplo Souza", "(14) 90000-0003", "pending", "Sem contato há 3 dias", "Bruno"],
              ["Rafael Teste Oliveira", "(14) 90000-0001", "automated_service", "Primeiro contato", "—"]
            ].map(([nome, tel, status, proxima, resp]) => (
              <li key={nome} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_80px_auto]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{nome}</p>
                  <p className="text-xs tabular-nums text-muted">{tel}</p>
                </div>
                <div className="order-3 col-span-2 sm:order-none sm:col-span-1"><StatusBadge status={status} /></div>
                <p className="hidden text-[13px] text-ink-2 sm:block">{proxima}</p>
                <p className="hidden text-[13px] text-ink-2 sm:block">{resp}</p>
                <Button size="sm" variant="secondary" aria-label={`WhatsApp de ${nome}`}><MessageCircle className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">WhatsApp</span></Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Fernanda Demo Ribeiro"
        description="Aguardando reunião · Bruno Fictício"
        footer={<div className="flex gap-2"><Button block variant="secondary" onClick={() => setSheet(false)}>Fechar</Button><Button block>WhatsApp</Button></div>}
      >
        <p className="text-sm text-ink-2">Conteúdo rolável da gaveta: dados do cliente, atividades, documentos. No celular abre de baixo; no desktop, pela lateral.</p>
      </Sheet>
    </main>
  );
}
