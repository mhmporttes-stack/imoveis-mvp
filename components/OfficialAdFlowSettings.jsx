"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Switch from "@/components/ui/Switch";

// Automações › Fluxo do anúncio no Oficial (dono, 2026-11-10 — WA-40). Tudo nasce DESLIGADO. Liga/desliga, tempos, horário de
// atendimento, prazo da oferta, participantes (ordem do rodízio, liga/desliga por pessoa), imóveis sugeridos e a lista "Bom dia de hoje".
// Só admin/gestor (a rota exige requireBrokerManagementApi). Nenhuma regra mora aqui: a tela só edita a configuração.
const KEEPALIVE_LABELS = { claiming: "Enviando…", sent: "Enviado", confirmed: "Confirmado", resent: "Reenviado", failed: "Falhou" };
const KEEPALIVE_TONES = { sent: "neutral", confirmed: "success", resent: "warning", failed: "danger" };

async function callApi(method, body) {
  const response = await fetch("/api/admin/official-ad-flow", { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir.");
  return payload;
}

function NumberField({ label, value, onChange, min, max, suffix }) {
  return (
    <label className="block text-sm font-bold text-ink">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-24 rounded-xl border border-line px-3 py-2 text-sm font-semibold" />
        {suffix ? <span className="text-sm font-normal text-muted">{suffix}</span> : null}
      </span>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="block text-sm font-bold text-ink">
      {label}
      <input type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm font-semibold" />
    </label>
  );
}

export default function OfficialAdFlowSettings() {
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [toAdd, setToAdd] = useState("");

  useEffect(() => {
    callApi("GET").then((payload) => {
      setData(payload);
      setConfig(payload.config);
    }).catch((error) => setMessage({ ok: false, text: error.message }));
  }, []);

  if (!config) {
    return <div className="container-page"><Card padding="md">{message ? <p className="text-sm font-bold text-danger">{message.text}</p> : <p className="text-sm text-muted">Carregando…</p>}</Card></div>;
  }

  const update = (patch) => setConfig((current) => ({ ...current, ...patch }));
  const userName = (id) => data.users.find((user) => user.id === id)?.name || "Usuário removido";
  const whatsappOf = (id) => data.users.find((user) => user.id === id)?.whatsappStatus;
  const move = (index, delta) => {
    const next = [...config.participants];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update({ participants: next });
  };
  const available = data.users.filter((user) => !config.participants.some((item) => item.userId === user.id));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const payload = await callApi("PUT", { config });
      setConfig(payload.config);
      setMessage({ ok: true, text: "Configuração salva." });
    } catch (error) {
      setMessage({ ok: false, text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-page space-y-4">
      <Card
        padding="md"
        title="Fluxo do anúncio no número oficial"
        note="Quem chega por anúncio recebe saudação e 3 botões (Localização, Valores, Falar com associado). Desligado, nada disso acontece e o atendimento segue como hoje."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink">{config.enabled ? "Ligado" : "Desligado"}</span>
            <Switch checked={config.enabled} label="Ligar o fluxo do anúncio no número oficial" disabled={busy} onChange={(next) => update({ enabled: next })} />
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Cutucar quem parou por" value={config.remindAfterMin} min={1} max={30} onChange={(value) => update({ remindAfterMin: value })} suffix="min" />
          <NumberField label="Sem resposta depois da cutucada, chamar associado em" value={config.transferAfterMin} min={1} max={30} onChange={(value) => update({ transferAfterMin: value })} suffix="min" />
          <NumberField label="Prazo de cada corretor para responder sim/ok" value={config.offerTimeoutSec} min={15} max={600} onChange={(value) => update({ offerTimeoutSec: value })} suffix="segundos" />
          <div className="flex gap-3">
            <NumberField label="Atendimento das" value={config.windowStartHour} min={0} max={23} onChange={(value) => update({ windowStartHour: value })} suffix="h" />
            <NumberField label="até" value={config.windowEndHour} min={1} max={24} onChange={(value) => update({ windowEndHour: value })} suffix="h" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">O horário de atendimento só decide a mensagem &quot;um associado entra em contato a partir das 8h&quot;, enviada ao cliente quando ninguém aceita à noite.</p>
      </Card>

      <Card padding="md" title="Quem recebe os clientes (rodízio)" note="Na ordem da lista. Cada pessoa recebe a pergunta pelo WhatsApp oficial e responde sim ou ok. Lista vazia: o cliente continua com o dono.">
        {config.participants.length ? (
          <ul className="divide-y divide-line">
            {config.participants.map((item, index) => (
              <li key={item.userId} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-6 text-sm font-bold text-muted">{index + 1}</span>
                <span className="min-w-[8rem] flex-1 text-sm font-bold text-ink">{userName(item.userId)}</span>
                <Badge tone={whatsappOf(item.userId) === "connected" ? "success" : "neutral"}>{whatsappOf(item.userId) === "connected" ? "WhatsApp conectado" : "WhatsApp não conectado"}</Badge>
                {data.lastPickedUserId === item.userId ? <Badge tone="neutral">Recebeu por último</Badge> : null}
                <Switch checked={item.enabled} label={`Participação de ${userName(item.userId)}`} onChange={(next) => update({ participants: config.participants.map((entry) => (entry.userId === item.userId ? { ...entry, enabled: next } : entry)) })} />
                <Button size="sm" variant="secondary" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Subir">↑</Button>
                <Button size="sm" variant="secondary" onClick={() => move(index, 1)} disabled={index === config.participants.length - 1} aria-label="Descer">↓</Button>
                <Button size="sm" variant="secondary" onClick={() => update({ participants: config.participants.filter((entry) => entry.userId !== item.userId) })}>Remover</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Ninguém na lista ainda.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={toAdd} onChange={(event) => setToAdd(event.target.value)} className="rounded-xl border border-line px-3 py-2 text-sm font-semibold">
            <option value="">Adicionar pessoa…</option>
            {available.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <Button size="sm" variant="secondary" disabled={!toAdd} onClick={() => { update({ participants: [...config.participants, { userId: toAdd, enabled: true }] }); setToAdd(""); }}>Adicionar</Button>
        </div>
      </Card>

      <Card padding="md" title="Localização e imóveis sugeridos">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Empreendimento da Localização" value={config.locationPropertyName} onChange={(value) => update({ locationPropertyName: value })} placeholder="Ecovillage" />
          <TextField label="Imagem da Localização (https, opcional)" value={config.locationImageUrl} onChange={(value) => update({ locationImageUrl: value })} placeholder="Vazio = foto do empreendimento" />
          <TextField label="Link do Google Maps (https, opcional)" value={config.mapsUrl} onChange={(value) => update({ mapsUrl: value })} placeholder="Vazio = busca pelo nome do empreendimento" />
          <TextField label="Imóveis sugeridos na apresentação (separe por vírgula)" value={config.suggestedPropertyNames.join(", ")} onChange={(value) => update({ suggestedPropertyNames: value.split(",").map((name) => name.trim()).filter(Boolean) })} placeholder="Ecovillage, Terras de SP" />
        </div>
      </Card>

      <Card padding="md" title="Roleta geral (interruptor separado)" note="Aplicar a pergunta por WhatsApp também à roleta geral de leads. Ainda não está ligado ao sorteio: ligar aqui NÃO muda a roleta atual (aguarda decisão do dono sobre como perguntar antes de atribuir).">
        <div className="flex items-center gap-2">
          <Switch checked={config.generalRoulette.enabled} label="Aplicar à roleta geral" onChange={(next) => update({ generalRoulette: { ...config.generalRoulette, enabled: next } })} />
          <span className="text-sm font-bold text-ink">{config.generalRoulette.enabled ? "Ligado" : "Desligado"}</span>
        </div>
      </Card>

      <Card padding="md" title="Bom dia de hoje" note="Cada corretor conectado manda, às 8h, o bom dia ao número oficial (abre a janela de 24 h). O CRM confere se chegou e reenvia um 👋 se não. Os corretores também conferem à mão.">
        {data.keepalive?.error ? <p className="text-sm font-bold text-danger">{data.keepalive.error}</p> : null}
        {data.keepalive?.items?.length ? (
          <ul className="divide-y divide-line">
            {data.keepalive.items.map((item) => (
              <li key={item.userId} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-[8rem] flex-1 text-sm font-bold text-ink">{item.name || "Corretor"}</span>
                <Badge tone={KEEPALIVE_TONES[item.state] || "neutral"}>{KEEPALIVE_LABELS[item.state] || item.state}</Badge>
                {item.resendCount ? <span className="text-xs text-muted">{item.resendCount} reenvio(s)</span> : null}
                {item.error ? <span className="text-xs text-danger">{item.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nenhum envio registrado hoje.</p>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar configuração"}</Button>
        {message ? <p className={message.ok ? "text-sm font-bold text-success" : "text-sm font-bold text-danger"}>{message.text}</p> : null}
      </div>
    </div>
  );
}
