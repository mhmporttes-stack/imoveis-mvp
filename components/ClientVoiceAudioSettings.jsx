"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Switch from "@/components/ui/Switch";
import {
  VOICE_MOMENTS,
  VOICE_MOMENT_LABELS,
  VOICE_TEMPLATE_MAX_CHARS,
  VOICE_VARIANTS,
  VOICE_VARIANT_LABELS,
  isTemplateApproved,
  isVoiceIdValid
} from "@/lib/client-voice-audio-core.mjs";

// Automações › Áudio com voz (VOZ-1, dono 2026-10-23; só admin geral). Liga/desliga (nasce desligado), voice_id da voz
// clonada na ElevenLabs e os 6 textos-modelo. "Ouvir prévia" só toca aqui (nunca envia). Só modelo aprovado é usado;
// editar o texto desaprova (regra no servidor, applyClientVoiceAudioPatch).
const MOMENT_NOTES = {
  simulation: "Sai logo depois da mensagem do link da simulação automática, pelo mesmo WhatsApp.",
  welcome: "Sai pelo WhatsApp do corretor que recebeu o lead novo da roleta, apresentando quem vai atender."
};

async function callApi(method, body) {
  const response = await fetch("/api/admin/client-voice-audio", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir.");
  return payload;
}

export default function ClientVoiceAudioSettings() {
  const [settings, setSettings] = useState(null);
  const [environment, setEnvironment] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [voiceId, setVoiceId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);
  const [preview, setPreview] = useState(null);

  function applySettings(next) {
    setSettings(next);
    setVoiceId(next.voiceId || "");
    const map = {};
    for (const moment of VOICE_MOMENTS) for (const variant of VOICE_VARIANTS) map[`${moment}:${variant}`] = next.templates[moment][variant].text;
    setDrafts(map);
  }

  useEffect(() => {
    callApi("GET")
      .then((payload) => {
        applySettings(payload.settings);
        setEnvironment(payload.environment);
      })
      .catch((error) => setMessage({ ok: false, text: error.message }));
  }, []);

  async function run(key, body, okText) {
    setBusy(key);
    setMessage(null);
    try {
      const payload = await callApi("PATCH", body);
      applySettings(payload.settings);
      if (okText) setMessage({ ok: true, text: okText });
    } catch (error) {
      setMessage({ ok: false, text: error.message });
    } finally {
      setBusy("");
    }
  }

  async function listen(moment, variant) {
    const key = `${moment}:${variant}`;
    setBusy(`preview:${key}`);
    setMessage(null);
    try {
      const payload = await callApi("POST", { moment, variant, text: drafts[key], voiceId });
      setPreview({ key, url: payload.url, text: payload.text });
    } catch (error) {
      setMessage({ ok: false, text: error.message });
    } finally {
      setBusy("");
    }
  }

  if (!settings) {
    return (
      <div className="container-page">
        <Card padding="md">{message ? <p className="text-sm font-bold text-danger">{message.text}</p> : <p className="text-sm text-muted">Carregando…</p>}</Card>
      </div>
    );
  }

  return (
    <div className="container-page space-y-4">
      <Card
        padding="md"
        title="Áudio com a voz do Matheus"
        note="Áudio curto, com a voz clonada, enviado ao cliente com o nome dele. Nunca vai para Não contactar nem telefone bloqueado; um áudio por momento por cliente; sem voz ou sem créditos, só o áudio é pulado."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink">{settings.enabled ? "Ligado" : "Desligado"}</span>
            <Switch
              checked={settings.enabled}
              label="Ligar o envio de áudios com a voz do Matheus"
              disabled={Boolean(busy)}
              onChange={(next) => run("enabled", { enabled: next }, next ? "Áudios ligados (só para clientes daqui para frente)." : "Áudios desligados.")}
            />
          </div>
        }
      >
        {environment && !environment.hasKey ? (
          <p className="mb-3 text-sm font-bold text-danger">Chave da ElevenLabs (ELEVENLABS_API_KEY) não configurada no servidor.</p>
        ) : null}
        <label className="block text-sm font-bold text-ink" htmlFor="voice-id">ID da voz clonada (voice_id da ElevenLabs)</label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            id="voice-id"
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value.trim())}
            placeholder="ex.: 21m00Tcm4TlvDq8ikWAM"
            className="min-h-touch w-full max-w-sm rounded-control border border-line bg-white px-3 text-sm"
          />
          <Button
            variant="secondary"
            loading={busy === "voice"}
            disabled={Boolean(busy) || voiceId === settings.voiceId || (voiceId && !isVoiceIdValid(voiceId))}
            onClick={() => run("voice", { voiceId }, "Voz salva.")}
          >
            Salvar voz
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted">Variáveis dos textos: {"{saudacao}"} (bom dia/boa tarde/boa noite no horário de São Paulo), {"{primeiro_nome_cliente}"} e {"{primeiro_nome_corretor}"}. O sexo vem do primeiro nome; na dúvida ou sem nome, usa o modelo neutro.</p>
        {message ? <p className={`mt-3 text-sm font-bold ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p> : null}
      </Card>

      {VOICE_MOMENTS.map((moment) => (
        <Card key={moment} padding="md" title={VOICE_MOMENT_LABELS[moment]} note={MOMENT_NOTES[moment]}>
          <div className="space-y-4">
            {VOICE_VARIANTS.map((variant) => {
              const key = `${moment}:${variant}`;
              const entry = settings.templates[moment][variant];
              const draft = drafts[key] ?? "";
              const dirty = draft.replace(/\s+/g, " ").trim() !== entry.text;
              const approved = !dirty && isTemplateApproved(entry);
              return (
                <div key={key} className="rounded-control border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-ink">{VOICE_VARIANT_LABELS[variant]}</span>
                    <Badge tone={approved ? "success" : "warning"} dot>{approved ? "Aprovado" : dirty ? "Alterado — salve e aprove" : "Pendente de aprovação"}</Badge>
                  </div>
                  <textarea
                    value={draft}
                    rows={3}
                    maxLength={VOICE_TEMPLATE_MAX_CHARS + 40}
                    onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                    className="w-full rounded-control border border-line bg-white p-2 text-sm"
                    aria-label={`Texto do áudio — ${VOICE_MOMENT_LABELS[moment]}, ${VOICE_VARIANT_LABELS[variant]}`}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" loading={busy === `save:${key}`} disabled={Boolean(busy) || !dirty} onClick={() => run(`save:${key}`, { template: { moment, variant, text: draft } }, "Texto salvo. Ouça e aprove para ele ser usado.")}>
                      Salvar texto
                    </Button>
                    <Button size="sm" variant="secondary" loading={busy === `preview:${key}`} disabled={Boolean(busy) || !isVoiceIdValid(voiceId)} onClick={() => listen(moment, variant)}>
                      Ouvir prévia
                    </Button>
                    <Button size="sm" loading={busy === `approve:${key}`} disabled={Boolean(busy) || dirty || approved} onClick={() => run(`approve:${key}`, { approve: { moment, variant } }, "Modelo aprovado.")}>
                      Aprovar modelo
                    </Button>
                    <span className="text-xs text-muted">{draft.length}/{VOICE_TEMPLATE_MAX_CHARS}</span>
                  </div>
                  {preview?.key === key ? (
                    <div className="mt-2">
                      <audio controls autoPlay src={preview.url} className="w-full max-w-md" />
                      <p className="mt-1 text-xs text-muted">Prévia (não foi enviada a ninguém): “{preview.text}”</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
