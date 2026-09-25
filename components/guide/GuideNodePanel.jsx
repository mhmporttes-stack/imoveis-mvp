"use client";

import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from "lucide-react";
import { PHASES, newId, scanCompliance } from "@/lib/attendance-guide-core.mjs";
import { TONES } from "@/components/flows/flow-ui";
import { GUIDE_NODE_META } from "@/components/guide/guide-ui";

const inputClass = "w-full rounded-lg border border-line bg-white p-2.5 text-sm font-semibold text-navy outline-none focus:border-brand";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-2 text-xs font-black uppercase tracking-wide text-muted">
        {label}
        {hint ? <span className="text-right normal-case tracking-normal">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

// Nome curto de um card para os seletores de destino.
export function nodeLabel(node, libraryTitles) {
  const data = node.data || {};
  switch (node.type) {
    case "card": return data.title || "Card sem título";
    case "followup": return `Retorno: ${data.title || "definir retorno"}`;
    case "end": return `Encerrar: ${data.title || ""}`;
    case "ref": return `Banco › ${libraryTitles.get(`${data.guideId}::${data.nodeId}`) || data.label || "objeção não escolhida"}`;
    case "return": return "Voltar ao atendimento";
    default: return node.id;
  }
}

// Painel lateral de edição do card selecionado. Recebe o card e devolve mudanças pelo onChangeData; a ligação de
// cada resposta também pode ser feita aqui (além de arrastar no mapa) pelo onConnect.
export default function GuideNodePanel({ node, graph, isLibrary, libraryOptions, libraryTitles, issues, onChangeData, onConnect, onDelete, onDuplicate, onClose }) {
  if (!node) return null;
  const meta = GUIDE_NODE_META[node.type];
  const Icon = meta.icon;
  const data = node.data || {};
  const set = (patch) => onChangeData({ ...data, ...patch });
  const targets = graph.nodes.filter((item) => item.type !== "start" && item.id !== node.id);
  const edgeTo = (port) => graph.edges.find((edge) => edge.from === node.id && edge.port === port)?.to || "";

  function updateOption(optionId, patch) {
    set({ options: (data.options || []).map((option) => (option.id === optionId ? { ...option, ...patch } : option)) });
  }
  function moveOption(index, delta) {
    const options = [...(data.options || [])];
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    [options[index], options[target]] = [options[target], options[index]];
    set({ options });
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-soft">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${TONES[meta.tone].soft}`}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-black text-navy">{meta.label}</p>
          <p className="truncate text-xs font-semibold text-muted">{meta.hint}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-muted hover:bg-mist lg:hidden" aria-label="Fechar"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {issues?.errors?.length || issues?.warnings?.length ? (
          <div className="space-y-1.5">
            {issues.errors.map((message, index) => <p key={`e${index}`} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{message}</p>)}
            {issues.warnings.map((message, index) => <p key={`w${index}`} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{message}</p>)}
          </div>
        ) : null}

        {node.type === "start" ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800">
            {isLibrary
              ? "No Banco de Objeções não há um caminho único: cada objeção é uma “entrada” (marque no card). Os outros guias abrem as entradas por “Abrir objeção”."
              : "Aqui começa o atendimento. Arraste a bolinha “Começar” até o primeiro card."}
          </p>
        ) : null}

        {node.type === "card" ? (
          <>
            <Field label="Título">
              <input className={inputClass} maxLength={120} value={data.title || ""} onChange={(event) => set({ title: event.target.value })} />
            </Field>
            <Field label="Etapa" hint="regra central do atendimento">
              <select className={inputClass} value={data.phase || "investigar"} onChange={(event) => set({ phase: event.target.value })}>
                {PHASES.map((phase) => <option key={phase.key} value={phase.key}>{phase.label}</option>)}
              </select>
            </Field>
            {isLibrary ? (
              <label className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm font-bold text-navy">
                <input type="checkbox" className="mt-0.5" checked={data.entry === true} onChange={(event) => set({ entry: event.target.checked })} />
                <span>Entrada do banco<span className="block text-xs font-semibold text-muted">Aparece na lista de “Abrir objeção” dos outros guias.</span></span>
              </label>
            ) : null}
            <Field label="Orientação interna" hint="só o corretor vê">
              <textarea className={`${inputClass} min-h-[96px]`} maxLength={2500} value={data.guidance || ""} onChange={(event) => set({ guidance: event.target.value })} />
            </Field>
            <Field label="Argumento sugerido">
              <textarea className={`${inputClass} min-h-[80px]`} maxLength={2500} value={data.argument || ""} onChange={(event) => set({ argument: event.target.value })} />
            </Field>
            <Field label="Mensagem pronta" hint="[Nome] [Corretor] [Link]">
              <textarea className={`${inputClass} min-h-[110px]`} maxLength={2500} value={data.message || ""} onChange={(event) => set({ message: event.target.value })} />
            </Field>
            <Compliance text={`${data.message || ""}\n${data.argument || ""}`} />

            <div>
              <p className="mb-1 flex items-center justify-between text-xs font-black uppercase tracking-wide text-muted">
                Respostas possíveis do cliente
                <span className="normal-case tracking-normal">cada uma leva a um card</span>
              </p>
              <div className="space-y-2.5">
                {(data.options || []).map((option, index) => (
                  <div key={option.id} className="rounded-xl border border-line p-2.5">
                    <div className="flex items-center gap-1.5">
                      <input className={`${inputClass} !p-2`} placeholder="Ex.: Gostou da opção" maxLength={120} value={option.label} onChange={(event) => updateOption(option.id, { label: event.target.value })} />
                      <button type="button" onClick={() => moveOption(index, -1)} disabled={index === 0} className="rounded-lg p-1.5 text-navy hover:bg-mist disabled:opacity-30" aria-label="Subir"><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => moveOption(index, 1)} disabled={index === (data.options || []).length - 1} className="rounded-lg p-1.5 text-navy hover:bg-mist disabled:opacity-30" aria-label="Descer"><ArrowDown className="h-4 w-4" /></button>
                      <button
                        type="button"
                        onClick={() => { set({ options: (data.options || []).filter((item) => item.id !== option.id) }); onConnect(node.id, option.id, ""); }}
                        className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                        aria-label="Remover resposta"
                      ><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <select className={`${inputClass} mt-1.5 !p-2 text-xs`} value={edgeTo(option.id)} onChange={(event) => onConnect(node.id, option.id, event.target.value)}>
                      <option value="">→ Ainda sem destino</option>
                      {targets.map((item) => <option key={item.id} value={item.id}>→ {nodeLabel(item, libraryTitles)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => set({ options: [...(data.options || []), { id: newId("o"), label: "" }].slice(0, 20) })}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm font-black text-navy hover:bg-mist"
              ><Plus className="h-4 w-4" />Adicionar resposta</button>
            </div>
          </>
        ) : null}

        {node.type === "followup" ? (
          <>
            <Field label="Título">
              <input className={inputClass} maxLength={120} value={data.title || ""} onChange={(event) => set({ title: event.target.value })} />
            </Field>
            <Field label="Orientação interna">
              <textarea className={`${inputClass} min-h-[96px]`} maxLength={2500} value={data.guidance || ""} onChange={(event) => set({ guidance: event.target.value })} />
            </Field>
            <Field label="Mensagem pronta (confirmação do retorno)" hint="[Nome] [Corretor]">
              <textarea className={`${inputClass} min-h-[96px]`} maxLength={2500} value={data.message || ""} onChange={(event) => set({ message: event.target.value })} />
            </Field>
            <Compliance text={data.message || ""} />
            <Field label="Retorno sugerido (dias)" hint="o corretor pode mudar a data">
              <input type="number" min={0} max={365} className={inputClass} value={data.defaultDays ?? 1} onChange={(event) => set({ defaultDays: Number(event.target.value) })} />
            </Field>
            <NextSelect label="Depois de agendar, ir para" hint="opcional — vazio termina o atendimento" emptyLabel="Terminar o atendimento aqui" node={node} targets={targets} edgeTo={edgeTo("next")} onConnect={onConnect} libraryTitles={libraryTitles} />
          </>
        ) : null}

        {node.type === "ref" ? (
          <>
            <Field label="Qual objeção este card abre?">
              <select
                className={inputClass}
                value={data.guideId && data.nodeId ? `${data.guideId}::${data.nodeId}` : ""}
                onChange={(event) => {
                  const [guideId, nodeId] = event.target.value.split("::");
                  set({ guideId: guideId || "", nodeId: nodeId || "" });
                }}
              >
                <option value="">Escolha…</option>
                {(libraryOptions || []).map((library) => (
                  <optgroup key={library.guideId} label={library.guideName}>
                    {library.entries.map((entry) => <option key={`${entry.guideId}::${entry.nodeId}`} value={`${entry.guideId}::${entry.nodeId}`}>{entry.title}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Rótulo no mapa (opcional)">
              <input className={inputClass} maxLength={120} value={data.label || ""} onChange={(event) => set({ label: event.target.value })} />
            </Field>
            <NextSelect label="Ao voltar do tratamento, ir para" hint="ex.: Documentação" emptyLabel="Ainda sem destino" node={node} targets={targets} edgeTo={edgeTo("next")} onConnect={onConnect} libraryTitles={libraryTitles} />
            <p className="rounded-xl bg-violet-50 px-3 py-3 text-xs font-semibold text-violet-800">
              O corretor percorre a objeção do banco (investigar → motivo real → solucionar → testar aceitação). Quando o cliente aceita, ele volta pela saída “Ao voltar do tratamento” — ligue-a ao próximo card (ex.: Documentação).
            </p>
          </>
        ) : null}

        {node.type === "end" ? (
          <>
            <Field label="Título">
              <input className={inputClass} maxLength={120} value={data.title || ""} onChange={(event) => set({ title: event.target.value })} />
            </Field>
            <Field label="Resultado (ex.: Comprou)">
              <input className={inputClass} maxLength={120} value={data.outcome || ""} onChange={(event) => set({ outcome: event.target.value })} />
            </Field>
            <Field label="Orientação interna">
              <textarea className={`${inputClass} min-h-[96px]`} maxLength={2500} value={data.guidance || ""} onChange={(event) => set({ guidance: event.target.value })} />
            </Field>
          </>
        ) : null}

        {node.type === "return" ? (
          <p className="rounded-xl bg-cyan-50 px-3 py-3 text-sm font-semibold text-cyan-800">
            Quando o cliente aceita a solução, o corretor volta ao guia que abriu esta objeção, no card ligado à saída “Ao voltar do tratamento”. Use só dentro do Banco de Objeções.
          </p>
        ) : null}
      </div>

      {node.type !== "start" ? (
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onDuplicate} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-black text-navy hover:bg-mist"><Copy className="h-4 w-4" />Duplicar</button>
          <button type="button" onClick={onDelete} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-black text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Excluir card</button>
        </div>
      ) : null}
    </aside>
  );
}

function Compliance({ text }) {
  const hits = scanCompliance(text);
  if (!hits.length) return null;
  return (
    <div className="space-y-1.5">
      {hits.map((hit, index) => (
        <p key={index} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          {hit.kind === "closer"
            ? `Evite encerrar com “${hit.text}”: todo atendimento pendente termina com próximo passo + data de retorno.`
            : `Evite promessa/afirmação financeira (“${hit.text}”).`}
        </p>
      ))}
    </div>
  );
}

function NextSelect({ label, hint, emptyLabel, node, targets, edgeTo, onConnect, libraryTitles }) {
  return (
    <Field label={label} hint={hint}>
      <select className={inputClass} value={edgeTo} onChange={(event) => onConnect(node.id, "next", event.target.value)}>
        <option value="">{emptyLabel}</option>
        {targets.map((item) => <option key={item.id} value={item.id}>{nodeLabel(item, libraryTitles)}</option>)}
      </select>
    </Field>
  );
}
