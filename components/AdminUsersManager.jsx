"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Save, UserRoundCheck, UserRoundX, X } from "lucide-react";

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "broker",
  linkedBrokerId: "",
  managerId: "",
  brokerCommissionPercentage: 50,
  agencyCommissionPercentage: 50,
  defaultManagerPercentage: 10,
  leadDistributionEnabled: false,
  status: "active"
};

const STATUS_LABELS = {
  active: "Ativo",
  inactive: "Inativo"
};

export default function AdminUsersManager({ initialUsers = [], counts = {} }) {
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(null);

  const sortedUsers = useMemo(() => [...users].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")), [users]);
  const brokers = useMemo(() => sortedUsers.filter((user) => ["admin", "manager", "broker"].includes(user.role) && user.status === "active"), [sortedUsers]);
  const managers = useMemo(() => sortedUsers.filter((user) => ["admin", "manager"].includes(user.role) && user.status === "active"), [sortedUsers]);

  function beginEdit(user) {
    setEditingId(user.id);
    setEditForm({ name: user.name, email: user.email, phone: user.phone || "", password: "", role: user.role, linkedBrokerId: user.linkedBrokerId || "", managerId: user.managerId || "", brokerCommissionPercentage: user.brokerCommissionPercentage ?? 50, agencyCommissionPercentage: user.agencyCommissionPercentage ?? 50, defaultManagerPercentage: user.defaultManagerPercentage ?? 10, leadDistributionEnabled: user.leadDistributionEnabled === true, status: user.status });
    setError("");
    setMessage("");
  }

  async function saveUser(event) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin-users/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o usuário.");
      setUsers((current) => current.map((item) => item.id === editingId ? payload.user : item));
      setEditingId("");
      setEditForm(null);
      setMessage("Usuário atualizado com sucesso.");
    } catch (saveError) { setError(saveError.message || "Não foi possível atualizar o usuário."); }
    finally { setIsSaving(false); }
  }

  async function createUser(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível cadastrar o usuário.");

      setUsers((current) => [payload.user, ...current]);
      setForm(EMPTY_FORM);
      setMessage(payload.invitationSent ? "Usuário cadastrado e link do aplicativo enviado por e-mail." : (payload.invitationError || "Usuário cadastrado com sucesso."));
    } catch (createError) {
      setError(createError.message || "Não foi possível cadastrar o usuário.");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateStatus(user, status) {
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin-users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o usuário.");

      setUsers((current) => current.map((item) => (item.id === user.id ? payload.user : item)));
      setMessage(status === "active" ? "Usuário ativado." : "Usuário desativado.");
    } catch (statusError) {
      setError(statusError.message || "Não foi possível atualizar o usuário.");
    }
  }

  return (
    <section className="container-page grid gap-6">
      <form onSubmit={createUser} className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo usuário</p>
            <h2 className="mt-2 text-3xl font-black text-navy">Cadastrar usuário</h2>
          </div>
          <button type="submit" disabled={isSaving} className="premium-button-primary min-h-11 px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60">
            <Plus className="h-5 w-5" aria-hidden="true" />
            {isSaving ? "Cadastrando..." : "Novo usuário"}
          </button>
        </div>

        <div className="mt-5 divide-y divide-line">
          <FormGroup title="Dados do usuário">
            <Field className="lg:col-span-4" label="Nome completo" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
            <Field className="lg:col-span-4" label="E-mail" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
            <Field className="lg:col-span-2" label="WhatsApp para notificações" value={form.phone} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
            <Field className="lg:col-span-2" label="Senha inicial" type="password" value={form.password} onChange={(value) => setForm((current) => ({ ...current, password: value }))} />
          </FormGroup>

          <FormGroup title="Perfil e acesso">
            <RoleField className="lg:col-span-3" value={form.role} onChange={(value) => setForm((current) => ({ ...current, role: value, linkedBrokerId: value === "associate" ? current.linkedBrokerId : "", managerId: ["admin", "manager", "broker"].includes(value) ? current.managerId : "" }))} />
            <StatusField className="lg:col-span-2" value={form.status} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
            <DistributionField className="lg:col-span-4 lg:self-end" checked={form.leadDistributionEnabled} onChange={(value) => setForm((current) => ({ ...current, leadDistributionEnabled: value }))} />
            {form.role === "associate" ? <BrokerField className="lg:col-span-3" brokers={brokers} value={form.linkedBrokerId} onChange={(value) => setForm((current) => ({ ...current, linkedBrokerId: value }))} /> : null}
          </FormGroup>

          {["admin", "manager", "broker"].includes(form.role) ? (
            <FormGroup title="Comissão e gestão">
              <FinancialRuleFields compact form={form} managers={managers} onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))} />
            </FormGroup>
          ) : null}
        </div>

        {message ? <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 font-bold text-brand">{message}</p> : null}
        {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}
      </form>

      <div className="grid gap-4">
        {sortedUsers.map((user) => {
          const userCounts = counts[user.id] || { total: 0, today: 0 };
          const isActive = user.status !== "inactive";
          return (
            <article key={user.id} className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
              {editingId === user.id && editForm ? <form className="mb-6 rounded-[20px] border border-brand/20 bg-mist p-4" onSubmit={saveUser}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Nome completo" value={editForm.name} onChange={(value) => setEditForm((current) => ({ ...current, name: value }))} />
                  <Field label="E-mail" type="email" value={editForm.email} onChange={(value) => setEditForm((current) => ({ ...current, email: value }))} />
                  <Field label="WhatsApp" value={editForm.phone} onChange={(value) => setEditForm((current) => ({ ...current, phone: value }))} />
                  <Field label="Nova senha (opcional)" type="password" value={editForm.password} onChange={(value) => setEditForm((current) => ({ ...current, password: value }))} />
                  <RoleField value={editForm.role} onChange={(value) => setEditForm((current) => ({ ...current, role: value, linkedBrokerId: value === "associate" ? current.linkedBrokerId : "", managerId: ["admin", "manager", "broker"].includes(value) ? current.managerId : "" }))} />
                  <StatusField value={editForm.status} onChange={(value) => setEditForm((current) => ({ ...current, status: value }))} />
                  {editForm.role === "associate" ? <BrokerField brokers={brokers.filter((broker) => broker.id !== user.id)} value={editForm.linkedBrokerId} onChange={(value) => setEditForm((current) => ({ ...current, linkedBrokerId: value }))} /> : null}
                  {["admin", "manager", "broker"].includes(editForm.role) ? <FinancialRuleFields form={editForm} managers={managers.filter((manager) => manager.id !== user.id)} onChange={(field, value) => setEditForm((current) => ({ ...current, [field]: value }))} /> : null}
                  <DistributionField checked={editForm.leadDistributionEnabled} onChange={(value) => setEditForm((current) => ({ ...current, leadDistributionEnabled: value }))} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2"><button className="premium-button-primary" disabled={isSaving} type="submit"><Save className="h-4 w-4" /> Salvar alterações</button><button className="premium-button-secondary" onClick={() => { setEditingId(""); setEditForm(null); }} type="button"><X className="h-4 w-4" /> Cancelar</button></div>
              </form> : null}
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black ${isActive ? "bg-blue-50 text-brand" : "bg-red-50 text-red-700"}`}>
                      {isActive ? <UserRoundCheck className="h-4 w-4" aria-hidden="true" /> : <UserRoundX className="h-4 w-4" aria-hidden="true" />}
                      {STATUS_LABELS[user.status] || "Ativo"}
                    </span>
                    <span className="rounded-full bg-mist px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-muted">
                      {roleLabel(user.role)}
                    </span>
                  </div>
                  <h3 className="mt-3 truncate text-2xl font-black text-navy">{user.name}</h3>
                  <p className="mt-1 break-words font-bold text-muted">{user.email}</p>
                  {user.phone ? <p className="mt-1 font-bold text-muted">{user.phone}</p> : null}
                  {user.role === "associate" ? <p className="mt-1 text-sm font-bold text-muted">Responsável vinculado: <strong className="text-navy">{users.find((item) => item.id === user.linkedBrokerId)?.name || "Não definido"}</strong></p> : null}
                  {["admin", "manager", "broker"].includes(user.role) ? <p className="mt-1 text-sm font-bold text-muted">Divisão padrão: <strong className="text-navy">{user.brokerCommissionPercentage ?? 50}% corretor / {user.agencyCommissionPercentage ?? 50}% imobiliária</strong>{user.managerId ? ` · Gestor ${user.defaultManagerPercentage ?? 10}%` : ""}</p> : null}
                  <p className="mt-3 text-sm font-bold text-muted">
                    Cadastro: {formatDate(user.createdAt)} · Total de clientes: <strong className="text-navy">{userCounts.total}</strong> · Hoje: <strong className="text-navy">{userCounts.today}</strong>
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[380px]">
                  <button type="button" onClick={() => beginEdit(user)} className="premium-button-secondary justify-center"><Pencil className="h-5 w-5" /> Editar</button>
                  <button
                    type="button"
                    onClick={() => updateStatus(user, isActive ? "inactive" : "active")}
                    className="premium-button-secondary justify-center"
                  >
                    {isActive ? <UserRoundX className="h-5 w-5" aria-hidden="true" /> : <UserRoundCheck className="h-5 w-5" aria-hidden="true" />}
                    {isActive ? "Desativar" : "Ativar"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        {!sortedUsers.length ? (
          <article className="rounded-[28px] border border-line bg-white p-8 text-center font-black text-navy shadow-soft">
            Nenhum usuário cadastrado.
          </article>
        ) : null}
      </div>
    </section>
  );
}

function FormGroup({ title, children }) {
  return <fieldset className="py-4 first:pt-0 last:pb-0"><legend className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-muted">{title}</legend><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-12">{children}</div></fieldset>;
}

function RoleField({ value, onChange, className = "" }) {
  return <label className={`grid gap-2 text-sm font-black text-navy ${className}`}>Categoria<select className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10" value={value} onChange={(event) => onChange(event.target.value)}><option value="broker">Corretor</option><option value="associate">Associado</option><option value="manager">Gestor</option><option value="admin">Administrador geral</option></select></label>;
}

function BrokerField({ brokers, value, onChange, className = "" }) {
  return <label className={`grid gap-2 text-sm font-black text-navy ${className}`}>Responsável vinculado<select className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10" required value={value} onChange={(event) => onChange(event.target.value)}><option value="">Selecione um responsável</option>{brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}{broker.role === "admin" ? " (Master)" : ""}</option>)}</select></label>;
}

function StatusField({ value, onChange, className = "" }) {
  return <label className={`grid gap-2 text-sm font-black text-navy ${className}`}>Status<select className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10" value={value} onChange={(event) => onChange(event.target.value)}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>;
}

function DistributionField({ checked, onChange, className = "" }) {
  return <label className={`flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-white px-4 text-sm font-black text-navy ${className}`}><input className="h-5 w-5 accent-brand" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />Participa da distribuição de leads</label>;
}

function FinancialRuleFields({ form, managers, onChange, compact = false }) {
  return <>
    <Field className={compact ? "lg:col-span-2" : ""} label="% Corretor" type="number" value={form.brokerCommissionPercentage} onChange={(value) => onChange("brokerCommissionPercentage", value)} />
    <Field className={compact ? "lg:col-span-2" : ""} label="% Imobiliária" type="number" value={form.agencyCommissionPercentage} onChange={(value) => onChange("agencyCommissionPercentage", value)} />
    <label className={`grid gap-2 text-sm font-black text-navy ${compact ? "lg:col-span-5" : ""}`}>Gestor padrão<select className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold" value={form.managerId || ""} onChange={(event) => onChange("managerId", event.target.value)}><option value="">Sem gestor padrão</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
    <Field className={compact ? "lg:col-span-2" : ""} label="% Gestor" type="number" value={form.defaultManagerPercentage} onChange={(value) => onChange("defaultManagerPercentage", value)} />
  </>;
}

function roleLabel(role) { return role === "admin" ? "Administrador geral" : role === "manager" ? "Gestor" : role === "associate" ? "Associado" : "Corretor"; }

function Field({ label, value, onChange, type = "text", className = "" }) {
  return (
    <label className={`grid gap-2 text-sm font-black text-navy ${className}`}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
      />
    </label>
  );
}

function formatDate(value) {
  if (!value) return "Não informado";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
  } catch {
    return "Não informado";
  }
}
