"use client";

import { useMemo, useState } from "react";
import { Mic, Send } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClasses } from "@/components/ui/Field";
import Switch from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" }
];

const REASONS = {
  alexa_inativa: "a Alexa está desativada",
  evento_inativo: "o evento está desligado",
  dia_nao_permitido: "hoje não é um dia permitido",
  fora_do_horario: "está fora do horário permitido"
};

function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export default function AlexaSettings({ initialSettings, initialMeta, env, events }) {
  const [settings, setSettings] = useState(initialSettings);
  const [saved, setSaved] = useState(initialSettings);
  const [meta, setMeta] = useState(initialMeta);
  const [saving, setSaving] = useState(false);
  const [testPhrase, setTestPhrase] = useState("");
  const [testing, setTesting] = useState(false);
  const [notify, toastElement] = useToast();

  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(saved), [settings, saved]);
  const envReady = env.voiceEnabledEnv && env.tokenConfigured && env.deviceConfigured;

  function patch(partial) {
    setSettings((current) => ({ ...current, ...partial }));
  }

  function patchEvent(key, partial) {
    setSettings((current) => ({ ...current, events: { ...current.events, [key]: { ...current.events[key], ...partial } } }));
  }

  function toggleWeekday(day) {
    const has = settings.allowedWeekdays.includes(day);
    patch({ allowedWeekdays: has ? settings.allowedWeekdays.filter((item) => item !== day) : [...settings.allowedWeekdays, day].sort() });
  }

  function numberValue(value) {
    return value === "" ? "" : Number(value);
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/alexa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível salvar.", "danger");
        return;
      }
      setSettings(data.settings);
      setSaved(data.settings);
      setMeta((current) => ({ ...current, updatedAt: new Date().toISOString() }));
      notify("Configurações da Alexa salvas.");
    } catch {
      notify("Não foi possível salvar. Verifique a conexão.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const response = await fetch("/api/admin/alexa/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase: testPhrase })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.error || "Não foi possível falar na Alexa.", "danger");
        return;
      }
      setMeta((current) => ({ ...current, lastTestAt: data.sentAt }));
      notify("Frase enviada ao Echo Dot.");
    } catch {
      notify("Não foi possível falar na Alexa. Verifique a conexão.", "danger");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="container-page space-y-4 pb-24">
      <header className="flex items-start gap-3">
        <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-info-soft text-info">
          <Mic className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Alexa</h1>
          <p className="mt-1 text-sm text-muted">Defina quando e o que o Echo Dot do escritório fala sozinho. Somente leitura: a Alexa nunca altera o CRM.</p>
        </div>
      </header>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Alexa ativa</h2>
            <p className="text-sm text-muted">{settings.enabled ? "Pode falar, respeitando as regras abaixo." : "Desativada: nenhuma fala espontânea."}</p>
          </div>
          <Switch checked={settings.enabled} onChange={(value) => patch({ enabled: value })} label="Alexa ativa" />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Badge tone={env.tokenConfigured ? "success" : "danger"} dot>{env.tokenConfigured ? "Token configurado" : "Token ausente"}</Badge>
          <Badge tone={env.deviceConfigured ? "success" : "danger"} dot>{env.deviceConfigured ? "Dispositivo configurado" : "Dispositivo ausente"}</Badge>
          <Badge tone={env.voiceEnabledEnv ? "success" : "danger"} dot>{env.voiceEnabledEnv ? "Servidor liberado" : "Servidor desligado"}</Badge>
          {meta.lastSpokenAt ? <span className="text-xs text-muted">Última fala: {formatDateTime(meta.lastSpokenAt)}</span> : null}
        </div>
        <p className="text-xs text-muted">
          As credenciais do Voice Monkey ficam protegidas nas variáveis da Vercel. O CRM nunca as guarda nem as exibe.
          {envReady ? "" : " Enquanto algum item estiver ausente, a Alexa não fala."}
        </p>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-ink">Quando pode falar</h2>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Dias da semana</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const on = settings.allowedWeekdays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleWeekday(day.value)}
                  className={cx(
                    "min-h-touch min-w-14 rounded-control border px-3 text-sm font-medium transition-colors",
                    on ? "border-brand bg-brand text-white" : "border-line bg-white text-ink-2 hover:bg-mist"
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Horário inicial" hint="Horário de Brasília.">
            <input type="time" className={inputClasses} value={settings.startTime} onChange={(event) => patch({ startTime: event.target.value })} />
          </Field>
          <Field label="Horário final" hint="Se for menor que o inicial, vale até a madrugada seguinte.">
            <input type="time" className={inputClasses} value={settings.endTime} onChange={(event) => patch({ endTime: event.target.value })} />
          </Field>
          <Field label="Intervalo mínimo entre falas (segundos)" hint="0 = sem intervalo.">
            <input
              type="number"
              min={0}
              max={3600}
              inputMode="numeric"
              className={inputClasses}
              value={settings.minIntervalSeconds}
              onChange={(event) => patch({ minIntervalSeconds: numberValue(event.target.value) })}
            />
          </Field>
        </div>
      </Card>

      <section className="space-y-3" aria-label="Eventos">
        <h2 className="text-base font-semibold text-ink">O que a Alexa fala</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {events.map((event) => {
            const config = settings.events[event.key];
            return (
              <Card key={event.key} className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-base font-semibold text-ink">{event.label}</h3>
                    <p className="text-sm text-muted">{event.description}</p>
                    <Badge tone={event.connected ? "success" : "neutral"} dot>
                      {event.connected ? "Conectado ao CRM" : "Preparado — ainda não conectado"}
                    </Badge>
                  </div>
                  <Switch checked={config.enabled} onChange={(value) => patchEvent(event.key, { enabled: value })} label={`${event.label} ligado`} />
                </div>

                <Field label="Frase" hint={`Até 160 caracteres. Variáveis: ${event.variables.map((variable) => `{${variable.name}}`).join(", ")}.`}>
                  <input
                    type="text"
                    maxLength={160}
                    className={inputClasses}
                    value={config.phrase}
                    onChange={(inputEvent) => patchEvent(event.key, { phrase: inputEvent.target.value })}
                  />
                </Field>
                <div className="-mt-2 flex flex-wrap gap-1.5">
                  {event.variables.map((variable) => (
                    <button
                      key={variable.name}
                      type="button"
                      title={variable.label}
                      onClick={() => patchEvent(event.key, { phrase: `${config.phrase}${config.phrase.endsWith(" ") ? "" : " "}{${variable.name}}`.trim() })}
                      className="rounded-chip border border-line bg-mist px-2 py-0.5 text-xs text-ink-2 hover:bg-neutral-soft"
                    >
                      + {`{${variable.name}}`}
                    </button>
                  ))}
                </div>

                {event.key === "upcoming_meeting" ? (
                  <Field label="Antecedência (minutos)" hint="Quantos minutos antes da reunião a Alexa avisa.">
                    <input
                      type="number"
                      min={1}
                      max={240}
                      inputMode="numeric"
                      className={inputClasses}
                      value={config.leadMinutes}
                      onChange={(inputEvent) => patchEvent(event.key, { leadMinutes: numberValue(inputEvent.target.value) })}
                    />
                  </Field>
                ) : null}

                {event.key === "queue" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Mínimo de clientes aguardando">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        inputMode="numeric"
                        className={inputClasses}
                        value={config.minClients}
                        onChange={(inputEvent) => patchEvent(event.key, { minClients: numberValue(inputEvent.target.value) })}
                      />
                    </Field>
                    <Field label="Tempo mínimo aguardando (minutos)">
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        inputMode="numeric"
                        className={inputClasses}
                        value={config.minWaitMinutes}
                        onChange={(inputEvent) => patchEvent(event.key, { minWaitMinutes: numberValue(inputEvent.target.value) })}
                      />
                    </Field>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>

      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Testar Alexa</h2>
        <p className="text-sm text-muted">Envia a frase na hora ao Echo Dot, sem olhar horário nem intervalo. Não use dados sensíveis.</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Frase de teste" className="flex-1">
            <input
              type="text"
              maxLength={160}
              className={inputClasses}
              placeholder="Teste do escritório."
              value={testPhrase}
              onChange={(event) => setTestPhrase(event.target.value)}
            />
          </Field>
          <Button type="button" variant="secondary" loading={testing} disabled={!testPhrase.trim()} onClick={sendTest}>
            <Send className="h-4 w-4" aria-hidden="true" /> Enviar ao Echo Dot
          </Button>
        </div>
      </Card>

      <div className="fixed inset-x-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur bottom-[var(--admin-bottom-nav-space,0px)]">
        <div className="container-page flex items-center justify-between gap-3">
          <p className="text-sm text-muted">{dirty ? "Alterações não salvas." : meta.updatedAt ? `Salvo em ${formatDateTime(meta.updatedAt)}.` : "Nada alterado."}</p>
          <Button type="button" loading={saving} disabled={!dirty} onClick={save}>Salvar configurações</Button>
        </div>
      </div>
      {toastElement}
    </div>
  );
}
