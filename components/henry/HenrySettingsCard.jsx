"use client";

import { useEffect, useState } from "react";

// Liga/desliga do assistente de voz "Henry" (docs/BUSINESS_RULES.md HENRY-1). Só o dono consegue ler/gravar (a rota
// /api/admin/henry recusa os demais e "Alterar conta"); para outros perfis o cartão não aparece.
export default function HenrySettingsCard() {
  const [state, setState] = useState({ loaded: false, allowed: false, enabled: false, serverVoice: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/henry", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) }))
      .then(({ ok, data }) => alive && setState({ loaded: true, allowed: ok, enabled: Boolean(data?.enabled), serverVoice: Boolean(data?.serverVoice) }))
      .catch(() => alive && setState((current) => ({ ...current, loaded: true })));
    return () => {
      alive = false;
    };
  }, []);

  if (!state.loaded || !state.allowed) return null;

  const toggle = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/henry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !state.enabled })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível salvar.");
      setState((current) => ({ ...current, enabled: data.enabled }));
      window.location.reload(); // o ícone do canto lê a configuração ao montar
    } catch (saveError) {
      setError(saveError?.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="container-page mt-8 rounded-panel border border-line bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-base font-black text-navy">Assistente de voz Henry (no computador)</p>
          <p className="mt-1 text-sm text-muted">
            Ícone no canto do painel, só para você. Diga “bom dia, Henry” para o relatório do dia ou “Henry, …” com a pergunta. Só consulta — não envia
            nem altera nada. Alt+B deixa no mudo. Funciona no Chrome; o navegador pede o microfone uma vez.
            {state.serverVoice ? "" : " Voz do servidor não configurada: o Henry fala com a voz do navegador."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.enabled ? "border border-line text-navy" : "bg-navy text-white"}`}
        >
          {state.enabled ? "Desligar o Henry" : "Ligar o Henry"}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </section>
  );
}
