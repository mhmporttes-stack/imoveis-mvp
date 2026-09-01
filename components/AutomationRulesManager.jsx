"use client";

import { useMemo, useState } from "react";
import { Copy, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_CONDITIONS,
  AUTOMATION_DELAY_UNITS,
  AUTOMATION_STATUS_OPTIONS,
  AUTOMATION_TARGETS,
  AUTOMATION_TRIGGERS,
  optionLabel
} from "@/lib/crm-automation-options";

const AUTOMATION_EMAIL = "mhmporttes@gmail.com";

export default function AutomationRulesManager({ initialRules = [], users = [] }) {
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const totals = useMemo(() => ({
    all: rules.length,
    active: rules.filter((rule) => rule.enabled).length,
    inactive: rules.filter((rule) => !rule.enabled).length
  }), [rules]);

  function openNew(source = null) {
    setError("");
    setDraft(source ? {
      ...source,
      id: "",
      name: `${source.name} - cópia`,
      enabled: false,
      conditions: source.conditions.map((item) => ({ ...item })),
      actions: source.actions.map((item) => ({ ...item }))
    } : emptyRule());
  }

  async function saveRule() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(draft.id ? `/api/crm-automation-rules/${draft.id}` : "/api/crm-automation-rules", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar a regra.");
      setRules((current) => draft.id
        ? current.map((rule) => rule.id === payload.rule.id ? payload.rule : rule)
        : [payload.rule, ...current]);
      setDraft(null);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule) {
    const response = await fetch(`/api/crm-automation-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível alterar a regra.");
    setRules((current) => current.map((item) => item.id === rule.id ? payload.rule : item));
  }

  async function removeRule(rule) {
    if (!confirm(`Excluir a regra "${rule.name}"?`)) return;
    const response = await fetch(`/api/crm-automation-rules/${rule.id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setError(payload.error || "Não foi possível excluir a regra.");
    }
    setRules((current) => current.filter((item) => item.id !== rule.id));
  }

  return (
    <section className="container-page space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Total de regras" value={totals.all} />
        <Metric label="Ativas" value={totals.active} tone="active" />
        <Metric label="Inativas" value={totals.inactive} />
      </div>

      <div className="flex justify-end">
        <button className="premium-button-primary" onClick={() => openNew()} type="button"><Plus className="h-5 w-5" />Nova regra</button>
      </div>

      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}
      {draft ? <RuleEditor draft={draft} onChange={setDraft} onClose={() => setDraft(null)} onSave={saveRule} saving={saving} users={users} /> : null}

      <div className="space-y-3">
        {rules.map((rule) => (
          <article className="rounded-[24px] border border-line bg-white p-5 shadow-soft" key={rule.id}>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black text-navy">{rule.name}</h2>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${rule.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{rule.enabled ? "Ativa" : "Inativa"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm font-bold text-muted">
                  <span>Gatilho: <strong className="text-navy">{optionLabel(AUTOMATION_TRIGGERS, rule.triggerType)}</strong></span>
                  <span>Espera: <strong className="text-navy">{delayLabel(rule)}</strong></span>
                  <span>Ação: <strong className="text-navy">{rule.actions.map((action) => optionLabel(AUTOMATION_ACTIONS, action.type)).join(" + ")}</strong></span>
                  <span>Execuções: <strong className="text-navy">{rule.runCount}</strong></span>
                  <span>Última: <strong className="text-navy">{formatDate(rule.lastRunAt)}</strong></span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <SmallButton onClick={() => setDraft(cloneRule(rule))}><Pencil className="h-4 w-4" />Editar</SmallButton>
                <SmallButton onClick={() => openNew(rule)}><Copy className="h-4 w-4" />Duplicar</SmallButton>
                <SmallButton onClick={() => toggleRule(rule)}>{rule.enabled ? "Desativar" : "Ativar"}</SmallButton>
                <SmallButton danger onClick={() => removeRule(rule)}><Trash2 className="h-4 w-4" />Excluir</SmallButton>
              </div>
            </div>
          </article>
        ))}
        {!rules.length ? <p className="rounded-[24px] border border-line bg-white p-8 text-center font-bold text-muted">Nenhuma regra configurada.</p> : null}
      </div>
    </section>
  );
}

