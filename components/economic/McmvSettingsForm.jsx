"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClasses } from "@/components/ui/Field";
import { MCMV_MAX_FAIXAS, normalizeMcmvSettings } from "@/lib/economic-indicators-core.mjs";

// Cadastro manual do MCMV para a tira do Radar Econômico (dono, 2026-10-29 — ECON-2). Só o administrador geral vê esta
// parte (a página decide; a API /api/admin/economic-indicators/mcmv barra os demais). Nada é calculado nem buscado: o
// Radar mostra exatamente o que estiver aqui, com a portaria e a data. Apagar todas as faixas tira o MCMV do Radar.
const EMPTY_FAIXA = { nome: "", rendaAte: "", tetoImovel: "" };
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function toForm(mcmv) {
  return {
    portaria: mcmv?.portaria || "",
    portariaData: mcmv?.portariaData || "",
    faixas: mcmv?.faixas?.length ? mcmv.faixas.map((f) => ({ nome: f.nome, rendaAte: f.rendaAte ?? "", tetoImovel: f.tetoImovel ?? "" })) : [{ ...EMPTY_FAIXA }]
  };
}

export default function McmvSettingsForm({ initial = null }) {
  const [form, setForm] = useState(() => toForm(initial));
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const setFaixa = (index, key, value) => setForm((f) => ({ ...f, faixas: f.faixas.map((item, i) => (i === index ? { ...item, [key]: value } : item)) }));

  async function save(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const check = normalizeMcmvSettings(form);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/economic-indicators/mcmv", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      setSaved(payload.mcmv);
      setForm(toForm(payload.mcmv));
      setMessage(payload.mcmv ? "Salvo. O Radar mostra em até 1 minuto." : "Cadastro apagado. O MCMV saiu do Radar.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Faixas e teto do MCMV" note={saved?.updatedAt ? `Última alteração: ${DATE_TIME.format(new Date(saved.updatedAt))}` : "Ainda não cadastrado — o Radar não mostra o MCMV."}>
      <form className="grid gap-4" onSubmit={save} noValidate>
        <p className="rounded-chip border border-line bg-mist px-3 py-2 text-xs text-ink-2">
          Copie os valores da portaria oficial vigente. O CRM não confere nem atualiza estes números sozinho.
        </p>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Portaria" hint="Ex.: Portaria MCID nº 000/2026" required>
            <input className={inputClasses} value={form.portaria} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, portaria: e.target.value }))} />
          </Field>
          <Field label="Data da portaria" required>
            <input type="date" className={inputClasses} value={form.portariaData} onChange={(e) => setForm((f) => ({ ...f, portariaData: e.target.value }))} />
          </Field>
        </div>
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-bold text-ink">Faixas</legend>
          {form.faixas.map((faixa, index) => (
            <div key={index} className="grid items-end gap-2 rounded-card border border-line p-3 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
              <Field label={`Nome da faixa ${index + 1}`}>
                <input className={inputClasses} value={faixa.nome} maxLength={40} placeholder="Faixa 1" onChange={(e) => setFaixa(index, "nome", e.target.value)} />
              </Field>
              <Field label="Renda familiar até (R$)">
                <input inputMode="decimal" className={inputClasses} value={faixa.rendaAte} onChange={(e) => setFaixa(index, "rendaAte", e.target.value)} />
              </Field>
              <Field label="Teto do imóvel (R$)">
                <input inputMode="decimal" className={inputClasses} value={faixa.tetoImovel} onChange={(e) => setFaixa(index, "tetoImovel", e.target.value)} />
              </Field>
              <Button variant="danger-ghost" size="sm" aria-label={`Remover faixa ${index + 1}`} onClick={() => setForm((f) => ({ ...f, faixas: f.faixas.length > 1 ? f.faixas.filter((_, i) => i !== index) : [{ ...EMPTY_FAIXA }] }))}>
                Remover
              </Button>
            </div>
          ))}
          {form.faixas.length < MCMV_MAX_FAIXAS ? (
            <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setForm((f) => ({ ...f, faixas: [...f.faixas, { ...EMPTY_FAIXA }] }))}>
              Adicionar faixa
            </Button>
          ) : null}
        </fieldset>
        {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
        {message ? <p role="status" className="text-sm font-medium text-success">{message}</p> : null}
        <Button type="submit" loading={saving} className="justify-self-start">Salvar no Radar</Button>
      </form>
    </Card>
  );
}
