"use client";

import { useState } from "react";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { LIMITS, TRIGGER_TYPES, defaultCooldownHours, newId } from "@/lib/whatsapp-flow-core.mjs";
import { ACTION_LABELS, CONDITION_LABELS, NODE_META, TONES, TRIGGER_LABELS } from "@/components/flows/flow-ui";

const VARIABLES = [
  ["{{primeiro_nome}}", "Primeiro nome"],
  ["{{nome}}", "Nome completo"],
  ["{{corretor}}", "Corretor"],
  ["{{cargo_corretor}}", "Cargo (corretor/corretora)"],
  ["{{nosso_cargo}}", "Nosso/nossa + cargo"],
  ["{{o_a}}", "o / a"],
  ["{{ele_ela}}", "ele / ela"],
  ["{{link_simulacao}}", "Link de simulação"]
];

const WEEKDAYS = [["1", "Seg"], ["2", "Ter"], ["3", "Qua"], ["4", "Qui"], ["5", "Sex"], ["6", "Sáb"], ["0", "Dom"]];

const inputClass = "w-full rounded-lg border border-line bg-white p-2.5 text-sm font-semibold text-navy outline-none focus:border-brand";

// Painel lateral de edição do bloco selecionado. Recebe o bloco e devolve
// mudanças pelo onChangeData (bloco) / onChangeTrigger (gatilho).
export default function FlowNodePanel({ node, trigger, issues, onChangeData, onChangeTrigger, onDelete, onDuplicate, onClose }) {
  if (!node) return null;
  const meta = NODE_META[node.type];
  const Icon = meta.icon;
  const data = node.data || {};
  const set = (patch) => onChangeData({ ...data, ...patch });

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

        {node.type === "start" ? <TriggerForm trigger={trigger} onChange={onChangeTrigger} /> : null}
        {node.type === "message" ? <MessageForm data={data} set={set} /> : null}
        {node.type === "input" ? <InputForm data={data} set={set} /> : null}
        {node.type === "action" ? <ActionForm data={data} set={set} /> : null}
        {node.type === "condition" ? <ConditionForm data={data} set={set} /> : null}
        {node.type === "delay" ? <DelayForm data={data} set={set} /> : null}
      </div>

      {node.type !== "start" ? (
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onDuplicate} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-black text-navy hover:bg-mist"><Copy className="h-4 w-4" />Duplicar</button>
          <button type="button" onClick={onDelete} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-black text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Excluir bloco</button>
        </div>
      ) : null}
    </aside>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs font-black uppercase tracking-wide text-muted">
        {label}
        {hint ? <span className="normal-case tracking-normal">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------

function TriggerForm({ trigger, onChange }) {
  const [draftWord, setDraftWord] = useState("");
  const set = (patch) => onChange({ ...trigger, ...patch });

  function addWords(raw) {
    const words = String(raw).split(/[,;\n]/).map((word) => word.trim()).filter(Boolean);
    if (!words.length) return;
    const merged = [...(trigger.keywords || [])];
    for (const word of words) if (!merged.some((item) => item.toLowerCase() === word.toLowerCase())) merged.push(word.slice(0, 60));
    set({ keywords: merged.slice(0, LIMITS.maxKeywords) });
    setDraftWord("");
  }

  return (
    <>
      <Field label="Quando o fluxo começa">
        <div className="space-y-2">
          {TRIGGER_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => set({ type, cooldownHours: defaultCooldownHours(type) })}
              className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm font-black transition ${trigger.type === type ? "border-brand bg-brand/10 text-brand" : "border-line text-navy hover:bg-mist"}`}
            >
              {TRIGGER_LABELS[type]}
              <span className="mt-0.5 block text-xs font-semibold text-muted">
                {{
                  keyword: "Quando o cliente escrever uma das palavras abaixo.",
                  first_message: "Quando um contato novo manda a primeira mensagem.",
                  ad_referral: "Quando o cliente chega clicando no anúncio (Click to WhatsApp).",
                  any_message: "Qualquer mensagem, se não houver outro fluxo em andamento."
                }[type]}
              </span>
            </button>
          ))}
        </div>
      </Field>

      {trigger.type === "keyword" ? (
        <>
          <Field label="Palavras-chave" hint="Enter ou vírgula para adicionar">
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-line p-2">
              {(trigger.keywords || []).map((word) => (
                <span key={word} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-black text-brand">
                  {word}
                  <button type="button" aria-label={`Remover ${word}`} onClick={() => set({ keywords: trigger.keywords.filter((item) => item !== word) })}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <input
                value={draftWord}
                onChange={(event) => (/[,;]$/.test(event.target.value) ? addWords(event.target.value) : setDraftWord(event.target.value))}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addWords(draftWord); } }}
                onBlur={() => addWords(draftWord)}
                placeholder={trigger.keywords?.length ? "" : "ex.: simulação, quero comprar"}
                className="min-w-[120px] flex-1 border-0 p-1 text-sm font-semibold text-navy outline-none"
              />
            </div>
          </Field>
          <Field label="Como comparar">
            <select value={trigger.match || "contains"} onChange={(event) => set({ match: event.target.value })} className={inputClass}>
              <option value="contains">A mensagem contém a palavra</option>
              <option value="exact">A mensagem é exatamente a palavra</option>
            </select>
          </Field>
        </>
      ) : null}

      <Field label="Não repetir para o mesmo contato por" hint="horas (0 = sempre)">
        <input type="number" min="0" max="720" value={trigger.cooldownHours ?? 0} onChange={(event) => set({ cooldownHours: Number(event.target.value) })} className={inputClass} />
      </Field>
      <p className="rounded-lg bg-mist px-3 py-2 text-xs font-semibold text-muted">
        Se um atendente respondeu a este cliente nos últimos 30 minutos, só o gatilho por palavra-chave inicia o fluxo (os outros esperam). Quando um atendente responde no Chat, o fluxo em andamento para.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

function VariableChips({ onInsert }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {VARIABLES.map(([token, label]) => (
        <button key={token} type="button" onClick={() => onInsert(token)} className="rounded-full border border-line px-2.5 py-1 text-[11px] font-black text-navy hover:bg-mist">
          + {label}
        </button>
      ))}
    </div>
  );
}

function FollowUpForm({ data, set }) {
  const followUp = data.followUp || { enabled: false, amount: 2, unit: "hours" };
  const update = (patch) => set({ followUp: { ...followUp, ...patch } });
  return (
    <div className="rounded-xl border border-line p-3">
      <label className="flex items-center gap-2 text-sm font-black text-navy">
        <input type="checkbox" checked={Boolean(followUp.enabled)} onChange={(event) => update({ enabled: event.target.checked })} className="h-4 w-4 accent-brand" />
        Se o cliente não responder…
      </label>
      {followUp.enabled ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs font-bold text-muted">após</span>
          <input type="number" min="1" value={followUp.amount} onChange={(event) => update({ amount: Number(event.target.value) })} className="w-20 rounded-lg border border-line p-2 text-sm font-semibold text-navy" />
          <select value={followUp.unit} onChange={(event) => update({ unit: event.target.value })} className="rounded-lg border border-line p-2 text-sm font-semibold text-navy">
            <option value="minutes">minutos</option>
            <option value="hours">horas</option>
          </select>
        </div>
      ) : null}
      {followUp.enabled ? <p className="mt-2 text-xs font-semibold text-muted">Cria a saída "Se não responder" no bloco (máximo 23h, por causa da janela de 24h do WhatsApp).</p> : null}
    </div>
  );
}

function MessageForm({ data, set }) {
  const mode = data.mode || "text";
  const buttons = data.buttons || [];
  const items = data.items || [];

  function switchMode(next) {
    const patch = { mode: next };
    if (next === "buttons" && !buttons.length) patch.buttons = [{ id: newId("b"), title: "" }];
    if (next === "list" && !items.length) patch.items = [{ id: newId("i"), title: "", description: "" }];
    set(patch);
  }

  return (
    <>
      <Field label="Tipo da mensagem">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-mist p-1">
          {[["text", "Texto"], ["buttons", "Botões"], ["list", "Lista"], ["link", "Link"]].map(([key, label]) => (
            <button key={key} type="button" onClick={() => switchMode(key)} className={`rounded-lg py-1.5 text-xs font-black ${mode === key ? "bg-white text-brand shadow-soft" : "text-navy"}`}>{label}</button>
          ))}
        </div>
      </Field>

      <Field label="Mensagem" hint={`${(data.text || "").length}/${LIMITS.bodyText}`}>
        <textarea value={data.text || ""} maxLength={LIMITS.bodyText} rows={5} onChange={(event) => set({ text: event.target.value })} className={inputClass} placeholder="Escreva a mensagem que o cliente vai receber…" />
        <VariableChips onInsert={(token) => set({ text: `${data.text || ""}${token}` })} />
      </Field>

      {mode === "buttons" ? (
        <Field label="Botões de resposta" hint={`${buttons.length}/${LIMITS.maxButtons}`}>
          <div className="space-y-2">
            {buttons.map((button, index) => (
              <div key={button.id} className="flex items-center gap-2">
                <input
                  value={button.title}
                  maxLength={LIMITS.buttonTitle}
                  onChange={(event) => set({ buttons: buttons.map((item) => (item.id === button.id ? { ...item, title: event.target.value } : item)) })}
                  placeholder={`Botão ${index + 1}`}
                  className={inputClass}
                />
                <span className="w-9 shrink-0 text-right text-[11px] font-bold text-muted">{button.title.length}/{LIMITS.buttonTitle}</span>
                <button type="button" aria-label="Remover botão" onClick={() => set({ buttons: buttons.filter((item) => item.id !== button.id) })} className="rounded-full p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {buttons.length < LIMITS.maxButtons ? (
              <button type="button" onClick={() => set({ buttons: [...buttons, { id: newId("b"), title: "" }] })} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand px-3 py-2 text-xs font-black text-brand hover:bg-brand/5"><Plus className="h-3.5 w-3.5" />Adicionar botão</button>
            ) : null}
          </div>
          <p className="mt-2 text-xs font-semibold text-muted">Cada botão ganha sua própria saída no mapa — ligue cada um ao que deve acontecer em seguida.</p>
        </Field>
      ) : null}

      {mode === "list" ? (
        <>
          <Field label="Texto do botão que abre a lista" hint={`${(data.listButton || "").length}/${LIMITS.listButton}`}>
            <input value={data.listButton || ""} maxLength={LIMITS.listButton} onChange={(event) => set({ listButton: event.target.value })} className={inputClass} />
          </Field>
          <Field label="Opções da lista" hint={`${items.length}/${LIMITS.maxListItems}`}>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={item.id} className="space-y-1.5 rounded-xl border border-line p-2">
                  <div className="flex items-center gap-2">
                    <input value={item.title} maxLength={LIMITS.listItemTitle} onChange={(event) => set({ items: items.map((entry) => (entry.id === item.id ? { ...entry, title: event.target.value } : entry)) })} placeholder={`Opção ${index + 1}`} className={inputClass} />
                    <button type="button" aria-label="Remover opção" onClick={() => set({ items: items.filter((entry) => entry.id !== item.id) })} className="rounded-full p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <input value={item.description || ""} maxLength={LIMITS.listItemDescription} onChange={(event) => set({ items: items.map((entry) => (entry.id === item.id ? { ...entry, description: event.target.value } : entry)) })} placeholder="Descrição (opcional)" className={inputClass} />
                </div>
              ))}
              {items.length < LIMITS.maxListItems ? (
                <button type="button" onClick={() => set({ items: [...items, { id: newId("i"), title: "", description: "" }] })} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand px-3 py-2 text-xs font-black text-brand hover:bg-brand/5"><Plus className="h-3.5 w-3.5" />Adicionar opção</button>
              ) : null}
            </div>
          </Field>
        </>
      ) : null}

      {mode === "link" ? (
        <>
          <Field label="Texto do botão" hint={`${(data.linkLabel || "").length}/${LIMITS.linkLabel}`}>
            <input value={data.linkLabel || ""} maxLength={LIMITS.linkLabel} onChange={(event) => set({ linkLabel: event.target.value })} placeholder="Fazer simulação" className={inputClass} />
          </Field>
          <Field label="Endereço do link">
            <input value={data.linkUrl || ""} onChange={(event) => set({ linkUrl: event.target.value })} placeholder="https://…" className={inputClass} />
            <button type="button" onClick={() => set({ linkUrl: "{{link_simulacao}}" })} className="mt-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] font-black text-navy hover:bg-mist">Usar o link de simulação do corretor</button>
          </Field>
        </>
      ) : null}

      {mode !== "text" ? (
        <Field label="Rodapé (opcional)" hint={`${(data.footer || "").length}/${LIMITS.footer}`}>
          <input value={data.footer || ""} maxLength={LIMITS.footer} onChange={(event) => set({ footer: event.target.value })} className={inputClass} />
        </Field>
      ) : null}

      {mode === "buttons" || mode === "link" ? (
        <Field label="Imagem no topo (opcional)">
          <input value={data.imageUrl || ""} onChange={(event) => set({ imageUrl: event.target.value })} placeholder="https://… (link da imagem)" className={inputClass} />
        </Field>
      ) : null}

      {mode === "buttons" || mode === "list" ? <FollowUpForm data={data} set={set} /> : null}
    </>
  );
}

function InputForm({ data, set }) {
  return (
    <>
      <Field label="Pergunta" hint={`${(data.text || "").length}/${LIMITS.bodyText}`}>
        <textarea value={data.text || ""} maxLength={LIMITS.bodyText} rows={4} onChange={(event) => set({ text: event.target.value })} className={inputClass} placeholder="Ex.: Qual é o seu nome?" />
        <VariableChips onInsert={(token) => set({ text: `${data.text || ""}${token}` })} />
      </Field>
      <Field label="Guardar a resposta em" hint="nome da variável">
        <input value={data.variable || ""} onChange={(event) => set({ variable: event.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 31) })} className={inputClass} />
      </Field>
      <p className="rounded-lg bg-mist px-3 py-2 text-xs font-semibold text-muted">
        Depois é só usar {"{{" + (data.variable || "resposta") + "}}"} nas mensagens seguintes. Se a variável se chamar <b>nome</b>, o primeiro nome fica em {"{{primeiro_nome}}"} e o cliente criado na roleta usa esse nome.
      </p>
      <FollowUpForm data={data} set={set} />
    </>
  );
}

function ActionForm({ data, set }) {
  const actions = data.actions || [];
  const update = (index, patch) => set({ actions: actions.map((action, position) => (position === index ? { ...action, ...patch } : action)) });
  return (
    <>
      <Field label="O que fazer (em ordem)">
        <div className="space-y-2">
          {actions.map((action, index) => (
            <div key={index} className="space-y-1.5 rounded-xl border border-line p-2">
              <div className="flex items-center gap-2">
                <select value={action.type} onChange={(event) => update(index, { type: event.target.value })} className={inputClass}>
                  {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button type="button" aria-label="Remover ação" onClick={() => set({ actions: actions.filter((_, position) => position !== index) })} className="rounded-full p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </div>
              {action.type === "tag" ? <input value={action.tag || ""} onChange={(event) => update(index, { tag: event.target.value })} placeholder="Nome da etiqueta" className={inputClass} /> : null}
            </div>
          ))}
          <button type="button" onClick={() => set({ actions: [...actions, { type: "tag", tag: "" }] })} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand px-3 py-2 text-xs font-black text-brand hover:bg-brand/5"><Plus className="h-3.5 w-3.5" />Adicionar ação</button>
        </div>
      </Field>
      <div className="space-y-1.5 rounded-lg bg-mist px-3 py-2 text-xs font-semibold text-muted">
        <p><b>Roleta:</b> cria o cliente no CRM e escolhe o corretor pela roleta (se o telefone já é cliente, não duplica nem troca o responsável). Depois disso, {"{{link_simulacao}}"} e {"{{corretor}}"} passam a ser os desse corretor.</p>
        <p><b>Passar para um atendente:</b> encerra o fluxo e deixa a conversa como "Nova" no Chat, para uma pessoa assumir.</p>
      </div>
    </>
  );
}

function ConditionForm({ data, set }) {
  const days = data.days || [];
  return (
    <>
      <Field label="Verificar">
        <select value={data.kind || "business_hours"} onChange={(event) => set({ kind: event.target.value })} className={inputClass}>
          {Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {data.kind === "business_hours" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Das"><input type="time" value={data.start || "09:00"} onChange={(event) => set({ start: event.target.value })} className={inputClass} /></Field>
            <Field label="Às"><input type="time" value={data.end || "18:00"} onChange={(event) => set({ end: event.target.value })} className={inputClass} /></Field>
          </div>
          <Field label="Dias da semana">
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map(([value, label]) => {
                const active = days.includes(Number(value));
                return (
                  <button key={value} type="button" onClick={() => set({ days: active ? days.filter((day) => day !== Number(value)) : [...days, Number(value)] })} className={`rounded-full px-3 py-1.5 text-xs font-black ${active ? "bg-brand text-white" : "border border-line text-navy"}`}>{label}</button>
                );
              })}
            </div>
          </Field>
          <p className="text-xs font-semibold text-muted">Horário de Brasília.</p>
        </>
      ) : null}
      <p className="rounded-lg bg-mist px-3 py-2 text-xs font-semibold text-muted">O bloco tem duas saídas: <b>Sim</b> e <b>Não</b>. Ligue cada uma ao caminho correspondente.</p>
    </>
  );
}

function DelayForm({ data, set }) {
  return (
    <>
      <Field label="Esperar">
        <div className="flex items-center gap-2">
          <input type="number" min="1" value={data.amount ?? 10} onChange={(event) => set({ amount: Number(event.target.value) })} className={inputClass} />
          <select value={data.unit || "minutes"} onChange={(event) => set({ unit: event.target.value })} className={inputClass}>
            <option value="minutes">minutos</option>
            <option value="hours">horas</option>
          </select>
        </div>
      </Field>
      <p className="rounded-lg bg-mist px-3 py-2 text-xs font-semibold text-muted">Máximo de 23h. Depois de 24h sem resposta do cliente o WhatsApp só permite mensagens de modelo aprovado, então o fluxo termina se a janela fechar.</p>
    </>
  );
}