function RuleEditor({ draft, onChange, onClose, onSave, saving, users }) {
  const [showFilters, setShowFilters] = useState(draft.conditions.length > 0);
  const update = (patch) => onChange((current) => ({ ...current, ...patch }));
  const selectedAction = draft.actions[0] || defaultAction("send_trigger_email");
  const emailAction = selectedAction.type === "send_trigger_email" ? selectedAction : defaultAction("send_trigger_email");
  const updateEmail = (patch) => update({ actions: [...draft.actions.filter((action) => action.type !== "send_trigger_email"), { ...emailAction, ...patch }] });
  const updateSelectedAction = (patch) => update({ actions: [{ ...selectedAction, ...patch }] });
  const selectAction = (type) => update({ actions: [defaultAction(type)] });
  const timingMode = draft.triggerConfig?.timingMode || (Number(draft.delayValue) ? "after" : "immediate");
  const setTimingMode = (mode) => update({
    triggerConfig: { ...draft.triggerConfig, timingMode: mode },
    ...(mode === "immediate" ? { delayValue: 0 } : {})
  });
  return (
    <div className="rounded-[28px] border border-brand/20 bg-white p-6 shadow-premium [&_input]:min-h-12 [&_input]:w-full [&_input]:rounded-2xl [&_input]:border [&_input]:border-line [&_input]:bg-white [&_input]:px-4 [&_select]:min-h-12 [&_select]:w-full [&_select]:rounded-2xl [&_select]:border [&_select]:border-line [&_select]:bg-white [&_select]:px-4 [&_textarea]:min-h-28 [&_textarea]:w-full [&_textarea]:rounded-2xl [&_textarea]:border [&_textarea]:border-line [&_textarea]:bg-white [&_textarea]:p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black text-navy">{draft.id ? "Editar regra" : "Nova regra"}</h2><button className="icon-button" onClick={onClose} type="button" aria-label="Fechar"><X className="h-5 w-5" /></button></div>
      <div className="mt-6 grid max-w-3xl gap-5">
        <Field label="Nome da regra"><input value={draft.name} onChange={(event) => update({ name: event.target.value })} /></Field>
        <Field label="Quando acontecer"><select value={draft.triggerType} onChange={(event) => update({ triggerType: event.target.value, triggerConfig: {} })}>{AUTOMATION_TRIGGERS.map(option)}</select></Field>
        {["status_changed", "stage_changed"].includes(draft.triggerType) ? <Field label="Status ou etapa"><select value={draft.triggerConfig.status || ""} onChange={(event) => update({ triggerConfig: { ...draft.triggerConfig, status: event.target.value } })}><option value="">Qualquer alteração</option>{AUTOMATION_STATUS_OPTIONS.map(option)}</select></Field> : null}
      </div>

      <div className="mt-7 max-w-3xl">
        <div className="flex items-center justify-between"><h3 className="text-lg font-black text-navy">Filtros opcionais</h3><button className="inline-flex items-center gap-1 text-sm font-black text-brand" onClick={() => { setShowFilters(true); update({ conditions: [...draft.conditions, defaultCondition("not_archived")] }); }} type="button"><Plus className="h-4 w-4" />Adicionar filtro</button></div>
        {showFilters && draft.conditions.length ? <div className="mt-3 space-y-3">{draft.conditions.map((condition, index) => <ConditionEditor condition={condition} key={index} onChange={(next) => update({ conditions: replaceAt(draft.conditions, index, next) })} onRemove={() => update({ conditions: removeAt(draft.conditions, index) })} users={users} />)}</div> : <p className="mt-2 text-sm font-bold text-muted">Nenhum filtro adicional.</p>}
      </div>

      <div className="mt-7 max-w-3xl"><h3 className="text-lg font-black text-navy">Quando avisar</h3><div className="mt-3 grid gap-3 md:grid-cols-2"><select value={timingMode} onChange={(event) => setTimingMode(event.target.value)}><option value="immediate">Imediatamente</option><option value="after">Depois de</option>{["activity_created", "activity_upcoming"].includes(draft.triggerType) ? <option value="before_activity">Antes da atividade</option> : null}{draft.triggerType === "activity_overdue" ? <option value="after_overdue">Após a atividade vencer</option> : null}</select>{timingMode !== "immediate" ? <div className="grid grid-cols-2 gap-2"><input min="1" type="number" value={draft.delayValue || 1} onChange={(event) => update({ delayValue: event.target.value })} /><select value={draft.delayUnit} onChange={(event) => update({ delayUnit: event.target.value })}>{AUTOMATION_DELAY_UNITS.map(option)}</select></div> : null}</div></div>

      <div className="mt-7 max-w-3xl"><h3 className="text-lg font-black text-navy">Ação da regra</h3><div className="mt-3 grid gap-4"><select value={selectedAction.type} onChange={(event) => selectAction(event.target.value)}>{AUTOMATION_ACTIONS.map(option)}</select>
        {selectedAction.type === "send_trigger_email" ? <><Field label="E-mail destinatário"><input readOnly type="email" value={AUTOMATION_EMAIL} /></Field><Field label="Assunto"><input placeholder="CRM | NOVO_CLIENTE | {corretor_codigo}" value={emailAction.subject || ""} onChange={(event) => updateEmail({ subject: event.target.value, recipientEmail: AUTOMATION_EMAIL })} /></Field><Field label="Mensagem"><textarea value={emailAction.message || ""} onChange={(event) => updateEmail({ message: event.target.value, recipientEmail: AUTOMATION_EMAIL })} /></Field><VariableButtons onInsert={(variable) => updateEmail({ message: `${emailAction.message || ""}${emailAction.message ? " " : ""}${variable}`, recipientEmail: AUTOMATION_EMAIL })} /></> : null}
        {selectedAction.type === "create_notification" ? <><Field label="Título da notificação"><input value={selectedAction.title || ""} onChange={(event) => updateSelectedAction({ title: event.target.value })} /></Field><Field label="Mensagem"><textarea value={selectedAction.message || ""} onChange={(event) => updateSelectedAction({ message: event.target.value })} /></Field><p className="text-sm font-bold text-muted">A notificação será exibida ao corretor responsável pelo cliente.</p></> : null}
        {selectedAction.type === "create_activity" ? <><Field label="Tipo de atividade"><select value={selectedAction.activityType || "follow_up"} onChange={(event) => updateSelectedAction({ activityType: event.target.value })}><option value="follow_up">Follow-up</option><option value="documentacao">Documentação</option><option value="ligacao">Ligação</option><option value="reuniao">Reunião</option><option value="visita">Visita</option><option value="outro">Outro</option></select></Field><Field label="Observação"><textarea value={selectedAction.note || ""} onChange={(event) => updateSelectedAction({ note: event.target.value })} /></Field></> : null}
        {selectedAction.type === "change_status" ? <Field label="Novo status"><select value={selectedAction.status || "pending"} onChange={(event) => updateSelectedAction({ status: event.target.value })}>{AUTOMATION_STATUS_OPTIONS.map(option)}</select></Field> : null}
        {selectedAction.type === "return_to_round_robin" ? <p className="rounded-2xl border border-line bg-mist/40 p-4 text-sm font-bold text-muted">O cliente será retirado do corretor atual e atribuído ao próximo participante disponível da distribuição automática.</p> : null}
      </div></div>

      <div className="mt-7 max-w-3xl"><h3 className="text-lg font-black text-navy">Repetir alerta?</h3><p className="mt-2 text-sm font-bold text-muted">Não. O histórico impede o envio duplicado do mesmo evento.</p></div>
      <label className="mt-7 inline-flex items-center gap-3 font-black text-navy"><button aria-pressed={draft.enabled} className={`relative h-7 w-12 rounded-full transition ${draft.enabled ? "bg-brand" : "bg-slate-300"}`} onClick={() => update({ enabled: !draft.enabled })} type="button"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${draft.enabled ? "left-6" : "left-1"}`} /></button>Regra ativa</label>
      <div className="mt-6 flex flex-wrap justify-end gap-3"><button className="premium-button-secondary" onClick={onClose} type="button">Cancelar</button><button className="premium-button-primary" disabled={saving} onClick={onSave} type="button"><Save className="h-5 w-5" />{saving ? "Salvando..." : "Salvar regra"}</button></div>
    </div>
  );
}

const EMAIL_VARIABLES = ["{cliente_nome}", "{cliente_id}", "{cliente_telefone}", "{corretor_nome}", "{corretor_codigo}", "{corretor_telefone}", "{corretor_anterior}", "{atividade}", "{atividade_data}", "{atividade_hora}", "{status_cliente}", "{etapa_cliente}"];
function VariableButtons({ onInsert }) { return <div><p className="text-sm font-black text-navy">Variáveis disponíveis</p><div className="mt-2 flex flex-wrap gap-2">{EMAIL_VARIABLES.map((variable) => <button className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-black text-brand" key={variable} onClick={() => onInsert(variable)} type="button">{variable}</button>)}</div></div>; }

function ConditionEditor({ condition, onChange, onRemove, users }) {
  return <div className="grid gap-2 rounded-2xl border border-line bg-mist/40 p-3 md:grid-cols-[1fr_1.2fr_auto]">
    <select value={condition.type} onChange={(event) => onChange(defaultCondition(event.target.value))}>{AUTOMATION_CONDITIONS.map(option)}</select>
    {condition.type === "status_equals" ? <select value={condition.value || ""} onChange={(event) => onChange({ ...condition, value: event.target.value })}>{AUTOMATION_STATUS_OPTIONS.map(option)}</select> : null}
    {condition.type === "responsible_equals" ? <select value={condition.value || "any"} onChange={(event) => onChange({ ...condition, value: event.target.value })}><option value="any">Qualquer corretor</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select> : null}
    {condition.type === "has_future_activity" ? <select value={String(condition.value)} onChange={(event) => onChange({ ...condition, value: event.target.value === "true" })}><option value="false">Não</option><option value="true">Sim</option></select> : null}
    {condition.type === "last_contact_older_than" ? <div className="grid grid-cols-2 gap-2"><input min="1" type="number" value={condition.amount || 1} onChange={(event) => onChange({ ...condition, amount: event.target.value })} /><select value={condition.unit || "days"} onChange={(event) => onChange({ ...condition, unit: event.target.value })}>{AUTOMATION_DELAY_UNITS.map(option)}</select></div> : null}
    {condition.type === "not_archived" ? <p className="flex items-center px-3 text-sm font-bold text-muted">Cliente não arquivado</p> : null}
    <button className="icon-button text-red-600" onClick={onRemove} type="button" aria-label="Remover condição"><Trash2 className="h-4 w-4" /></button>
  </div>;
}

function ActionEditor({ action, onChange, onRemove, users }) {
  return <div className="space-y-3 rounded-2xl border border-line bg-mist/40 p-3">
    <div className="flex gap-2"><select className="flex-1" value={action.type} onChange={(event) => onChange(defaultAction(event.target.value))}>{AUTOMATION_ACTIONS.map(option)}</select><button className="icon-button text-red-600" onClick={onRemove} type="button" aria-label="Remover ação"><Trash2 className="h-4 w-4" /></button></div>
    {action.type === "create_notification" ? <><input placeholder="Título da notificação" value={action.title || ""} onChange={(event) => onChange({ ...action, title: event.target.value })} /><textarea placeholder="Mensagem" value={action.message || ""} onChange={(event) => onChange({ ...action, message: event.target.value })} /><TargetFields action={action} onChange={onChange} users={users} /></> : null}
    {action.type === "send_trigger_email" ? <div className="grid gap-3 md:grid-cols-2"><Field label="E-mail destinatário"><input type="email" placeholder="seu@email.com" value={action.recipientEmail || ""} onChange={(event) => onChange({ ...action, recipientEmail: event.target.value })} /></Field><Field label="Assunto-base do e-mail"><input placeholder="Ex.: RECEBEU NOVO CLIENTE" value={action.subject || ""} onChange={(event) => onChange({ ...action, subject: event.target.value })} /><span className="text-xs font-bold text-muted">O nome do corretor responsável será adicionado automaticamente ao final.</span></Field></div> : null}
    {action.type === "create_activity" ? <><div className="grid gap-2 md:grid-cols-2"><select value={action.activityType || "follow_up"} onChange={(event) => onChange({ ...action, activityType: event.target.value })}><option value="follow_up">Follow-up</option><option value="documentacao">Documentação</option><option value="ligacao">Ligação</option><option value="reuniao">Reunião</option><option value="visita">Visita</option><option value="outro">Outro</option></select><div className="grid grid-cols-2 gap-2"><input min="0" type="number" value={action.offsetValue || 0} onChange={(event) => onChange({ ...action, offsetValue: event.target.value })} /><select value={action.offsetUnit || "minutes"} onChange={(event) => onChange({ ...action, offsetUnit: event.target.value })}>{AUTOMATION_DELAY_UNITS.map(option)}</select></div></div><textarea placeholder="Observação da atividade" value={action.note || ""} onChange={(event) => onChange({ ...action, note: event.target.value })} /></> : null}
    {action.type === "change_status" ? <select value={action.status || "pending"} onChange={(event) => onChange({ ...action, status: event.target.value })}>{AUTOMATION_STATUS_OPTIONS.map(option)}</select> : null}
  </div>;
}

function TargetFields({ action, onChange, users }) {
  return <div className="grid gap-2 md:grid-cols-2"><select value={action.target || "client_broker"} onChange={(event) => onChange({ ...action, target: event.target.value })}>{AUTOMATION_TARGETS.map(option)}</select>{action.target === "specific_user" ? <select value={action.userId || ""} onChange={(event) => onChange({ ...action, userId: event.target.value })}><option value="">Selecione o usuário</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select> : null}</div>;
}

function EditorGroup({ title, onAdd, children }) { return <div className="mt-6"><div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-black text-navy">{title}</h3><button className="inline-flex items-center gap-1 text-sm font-black text-brand" onClick={onAdd} type="button"><Plus className="h-4 w-4" />Adicionar</button></div><div className="space-y-3">{children}</div></div>; }
function Field({ label, children }) { return <label className="grid gap-2 text-sm font-black text-navy">{label}{children}</label>; }
function Metric({ label, value, tone }) { return <div className={`rounded-[22px] border bg-white p-5 shadow-soft ${tone === "active" ? "border-emerald-200" : "border-line"}`}><p className="text-3xl font-black text-navy">{value}</p><p className="mt-1 text-sm font-bold text-muted">{label}</p></div>; }
function SmallButton({ children, danger, onClick }) { return <button className={`inline-flex h-10 items-center gap-1.5 rounded-full border bg-white px-4 text-sm font-black transition hover:bg-mist ${danger ? "border-red-200 text-red-700" : "border-line text-navy"}`} onClick={onClick} type="button">{children}</button>; }
function option(item) { return <option key={item.value} value={item.value}>{item.label}</option>; }
function replaceAt(items, index, value) { return items.map((item, itemIndex) => itemIndex === index ? value : item); }
function removeAt(items, index) { return items.filter((_, itemIndex) => itemIndex !== index); }
function cloneRule(rule) { return { ...rule, conditions: rule.conditions.map((item) => ({ ...item })), actions: rule.actions.map((item) => ({ ...item })) }; }
function defaultCondition(type) { if (type === "status_equals") return { type, value: "pending" }; if (type === "responsible_equals") return { type, value: "any" }; if (type === "has_future_activity") return { type, value: false }; if (type === "last_contact_older_than") return { type, amount: 1, unit: "days" }; return { type: "not_archived", value: true }; }
function defaultAction(type) { if (type === "send_trigger_email") return { type, recipientEmail: AUTOMATION_EMAIL, subject: "" }; if (type === "create_activity") return { type, activityType: "follow_up", note: "", offsetValue: 0, offsetUnit: "minutes", target: "client_broker" }; if (type === "change_status") return { type, status: "pending" }; if (type === "return_to_round_robin") return { type }; return { type: "create_notification", title: "", message: "", target: "client_broker" }; }
function emptyRule() { return { id: "", name: "", enabled: false, triggerType: "client_created", triggerConfig: { timingMode: "immediate" }, conditions: [], delayValue: 0, delayUnit: "minutes", actions: [defaultAction("send_trigger_email")] }; }
function delayLabel(rule) { return Number(rule.delayValue) === 0 ? "Imediatamente" : `${rule.delayValue} ${optionLabel(AUTOMATION_DELAY_UNITS, rule.delayUnit)}`; }
function formatDate(value) { if (!value) return "Nunca"; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString("pt-BR") : "Nunca"; }
