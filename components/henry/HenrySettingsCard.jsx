"use client";

import { useEffect, useRef, useState } from "react";
import Field, { inputClasses } from "@/components/ui/Field";
import { pickBestBrowserVoice } from "@/lib/henry-voice-providers.mjs";

// Liga/desliga do assistente de voz "Henry" (docs/BUSINESS_RULES.md HENRY-1) e da visão pela webcam (HENRY-2, nasce
// desligada). Só o dono consegue ler/gravar (a rota /api/admin/henry recusa os demais e "Alterar conta"); para outros
// perfis o cartão não aparece.
export default function HenrySettingsCard() {
  const [state, setState] = useState({ loaded: false, allowed: false, enabled: false, vision: false, serverVoice: false, style: null, options: null });
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/henry?vozes=1", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) }))
      .then(
        ({ ok, data }) =>
          alive &&
          setState({
            loaded: true,
            allowed: ok,
            enabled: Boolean(data?.enabled),
            vision: data?.vision === true,
            mobileWake: data?.mobileWake === true,
            serverVoice: Boolean(data?.serverVoice),
            provider: data?.provider || "browser",
            providerLabel: data?.providerLabel || "voz do navegador",
            elevenVoices: Array.isArray(data?.elevenVoices) ? data.elevenVoices : null,
            elevenVoicesError: data?.elevenVoicesError || "",
            elevenSubscription: data?.elevenSubscription || null,
            elevenSubscriptionError: data?.elevenSubscriptionError || "",
            style: data?.style || null,
            options: data?.options || null
          })
      )
      .catch(() => alive && setState((current) => ({ ...current, loaded: true })));
    return () => {
      alive = false;
    };
  }, []);

  if (!state.loaded || !state.allowed) return null;

  const save = async (key) => {
    setSaving(key);
    setError("");
    try {
      const response = await fetch("/api/admin/henry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: !state[key] })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível salvar.");
      setState((current) => ({ ...current, enabled: data.enabled, vision: data.vision, mobileWake: data.mobileWake === true }));
      window.location.reload(); // o ícone do canto lê a configuração ao montar
    } catch (saveError) {
      setError(saveError?.message || "Não foi possível salvar.");
    } finally {
      setSaving("");
    }
  };

  return (
    <section className="container-page mt-8 rounded-panel border border-line bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-base font-black text-navy">Assistente de voz Henry (computador e celular)</p>
          <p className="mt-1 text-sm text-muted">
            Ícone no canto do painel, só para você. No computador, diga “bom dia, Henry” para o relatório do dia ou “Henry, …” com a pergunta. No
            celular, toque no anel e fale. Só consulta — não envia nem altera nada. Alt+B deixa no mudo. O navegador pede o microfone uma vez.
            {state.serverVoice ? "" : " Voz do servidor não configurada: o Henry fala com a voz do navegador."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => save("enabled")}
          disabled={Boolean(saving)}
          className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.enabled ? "border border-line text-navy" : "bg-navy text-white"}`}
        >
          {state.enabled ? "Desligar o Henry" : "Ligar o Henry"}
        </button>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <div className="max-w-2xl">
          <p className="text-sm font-black text-navy">Visão (webcam)</p>
          <p className="mt-1 text-sm text-muted">
            No “bom dia, Henry” ele tira uma foto rápida e elogia a sua roupa antes do relatório; em “Henry, o que é isso?” ele olha o que você mostra.
            A câmera só liga nesses momentos (a luz acende por um segundo) e a imagem nunca é guardada. O navegador pede a câmera uma vez.
          </p>
        </div>
        <button
          type="button"
          onClick={() => save("vision")}
          disabled={Boolean(saving) || !state.enabled}
          className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.vision ? "border border-line text-navy" : "bg-navy text-white"}`}
        >
          {state.vision ? "Desligar a visão" : "Ligar a visão"}
        </button>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <div className="max-w-2xl">
          <p className="text-sm font-black text-navy">Celular: ouvir “Henry” com o app aberto</p>
          <p className="mt-1 text-sm text-muted">
            Desligado (recomendado): no celular você toca no anel para falar. Ligado: com o app aberto e na tela, ele fica ouvindo o nome como no
            computador — gasta mais bateria e alguns celulares param de ouvir sozinhos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => save("mobileWake")}
          disabled={Boolean(saving) || !state.enabled}
          className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.mobileWake ? "border border-line text-navy" : "bg-navy text-white"}`}
        >
          {state.mobileWake ? "Desligar" : "Ligar"}
        </button>
      </div>
      {state.style && state.options ? (
        <HenryVoiceStyleSection
          saved={state.style}
          options={state.options}
          serverVoice={state.serverVoice}
          provider={state.provider}
          providerLabel={state.providerLabel}
          elevenVoices={state.elevenVoices}
          elevenVoicesError={state.elevenVoicesError}
          elevenSubscription={state.elevenSubscription}
          elevenSubscriptionError={state.elevenSubscriptionError}
          onSaved={(style) => setState((current) => ({ ...current, style }))}
        />
      ) : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </section>
  );
}

const STYLE_FIELDS = ["voice", "elevenVoice", "tone", "speed", "details", "address"];

// Só o que mudou em relação ao salvo (a voz padrão do servidor pode não estar na lista e não é reenviada).
function changedFields(form, saved) {
  const patch = {};
  for (const key of STYLE_FIELDS) {
    const value = key === "details" || key === "address" ? String(form[key] || "").trim() : form[key];
    if (value !== (saved[key] || "")) patch[key] = value;
  }
  return patch;
}

// "Voz e personalidade" (HENRY-1): voz, tom, velocidade, detalhes do jeito de falar e como tratar o dono. Valida e
// sanitiza no servidor (PUT /api/admin/henry, Zod). "Ouvir amostra" = frase curta paga, com o que está na tela.
function HenryVoiceStyleSection({ saved, options, serverVoice, provider = "browser", providerLabel = "", elevenVoices = null, elevenVoicesError = "", elevenSubscription = null, elevenSubscriptionError = "", onSaved }) {
  const [form, setForm] = useState(() => ({ ...saved }));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState({ tone: "", text: "" });
  const audioRef = useRef(null);
  const patch = changedFields(form, saved);
  const dirty = Object.keys(patch).length > 0;
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async () => {
    setBusy("save");
    setMessage({ tone: "", text: "" });
    try {
      const response = await fetch("/api/admin/henry", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: patch }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível salvar.");
      onSaved(data.style);
      setForm({ ...data.style });
      setMessage({ tone: "ok", text: "Salvo. Vale a partir da próxima fala do Henry (recarregue a página para a voz do navegador)." });
    } catch (saveError) {
      setMessage({ tone: "error", text: saveError?.message || "Não foi possível salvar." });
    } finally {
      setBusy("");
    }
  };

  const playSample = async () => {
    setBusy("sample");
    setMessage({ tone: "", text: "" });
    try {
      const response = await fetch("/api/admin/henry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "sample", style: patch }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não consegui tocar a amostra.");
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      // Voz do servidor falhou (ex.: chave sem permissão): mostra o motivo e toca com a voz do navegador.
      if (data.voiceError) setMessage({ tone: "error", text: `${data.voiceError} Tocando com a voz do navegador.` });
      if (data.audio?.base64) {
        audioRef.current = new Audio(`data:${data.audio.contentType || "audio/mpeg"};base64,${data.audio.base64}`);
        await audioRef.current.play();
      } else if (window.speechSynthesis && data.text) {
        const utterance = new SpeechSynthesisUtterance(data.text);
        utterance.lang = "pt-BR";
        utterance.rate = Number(data.browserRate) || 1;
        const voice = pickBestBrowserVoice(window.speechSynthesis.getVoices());
        if (voice) utterance.voice = voice;
        window.speechSynthesis.speak(utterance);
      }
    } catch (sampleError) {
      setMessage({ tone: "error", text: sampleError?.message || "Não consegui tocar a amostra." });
    } finally {
      setBusy("");
    }
  };

  const detailsLength = String(form.details || "").length;

  return (
    <div className="mt-5 border-t border-line pt-5">
      <p className="text-sm font-black text-navy">Voz e personalidade</p>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Escolha a voz, o tom e a velocidade do Henry. Isso muda só o jeito de falar: ele continua só consultando, só para você, e sem falar dados sensíveis.
      </p>
      <p className={`mt-2 max-w-2xl rounded-control px-3 py-2 text-sm font-bold ${provider === "browser" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`} role="status">
        Voz ativa: {providerLabel}.
        {provider === "browser" ? " Voz do navegador: configure ELEVENLABS_API_KEY na Vercel para a voz natural." : ""}
        {provider === "openai" ? " Para a voz mais natural, configure ELEVENLABS_API_KEY na Vercel." : ""}
      </p>
      {provider === "elevenlabs" && (elevenSubscription || elevenSubscriptionError) ? (
        <p className={`mt-1 text-sm ${elevenSubscriptionError ? "font-bold text-red-700" : "text-muted"}`}>
          {elevenSubscriptionError ||
            `Saldo da ElevenLabs: ${elevenSubscription.remaining.toLocaleString("pt-BR")} de ${elevenSubscription.limit.toLocaleString("pt-BR")} caracteres neste ciclo.`}
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="flex items-end gap-2">
          {provider === "elevenlabs" ? (
            <Field className="min-w-0 flex-1" label="Voz (sua conta ElevenLabs)" error={elevenVoicesError}>
              <select className={inputClasses} value={form.elevenVoice || ""} onChange={update("elevenVoice")}>
                <option value="">Padrão (a 1ª que fala português)</option>
                {(elevenVoices || []).map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.portuguese ? "★ " : ""}
                    {voice.name}
                    {voice.note ? ` — ${voice.note}` : ""}
                    {voice.portuguese ? " (fala português)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          ) : provider === "openai" ? (
            <Field className="min-w-0 flex-1" label="Voz">
              <select className={inputClasses} value={form.voice} onChange={update("voice")}>
                {options.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label} — {voice.note}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="min-w-0 flex-1 text-sm text-muted">Sem voz do servidor: o Henry usa a melhor voz em português do navegador (no Edge, as “Natural” soam melhor).</p>
          )}
          <button
            type="button"
            onClick={playSample}
            disabled={Boolean(busy)}
            className="min-h-touch shrink-0 rounded-control border border-line px-4 text-sm font-bold text-navy disabled:opacity-60"
          >
            {busy === "sample" ? "Tocando…" : "Ouvir amostra"}
          </button>
        </div>
        <Field label="Tom">
          <select className={inputClasses} value={form.tone} onChange={update("tone")}>
            {options.tones.map((tone) => (
              <option key={tone.id} value={tone.id}>
                {tone.label} — {tone.note}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Velocidade da fala">
          <select className={inputClasses} value={form.speed} onChange={update("speed")}>
            {options.speeds.map((speed) => (
              <option key={speed.id} value={speed.id}>
                {speed.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Como tratar você (opcional)" hint={`Em branco = “${options.defaultAddress}”. Ex.: chefe, Sr. Matheus.`}>
          <input className={inputClasses} value={form.address || ""} onChange={update("address")} maxLength={options.addressMax} placeholder={options.defaultAddress} />
        </Field>
        <Field
          className="md:col-span-2"
          label="Detalhes do jeito de falar (opcional)"
          hint={`${detailsLength}/${options.detailsMax} — ex.: “fale um pouco mais devagar nos números”, “use frases bem curtas”.`}
        >
          <textarea
            className={`${inputClasses} min-h-[80px] py-2`}
            value={form.details || ""}
            onChange={update("details")}
            maxLength={options.detailsMax}
            rows={2}
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || Boolean(busy)}
          className="rounded-control bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy === "save" ? "Salvando…" : "Salvar voz e personalidade"}
        </button>
        {message.text ? <p className={`text-sm font-bold ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`}>{message.text}</p> : null}
      </div>
    </div>
  );
}
