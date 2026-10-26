"use client";

import { useEffect, useRef, useState } from "react";
import Field, { inputClasses } from "@/components/ui/Field";
import { henryReserveVoiceChain, pickBestBrowserVoice, pronounceForSpeech } from "@/lib/henry-voice-providers.mjs";
import { HENRY_END_WAIT_EVENT, HENRY_PTT_ONLY_EVENT, HENRY_PTT_ONLY_KEY, readHenryPttOnly } from "@/lib/henry-voice-conversation.mjs";
import HenryLockSettings from "./HenryLockSettings";
import HenryPttShortcutSetting from "./HenryPttShortcutSetting";
import { HENRY_PULSE_INTENSITIES, HENRY_PULSE_TYPES, HENRY_PULSE_TYPE_KEYS } from "@/lib/henry-pulse-core.mjs";
import {
  DESKTOP_WAKE_CUSTOM_MAX_CHARS,
  DESKTOP_WAKE_EVENT,
  DESKTOP_WAKE_KEY,
  DESKTOP_WAKE_STATUS_EVENT,
  DESKTOP_WAKE_WORD_KEY,
  DESKTOP_WAKE_WORD_OPTIONS,
  buildDesktopWakeWord,
  desktopCanSpeakLocal,
  desktopCanWake,
  parseDesktopWakeWord,
  readDesktopWakeSetting,
  readDesktopWakeWord,
  readHenryDesktopBridge
} from "@/lib/henry-desktop-core.mjs";

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
            webSearch: data?.webSearch !== false,
            clientAlerts: data?.clientAlerts !== false,
            teamArrivals: data?.teamArrivals !== false,
            voiceNotices: data?.voiceNotices !== false,
            birthdayAlerts: data?.birthdayAlerts !== false,
            pulse: data?.pulse || null,
            serverVoice: Boolean(data?.serverVoice),
            provider: data?.provider || "browser",
            providerLabel: data?.providerLabel || "voz do navegador",
            elevenVoices: Array.isArray(data?.elevenVoices) ? data.elevenVoices : null,
            elevenVoicesError: data?.elevenVoicesError || "",
            elevenSubscription: data?.elevenSubscription || null,
            elevenSubscriptionError: data?.elevenSubscriptionError || "",
            style: data?.style || null,
            options: data?.options || null,
            spotify: data?.spotify || null
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
      setState((current) => ({ ...current, enabled: data.enabled, vision: data.vision, mobileWake: data.mobileWake === true, webSearch: data.webSearch !== false, clientAlerts: data.clientAlerts !== false, teamArrivals: data.teamArrivals !== false, voiceNotices: data.voiceNotices !== false, birthdayAlerts: data.birthdayAlerts !== false }));
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
            celular, toque no Henry e fale. É seu assistente pessoal: conversa, pesquisa, anota lembretes (“Henry, lembre que…”) e guarda a
            conversa do dia. No CRM só consulta — não envia nem altera nada. Alt+B deixa no mudo. O navegador pede o microfone uma vez.
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
          <p className="text-sm font-black text-navy">Pesquisa na internet</p>
          <p className="mt-1 text-sm text-muted">
            Ligada: quando você pede (“Henry, pesquisa…”) ou quando a pergunta é sobre algo atual (notícia, clima, cotação, endereço), ele busca na
            internet — no máximo 3 buscas por pergunta, cerca de US$ 0,01 cada. As fontes aparecem na tela; ele não lê links em voz alta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => save("webSearch")}
          disabled={Boolean(saving) || !state.enabled}
          className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.webSearch ? "border border-line text-navy" : "bg-navy text-white"}`}
        >
          {state.webSearch ? "Desligar a pesquisa" : "Ligar a pesquisa"}
        </button>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <div className="max-w-2xl">
          <p className="text-sm font-black text-navy">Celular: ouvir “Henry” com o app aberto</p>
          <p className="mt-1 text-sm text-muted">
            Desligado (recomendado): no celular você toca no Henry para falar. Ligado: com o app aberto e na tela, ele fica ouvindo o nome como no
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
          extra={
            <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-control border border-line p-4">
              <div className="max-w-xl">
                <p className="text-sm font-black text-navy">Avisar clientes novos e transferidos</p>
                <p className="mt-1 text-sm text-muted">
                  Com o CRM aberto (no aparelho em que você falou com o Henry por último), ele chama “Chefe?” e espera você responder (“oi”, “pode
                  falar”) para contar quem recebeu o cliente, há quanto tempo ele espera e por quem já passou. “Agora não” guarda o aviso. Só das 7h às
                  22h e fora do mudo. Nada é enviado a cliente nem a corretor.
                </p>
              </div>
              <button
                type="button"
                onClick={() => save("clientAlerts")}
                disabled={Boolean(saving) || !state.enabled}
                className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.clientAlerts ? "border border-line text-navy" : "bg-navy text-white"}`}
              >
                {state.clientAlerts ? "Desligar os avisos" : "Ligar os avisos"}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-control border border-line p-4">
              <div className="max-w-xl">
                <p className="text-sm font-black text-navy">Avisar chegada da equipe</p>
                <p className="mt-1 text-sm text-muted">
                  Quando alguém da equipe chega na imobiliária pela primeira vez no dia (o Wi-Fi de lá detecta), o Henry chama do mesmo jeito e, depois da
                  sua resposta, conta quem chegou. “Liberar hoje” e quem está marcado como ausente não contam. Mesmas regras: 7h às 22h, fora do mudo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => save("teamArrivals")}
                disabled={Boolean(saving) || !state.enabled}
                className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.teamArrivals ? "border border-line text-navy" : "bg-navy text-white"}`}
              >
                {state.teamArrivals ? "Desligar" : "Ligar"}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-control border border-line p-4">
              <div className="max-w-xl">
                <p className="text-sm font-black text-navy">Avisos só por voz (sem card na tela)</p>
                <p className="mt-1 text-sm text-muted">
                  Os avisos informativos da Central de Alertas deixam de aparecer como card na sua tela: o Henry chama (“Ô, patrão?”) e conta quando você
                  responder. “Henry, leia os avisos” fala tudo o que estiver acumulado. Vale só com o Henry ligado neste aparelho, fora do mudo e das 7h às
                  22h — fora disso os cards voltam. As janelas que bloqueiam o CRM continuam na tela.
                </p>
              </div>
              <button
                type="button"
                onClick={() => save("voiceNotices")}
                disabled={Boolean(saving) || !state.enabled}
                className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.voiceNotices ? "border border-line text-navy" : "bg-navy text-white"}`}
              >
                {state.voiceNotices ? "Desligar" : "Ligar"}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-control border border-line p-4">
              <div className="max-w-xl">
                <p className="text-sm font-black text-navy">Avisar aniversariantes</p>
                <p className="mt-1 text-sm text-muted">
                  Uma vez por dia o Henry chama e conta quem faz aniversário hoje e com qual corretor está. Se você disser “sim”, ele mostra na tela o aviso
                  para o corretor — que só sai quando você tocar em “Enviar” (vai para a Central de Alertas e o celular dele, nunca para o cliente). Se o
                  cliente for seu, ele prepara a mensagem para você copiar ou abrir no WhatsApp; o Henry não envia. Mesmas regras: 7h às 22h, fora do mudo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => save("birthdayAlerts")}
                disabled={Boolean(saving) || !state.enabled}
                className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${state.birthdayAlerts ? "border border-line text-navy" : "bg-navy text-white"}`}
              >
                {state.birthdayAlerts ? "Desligar" : "Ligar"}
              </button>
            </div>
            {state.pulse ? <HenryPulseSection saved={state.pulse} disabled={!state.enabled} onSaved={(pulse) => setState((current) => ({ ...current, pulse }))} /> : null}
            </>
          }
        />
      ) : null}
      {state.spotify ? <HenrySpotifySection status={state.spotify} onChange={(spotify) => setState((current) => ({ ...current, spotify }))} /> : null}
      {state.allowed ? <HenryLockSettings /> : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </section>
  );
}

const STYLE_FIELDS = ["voice", "elevenVoice", "tone", "speed", "endWait", "listenAck", "details", "address", "rockMusic", "sertanejoMusic", "morningPlaylist"];
const TEXT_FIELDS = ["details", "address", "rockMusic", "sertanejoMusic", "morningPlaylist"];

// Só o que mudou em relação ao salvo (a voz padrão do servidor pode não estar na lista e não é reenviada).
function changedFields(form, saved) {
  const patch = {};
  for (const key of STYLE_FIELDS) {
    const value = TEXT_FIELDS.includes(key) ? String(form[key] || "").trim() : form[key];
    if (value !== (saved[key] || "")) patch[key] = value;
  }
  return patch;
}

// "Voz e personalidade" (HENRY-1): voz, tom, velocidade, detalhes do jeito de falar e como tratar o dono. Valida e
// sanitiza no servidor (PUT /api/admin/henry, Zod). "Ouvir amostra" = frase curta paga, com o que está na tela.
function HenryVoiceStyleSection({ saved, options, serverVoice, provider = "browser", providerLabel = "", elevenVoices = null, elevenVoicesError = "", elevenSubscription = null, elevenSubscriptionError = "", onSaved, extra = null }) {
  const [form, setForm] = useState(() => ({ ...saved }));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState({ tone: "", text: "" });
  const [desktopApp, setDesktopApp] = useState(false); // app de desktop do dono (desktop-app/): só informa
  // Fase 1.1: "Ouvir 'Henry' sem atalho" — só no app 1.1+ (com onWake), deste PC, nasce ligado.
  const [desktopWake, setDesktopWake] = useState(null);
  useEffect(() => {
    const bridge = readHenryDesktopBridge(window);
    setDesktopApp(Boolean(bridge));
    if (desktopCanWake(bridge)) setDesktopWake(readDesktopWakeSetting(window.localStorage));
  }, []);
  // "Só quando eu apertar" (dono, 2026-10-24): deste aparelho, nasce desligado; o Henry da página ouve o evento.
  const [pttOnly, setPttOnly] = useState(null);
  useEffect(() => {
    const read = () => setPttOnly(readHenryPttOnly(window.localStorage));
    read();
    window.addEventListener(HENRY_PTT_ONLY_EVENT, read);
    return () => window.removeEventListener(HENRY_PTT_ONLY_EVENT, read);
  }, []);
  const togglePttOnly = () => {
    const next = !pttOnly;
    try {
      window.localStorage.setItem(HENRY_PTT_ONLY_KEY, next ? "1" : "0");
    } catch {
      // armazenamento indisponível
    }
    setPttOnly(next);
    window.dispatchEvent(new Event(HENRY_PTT_ONLY_EVENT));
  };
  const toggleDesktopWake = () => {
    const next = !desktopWake;
    window.localStorage.setItem(DESKTOP_WAKE_KEY, next ? "1" : "0");
    setDesktopWake(next);
    window.dispatchEvent(new Event(DESKTOP_WAKE_EVENT));
  };
  // 1.3.0: palavra de chamada do app ("Henry", "Ei Henry", "Ok Henry" ou livre), deste PC. O app confere no vocabulário
  // do modelo e responde qual está usando (evento DESKTOP_WAKE_STATUS_EVENT).
  const [wakeWord, setWakeWord] = useState({ id: "henry", text: "" });
  const [wakeWordSaved, setWakeWordSaved] = useState("henry");
  const [wakeWordStatus, setWakeWordStatus] = useState(null);
  const [wakeWordError, setWakeWordError] = useState("");
  useEffect(() => {
    const saved = readDesktopWakeWord(window.localStorage);
    setWakeWordSaved(saved);
    setWakeWord(parseDesktopWakeWord(saved));
    const onStatus = (event) => setWakeWordStatus(event?.detail || null);
    window.addEventListener(DESKTOP_WAKE_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(DESKTOP_WAKE_STATUS_EVENT, onStatus);
  }, []);
  const wakeWordValue = buildDesktopWakeWord(wakeWord.id, wakeWord.text);
  const saveWakeWord = () => {
    if (!wakeWordValue) {
      setWakeWordError("Escreva a palavra (até 3 palavras, só letras).");
      return;
    }
    setWakeWordError("");
    setWakeWordStatus(null);
    window.localStorage.setItem(DESKTOP_WAKE_WORD_KEY, wakeWordValue);
    setWakeWordSaved(wakeWordValue);
    window.dispatchEvent(new Event(DESKTOP_WAKE_EVENT));
  };
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
      // O Henry desta página passa a usar o novo tempo de espera do fim da fala sem recarregar.
      if (Number.isFinite(data?.endWaitMs)) window.dispatchEvent(new CustomEvent(HENRY_END_WAIT_EVENT, { detail: { ms: data.endWaitMs, listenAck: data.listenAck !== false } }));
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
      if (data.voiceError) setMessage({ tone: "error", text: `${data.voiceError} Tocando com a voz de reserva.` });
      // Sem áudio do servidor: mesma ordem de reserva da fala (henryReserveVoiceChain) — Piper do PC no app, depois navegador.
      const bridge = readHenryDesktopBridge(window);
      const [reserve] = henryReserveVoiceChain({ desktopLocalVoice: desktopCanSpeakLocal(bridge) });
      const local = !data.audio?.base64 && reserve === "piper-local" && data.text ? await Promise.resolve(bridge.speakLocal(pronounceForSpeech(data.text))).catch(() => null) : null;
      const audio = data.audio?.base64 ? data.audio : local?.ok ? local.audio : null;
      if (audio?.base64) {
        audioRef.current = new Audio(`data:${audio.contentType || "audio/mpeg"};base64,${audio.base64}`);
        await audioRef.current.play();
      } else if (window.speechSynthesis && data.text) {
        const utterance = new SpeechSynthesisUtterance(pronounceForSpeech(data.text));
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
      {extra}
      <p className="mt-2 max-w-2xl text-sm text-muted">Para interromper, fale &quot;para&quot; ou &quot;Henry&quot;. Com fone de ouvido funciona ainda melhor.</p>
      {desktopApp ? (
        <p className="mt-2 max-w-2xl rounded-control bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800" role="status">
          Rodando no app de desktop: microfone liberado, som sem clique e Ctrl+Shift+H chama o Henry.
        </p>
      ) : null}
      {pttOnly !== null ? (
        <div className="mt-3 flex max-w-2xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-navy">Só quando eu apertar</p>
            <p className="mt-1 text-sm text-muted">
              Ligado: o Henry não fica escutando — só ouve enquanto você segura Enter, Ctrl+Shift+H ou o microfone (o “Henry” sem atalho do app também para). Os avisos continuam chamando; para responder, aperte. Vale para este aparelho.
            </p>
          </div>
          <button
            type="button"
            onClick={togglePttOnly}
            aria-pressed={pttOnly}
            className={`rounded-control px-5 py-2.5 text-sm font-bold ${pttOnly ? "border border-line text-navy" : "bg-navy text-white"}`}
          >
            {pttOnly ? "Desligar" : "Ligar"}
          </button>
        </div>
      ) : null}
      <HenryPttShortcutSetting saved={saved?.pttShortcut || ""} onSaved={onSaved} />
      {desktopApp && desktopWake !== null ? (
        <div className="mt-3 flex max-w-2xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-navy">Ouvir “Henry” sem atalho</p>
            <p className="mt-1 text-sm text-muted">
              Ligado: o app fica ouvindo só o nome, no próprio PC (o som não sai do computador e não é gravado). Desligado: chame por Ctrl+Shift+H ou toque no Henry.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleDesktopWake}
            aria-pressed={desktopWake}
            className={`rounded-control px-5 py-2.5 text-sm font-bold ${desktopWake ? "border border-line text-navy" : "bg-navy text-white"}`}
          >
            {desktopWake ? "Desligar" : "Ligar"}
          </button>
        </div>
      ) : null}
      {desktopApp && desktopWake ? (
        <div className="mt-3 max-w-2xl">
          <p className="text-sm font-black text-navy">Palavra de chamada</p>
          <p className="mt-1 text-sm text-muted">Vale só neste app. Se o app não conhecer alguma palavra, ele continua ouvindo “Henry” e avisa aqui.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={wakeWord.id}
              onChange={(event) => setWakeWord((current) => ({ ...current, id: event.target.value }))}
              className="rounded-control border border-line bg-white px-3 py-2 text-sm text-navy"
              aria-label="Palavra de chamada"
            >
              {DESKTOP_WAKE_WORD_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            {wakeWord.id === "custom" ? (
              <input
                type="text"
                value={wakeWord.text}
                maxLength={DESKTOP_WAKE_CUSTOM_MAX_CHARS}
                onChange={(event) => setWakeWord((current) => ({ ...current, text: event.target.value }))}
                placeholder="Ex.: Jarvis"
                className="rounded-control border border-line bg-white px-3 py-2 text-sm text-navy"
                aria-label="Palavra livre"
              />
            ) : null}
            <button
              type="button"
              onClick={saveWakeWord}
              disabled={wakeWordValue === wakeWordSaved}
              className="rounded-control bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              Usar esta
            </button>
          </div>
          {wakeWordError ? <p className="mt-1 text-sm font-bold text-red-700">{wakeWordError}</p> : null}
          {wakeWordStatus ? (
            <p className={`mt-1 text-sm font-bold ${wakeWordStatus.ok ? "text-emerald-800" : "text-amber-800"}`} role="status">
              {wakeWordStatus.ok
                ? `O app está ouvindo “${wakeWordStatus.label}”.`
                : `O app não conhece ${wakeWordStatus.missing?.length ? `“${wakeWordStatus.missing.join(" ")}”` : "essa palavra"}: continua ouvindo “Henry”.`}
            </p>
          ) : null}
        </div>
      ) : null}
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
        {options.endWaits?.length ? (
          <Field label="Tempo de espera do fim da fala" hint="Quanto silêncio o Henry espera antes de entender que você terminou de falar.">
            <select className={inputClasses} value={form.endWait || "normal"} onChange={update("endWait")}>
              {options.endWaits.map((wait) => (
                <option key={wait.id} value={wait.id}>
                  {wait.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {options.listenAcks?.length ? (
          <Field label="Confirmar que ouviu" hint="Logo que você termina de falar, ele faz um som curto, um “Uhum” ou um “Já te falo” enquanto busca a resposta.">
            <select className={inputClasses} value={form.listenAck || "on"} onChange={update("listenAck")}>
              {options.listenAcks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
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
        <Field label="Playlist do bom dia" hint="Tocada (em ordem aleatória) quando você deixa o Henry escolher. Nome de uma playlist sua ou link do Spotify. Em branco = Rock Blues Animadas.">
          <input className={inputClasses} value={form.morningPlaylist || ""} onChange={update("morningPlaylist")} maxLength={options.musicMax} placeholder={options.defaultMorningPlaylist} />
        </Field>
        <Field label="Bom dia: música do rock (opcional)" hint="Nome da playlist ou link do Spotify. Em branco = playlist de rock clássico.">
          <input className={inputClasses} value={form.rockMusic || ""} onChange={update("rockMusic")} maxLength={options.musicMax} placeholder={options.defaultRockMusic} />
        </Field>
        <Field label="Bom dia: música do sertanejo raiz (opcional)" hint="Nome da playlist ou link do Spotify. Em branco = Zezé Di Camargo & Luciano.">
          <input className={inputClasses} value={form.sertanejoMusic || ""} onChange={update("sertanejoMusic")} maxLength={options.musicMax} placeholder={options.defaultSertanejoMusic} />
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

// Spotify do Henry (HENRY-1, só o dono): Conectar leva à autorização do Spotify (rota /api/admin/henry/spotify/connect, que
// volta para cá com ?spotify=conectado|negado|erro); Desconectar apaga o acesso guardado no servidor.
const SPOTIFY_RETURN_MESSAGES = {
  conectado: { tone: "ok", text: "Spotify conectado." },
  negado: { tone: "error", text: "Conexão com o Spotify cancelada." },
  erro: { tone: "error", text: "Não foi possível conectar o Spotify. Tente de novo." }
};

function HenrySpotifySection({ status, onChange }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: "", text: "" });
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("spotify");
    if (SPOTIFY_RETURN_MESSAGES[result]) setMessage(SPOTIFY_RETURN_MESSAGES[result]);
  }, []);

  const disconnect = async () => {
    setBusy(true);
    setMessage({ tone: "", text: "" });
    try {
      const response = await fetch("/api/admin/henry/spotify/connect", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível desconectar.");
      onChange({ ...status, connected: false, account: "" });
      setMessage({ tone: "ok", text: "Spotify desconectado." });
    } catch (disconnectError) {
      setMessage({ tone: "error", text: disconnectError?.message || "Não foi possível desconectar." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
      <div className="max-w-2xl">
        <p className="text-sm font-black text-navy">Spotify</p>
        <p className="mt-1 text-sm text-muted">
          “Henry, toca…”, pausar, continuar, próxima, anterior, volume e “que música é essa?” no seu Spotify Premium, no aparelho em que ele estiver aberto.
        </p>
        <p className={`mt-2 text-sm font-bold ${status.connected ? "text-emerald-700" : "text-muted"}`} role="status">
          {!status.configured
            ? "Não configurado: cadastre SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET na Vercel. Até lá, o Henry abre a busca no Spotify do navegador."
            : status.connected
              ? `Conectado${status.account ? ` (${status.account})` : ""}.`
              : status.error || "Não conectado."}
        </p>
        {message.text ? <p className={`mt-1 text-sm font-bold ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`}>{message.text}</p> : null}
      </div>
      {status.configured ? (
        status.connected ? (
          <button type="button" onClick={disconnect} disabled={busy} className="rounded-control border border-line px-5 py-2.5 text-sm font-bold text-navy disabled:opacity-60">
            {busy ? "Desconectando…" : "Desconectar"}
          </button>
        ) : (
          <a href="/api/admin/henry/spotify/connect" className="rounded-control bg-navy px-5 py-2.5 text-sm font-bold text-white">
            Conectar
          </a>
        )
      ) : null}
    </div>
  );
}

// "Pulso do CRM" (rascunho HENRY-1 "Pulso", [PENDENTE DE VALIDAÇÃO]): na tela cheia do Henry, cards com eventos reais do
// CRM em volta do anel. Nasce DESLIGADO até o dono aprovar o visual. Grava em henry_voice_assistant.pulse
// (PUT /api/admin/henry { pulse }, validado por parseHenryPulsePatch). O ícone do canto lê a configuração ao montar.
function HenryPulseSection({ saved, disabled = false, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const save = async (patch) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/henry", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pulse: patch }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível salvar.");
      onSaved?.(data.pulse);
      setMessage("Salvo. Recarregue a página para ver no Henry.");
    } catch (saveError) {
      setMessage(saveError?.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };
  const toggleType = (key) => {
    const types = saved.types.includes(key) ? saved.types.filter((item) => item !== key) : [...saved.types, key];
    save({ types: HENRY_PULSE_TYPE_KEYS.filter((item) => types.includes(item)) });
  };
  return (
    <div className="mt-4 rounded-control border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-sm font-black text-navy">Pulso do CRM</p>
          <p className="mt-1 text-sm text-muted">
            Na tela cheia do Henry, o que a equipe está fazendo aparece em volta dele: mensagens, clientes novos, simulações, envios à CCA, chegadas e
            pontos. Só para você; só mostra primeiro nome e um trecho curto da mensagem (nunca telefone, CPF ou documento). Tocar no card abre a
            conversa ou o cliente. Conversas particulares, grupos e internas ficam de fora.
          </p>
        </div>
        <button
          type="button"
          onClick={() => save({ enabled: !saved.enabled })}
          disabled={busy || disabled}
          className={`rounded-control px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${saved.enabled ? "border border-line text-navy" : "bg-navy text-white"}`}
        >
          {saved.enabled ? "Desligar" : "Ligar"}
        </button>
      </div>
      {saved.enabled ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Intensidade">
            <select className={inputClasses} value={saved.intensity} disabled={busy} onChange={(event) => save({ intensity: event.target.value })}>
              {Object.entries(HENRY_PULSE_INTENSITIES).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end text-sm font-bold text-navy">
            <input type="checkbox" checked={saved.snippets} disabled={busy} onChange={() => save({ snippets: !saved.snippets })} />
            Mostrar trecho da mensagem
          </label>
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-bold text-navy">Tipos de evento</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              {HENRY_PULSE_TYPE_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm text-navy">
                  <input type="checkbox" checked={saved.types.includes(key)} disabled={busy} onChange={() => toggleType(key)} />
                  <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: HENRY_PULSE_TYPES[key].color }} />
                  {HENRY_PULSE_TYPES[key].label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm font-bold text-muted" role="status">{message}</p> : null}
    </div>
  );
}
