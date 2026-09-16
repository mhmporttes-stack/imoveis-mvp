"use client";

import { useState } from "react";
import { Lock, MessageCircle, Pencil, Save, X } from "lucide-react";
import { formatCaptacaoMoney, formatCaptacaoPhone, formatCEP, getCaptacaoWhatsApp } from "@/lib/captacoes-schema";
import { toBrazilianE164 } from "@/lib/phone-utils";

const EMPTY_FORM = {
  ownerName: "",
  ownerPhone: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  cep: "",
  intendedPrice: "",
  adminNotes: ""
};

export default function CaptacaoInternalInfoCard({ captacaoId, initial }) {
  const [data, setData] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function beginEdit() {
    setForm(toForm(data));
    setError("");
    setEditing(true);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ownerName: form.ownerName,
        ownerPhone: toBrazilianE164(form.ownerPhone) || form.ownerPhone,
        street: form.street,
        number: form.number,
        complement: form.complement,
        neighborhood: form.neighborhood,
        city: form.city,
        state: form.state,
        cep: form.cep,
        intendedPrice: form.intendedPrice ? Number(String(form.intendedPrice).replace(/\D/g, "")) / 100 : null,
        adminNotes: form.adminNotes
      };
      const response = await fetch(`/api/captacoes/${captacaoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar as informações internas.");
      setData(result);
      setEditing(false);
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar as informações internas.");
    } finally {
      setSaving(false);
    }
  }

  const whatsappUrl = getCaptacaoWhatsApp(data.ownerPhone);

  return (
    <article className="rounded-[28px] border border-amber-200 bg-amber-50/40 p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-amber-800">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Informações internas
          </p>
          <p className="mt-1 text-sm text-amber-800/80">Dados administrativos. Estas informações não são exibidas no site.</p>
        </div>
        {!editing ? (
          <button type="button" onClick={beginEdit} className="premium-button-secondary h-10 px-4 text-sm">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {editing ? (
        <form onSubmit={save} className="mt-5 grid gap-5">
          <FieldGroup title="Proprietário">
            <TextInput label="Nome" value={form.ownerName} onChange={(value) => setForm((current) => ({ ...current, ownerName: value }))} />
            <TextInput label="WhatsApp / Telefone" value={form.ownerPhone} onChange={(value) => setForm((current) => ({ ...current, ownerPhone: value }))} placeholder="(14) 99999-9999" />
          </FieldGroup>

          <FieldGroup title="Localização">
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <TextInput label="Rua / Avenida" value={form.street} onChange={(value) => setForm((current) => ({ ...current, street: value }))} />
              <TextInput label="Número" value={form.number} onChange={(value) => setForm((current) => ({ ...current, number: value }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Complemento" value={form.complement} onChange={(value) => setForm((current) => ({ ...current, complement: value }))} />
              <TextInput label="Bairro" value={form.neighborhood} onChange={(value) => setForm((current) => ({ ...current, neighborhood: value }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_80px_140px]">
              <TextInput label="Cidade" value={form.city} onChange={(value) => setForm((current) => ({ ...current, city: value }))} />
              <TextInput label="UF" value={form.state} onChange={(value) => setForm((current) => ({ ...current, state: value.toUpperCase() }))} maxLength={2} />
              <TextInput label="CEP" value={form.cep} onChange={(value) => setForm((current) => ({ ...current, cep: formatCEP(value) }))} placeholder="00000-000" />
            </div>
          </FieldGroup>

          <FieldGroup title="Comercial">
            <TextInput
              label="Valor do imóvel"
              value={form.intendedPrice ? formatCentsToBRL(form.intendedPrice) : ""}
              onChange={(value) => setForm((current) => ({ ...current, intendedPrice: value.replace(/\D/g, "") }))}
              placeholder="R$ 0,00"
            />
          </FieldGroup>

          <FieldGroup title="Anotações">
            <label className="grid gap-2 text-sm font-black text-navy">
              Observações internas
              <textarea
                className="min-h-32 w-full rounded-2xl border border-line bg-white p-3 font-normal"
                value={form.adminNotes}
                onChange={(event) => setForm((current) => ({ ...current, adminNotes: event.target.value }))}
                placeholder="Condições negociadas, documentação, orientações de atendimento, pendências..."
              />
            </label>
          </FieldGroup>

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={saving} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
              <Save className="h-5 w-5" aria-hidden="true" />
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="premium-button-secondary">
              <X className="h-5 w-5" aria-hidden="true" />
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-5 grid gap-5">
          <FieldGroup title="Proprietário">
            <InfoLine label="Nome" value={data.ownerName} />
            <div className="rounded-2xl bg-white/70 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">WhatsApp / Telefone</p>
              {whatsappUrl ? (
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1.5 font-extrabold text-brand hover:underline">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {formatCaptacaoPhone(data.ownerPhone)}
                </a>
              ) : (
                <p className="mt-1 font-extrabold text-navy">{formatCaptacaoPhone(data.ownerPhone) || "Não informado"}</p>
              )}
            </div>
          </FieldGroup>

          <FieldGroup title="Localização">
            <InfoLine label="Endereço completo" value={formatFullAddress(data)} />
          </FieldGroup>

          <FieldGroup title="Comercial">
            <InfoLine label="Valor do imóvel" value={formatCaptacaoMoney(data.intendedPrice) || "Não informado"} />
          </FieldGroup>

          <FieldGroup title="Anotações">
            <div className="rounded-2xl bg-white/70 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">Observações internas</p>
              <p className="mt-1 whitespace-pre-wrap font-bold text-navy">{data.adminNotes || "Nenhuma observação registrada."}</p>
            </div>
          </FieldGroup>
        </div>
      )}
    </article>
  );
}

function formatCentsToBRL(digitsString) {
  const cents = Number(digitsString || "0");
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function toForm(data) {
  return {
    ...EMPTY_FORM,
    ...data,
    ownerPhone: formatCaptacaoPhone(data.ownerPhone || ""),
    intendedPrice: data.intendedPrice ? String(Math.round(data.intendedPrice * 100)) : ""
  };
}

function formatFullAddress(data) {
  const line1 = [data.street, data.number].filter(Boolean).join(", ");
  const line2 = [data.complement, data.neighborhood].filter(Boolean).join(" - ");
  const line3 = [data.city, data.state].filter(Boolean).join("/");
  const cep = data.cep ? `CEP ${data.cep}` : "";
  return [line1, line2, line3, cep].filter(Boolean).join(" · ") || "Não informado";
}

function FieldGroup({ title, children }) {
  return (
    <div>
      <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-amber-800/70">{title}</p>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}

function InfoLine({ label, value }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 break-words font-extrabold text-navy">{value || "Não informado"}</p>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder, maxLength }) {
  return (
    <label className="grid gap-2 text-sm font-black text-navy">
      {label}
      <input
        className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
