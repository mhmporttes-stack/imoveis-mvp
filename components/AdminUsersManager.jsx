"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clipboard, Eye, Plus, UserRound, UserRoundCheck, UserRoundX } from "lucide-react";

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  password: "",
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
  const [copied, setCopied] = useState("");

  const sortedUsers = useMemo(() => [...users].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")), [users]);

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
      setMessage("Usuário cadastrado com sucesso.");
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

  async function copyLink(value, key) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("Não foi possível copiar o link neste navegador.");
    }
  }

  return (
    <section className="container-page grid gap-6">
      <form onSubmit={createUser} className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo usuário</p>
            <h2 className="mt-2 text-3xl font-black text-navy">Cadastrar corretor</h2>
          </div>
          <button type="submit" disabled={isSaving} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
            <Plus className="h-5 w-5" aria-hidden="true" />
            {isSaving ? "Cadastrando..." : "Novo usuário"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-5">
          <Field label="Nome completo" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Field label="E-mail" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
          <Field label="WhatsApp para notificações" value={form.phone} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
          <Field label="Senha inicial" type="password" value={form.password} onChange={(value) => setForm((current) => ({ ...current, password: value }))} />
          <label className="grid gap-2 text-sm font-black text-navy">
            Status
            <select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </label>
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
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black ${isActive ? "bg-blue-50 text-brand" : "bg-red-50 text-red-700"}`}>
                      {isActive ? <UserRoundCheck className="h-4 w-4" aria-hidden="true" /> : <UserRoundX className="h-4 w-4" aria-hidden="true" />}
                      {STATUS_LABELS[user.status] || "Ativo"}
                    </span>
                    <span className="rounded-full bg-mist px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-muted">
                      {user.role === "admin" ? "Administrador geral" : "Corretor"}
                    </span>
                  </div>
                  <h3 className="mt-3 truncate text-2xl font-black text-navy">{user.name}</h3>
                  <p className="mt-1 break-words font-bold text-muted">{user.email}</p>
                  {user.phone ? <p className="mt-1 font-bold text-muted">{user.phone}</p> : null}
                  <p className="mt-3 text-sm font-bold text-muted">
                    Cadastro: {formatDate(user.createdAt)} · Total de clientes: <strong className="text-navy">{userCounts.total}</strong> · Hoje: <strong className="text-navy">{userCounts.today}</strong>
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[460px]">
                  <Link href={`/admin/simulacoes?responsavel=${user.id}`} className="premium-button-secondary justify-center">
                    <Eye className="h-5 w-5" aria-hidden="true" />
                    Ver clientes
                  </Link>
                  <button
                    type="button"
                    onClick={() => updateStatus(user, isActive ? "inactive" : "active")}
                    className="premium-button-secondary justify-center"
                  >
                    {isActive ? <UserRoundX className="h-5 w-5" aria-hidden="true" /> : <UserRoundCheck className="h-5 w-5" aria-hidden="true" />}
                    {isActive ? "Desativar" : "Ativar"}
                  </button>
                  <button type="button" onClick={() => copyLink(user.simulationLink, `${user.id}-sim`)} className="premium-button-secondary justify-center">
                    {copied === `${user.id}-sim` ? <Check className="h-5 w-5" aria-hidden="true" /> : <Clipboard className="h-5 w-5" aria-hidden="true" />}
                    Link de simulação
                  </button>
                  <button type="button" onClick={() => copyLink(user.captacaoLink, `${user.id}-cap`)} className="premium-button-secondary justify-center">
                    {copied === `${user.id}-cap` ? <Check className="h-5 w-5" aria-hidden="true" /> : <Clipboard className="h-5 w-5" aria-hidden="true" />}
                    Link de captação
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

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="grid gap-2 text-sm font-black text-navy">
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
