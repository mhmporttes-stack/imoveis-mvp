"use client";

import { useEffect, useState } from "react";
import { Copy, Wifi } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClasses } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

// "Chegada pelo Wi-Fi" (PRES-WIFI, dono 2026-10-23). Só aparece para quem pode usar (hoje, o dono): a API devolve 403
// para os demais e a seção some.
const EVENT_LABEL = { arrive: "Chegou", leave: "Saiu" };
const OFFICE_LABEL = { chegada_registrada: "presença registrada", saida_registrada: "saída registrada", erro: "falha na presença" };
const PLUG_LABEL = {
  ok: "tomada acionada",
  sem_gatilho: "sem gatilho configurado",
  alexa_desligada_no_ambiente: "Alexa desligada neste ambiente",
  sem_token_voice_monkey: "falta o VOICEMONKEY_TOKEN",
  tempo_esgotado: "Voice Monkey não respondeu",
  falha_rede: "falha de rede no Voice Monkey"
};

function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function plugLabel(status) {
  if (!status) return "";
  if (status.startsWith("recusado_http_")) return `Voice Monkey recusou (HTTP ${status.slice(14)})`;
  return PLUG_LABEL[status] || status;
}

export default function WifiPresenceSection() {
  const [status, setStatus] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [token, setToken] = useState("");
  const [triggers, setTriggers] = useState({ plugOnDevice: "", plugOffDevice: "" });
  const [busy, setBusy] = useState("");
  const [notify, toastElement] = useToast();
  const url = typeof window !== "undefined" ? `${window.location.origin}/api/presence/wifi` : "/api/presence/wifi";

  async function load() {
    const response = await fetch("/api/admin/presence-wifi", { cache: "no-store" });
    if (response.status === 403) return setHidden(true);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return notify(data.error || "Não foi possível carregar a Chegada pelo Wi-Fi.", "danger");
    setStatus(data.status);
    setTriggers({ plugOnDevice: data.status?.plugOnDevice || "", plugOffDevice: data.status?.plugOffDevice || "" });
  }

  useEffect(() => {
    load().catch(() => notify("Não foi possível carregar a Chegada pelo Wi-Fi.", "danger"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function action(name, extra = {}) {
    setBusy(name);
    try {
      const response = await fetch("/api/admin/presence-wifi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, ...extra })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return notify(data.error || "Não foi possível concluir.", "danger");
      if (name === "token") {
        setToken(data.token);
        notify("Chave gerada. Copie agora: ela não será mostrada de novo.");
      } else if (name === "revoke") {
        setToken("");
        notify("Chave desativada. O Atalho deixa de funcionar.");
      } else {
        notify("Gatilhos salvos.");
      }
      await load();
    } catch {
      notify("Não foi possível concluir. Verifique a conexão.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copiado.");
    } catch {
      notify("Não foi possível copiar. Selecione o texto e copie manualmente.", "danger");
    }
  }

  if (hidden || !status) return toastElement;

  return (
    <div className="container-page pb-6">
      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Wifi className="h-4 w-4" aria-hidden="true" /> Chegada pelo Wi-Fi</h2>
            <p className="text-sm text-muted">Ao conectar no Wi-Fi da imobiliária, o iPhone registra sua presença e liga a tomada pela Alexa; ao sair, desliga.</p>
          </div>
          <Badge tone={status.presence?.present ? "success" : "neutral"} dot>{status.presence?.present ? "Na imobiliária" : "Fora"}</Badge>
        </div>

        {!status.ready ? <p className="text-sm text-danger">{status.error}</p> : (
          <>
            <div className="space-y-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" loading={busy === "token"} onClick={() => action("token")}>
                  {status.tokenConfigured ? "Gerar nova chave" : "Gerar chave do iPhone"}
                </Button>
                {status.tokenConfigured ? <Button type="button" variant="ghost" loading={busy === "revoke"} onClick={() => action("revoke")}>Desativar chave</Button> : null}
                <Badge tone={status.tokenConfigured ? "success" : "warning"} dot>{status.tokenConfigured ? `Chave ativa desde ${formatDateTime(status.tokenCreatedAt)}` : "Sem chave"}</Badge>
              </div>
              {token ? (
                <div className="space-y-2 rounded-control border border-line bg-mist p-3">
                  <p className="text-sm font-medium text-ink">Chave do iPhone (aparece só agora)</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-control bg-white px-2 py-1.5 text-xs text-ink">{token}</code>
                    <Button type="button" variant="secondary" size="sm" onClick={() => copyText(token)}><Copy className="h-4 w-4" aria-hidden="true" /> Copiar</Button>
                  </div>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-control bg-white px-2 py-1.5 text-xs text-ink">{url}</code>
                <Button type="button" variant="secondary" size="sm" onClick={() => copyText(url)}><Copy className="h-4 w-4" aria-hidden="true" /> Copiar URL</Button>
              </div>
            </div>

            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Field label="Gatilho para LIGAR a tomada" hint="ID do “Routine Trigger” no Voice Monkey.">
                <input type="text" maxLength={64} className={inputClasses} placeholder="tomada-ligar" value={triggers.plugOnDevice} onChange={(event) => setTriggers((current) => ({ ...current, plugOnDevice: event.target.value }))} />
              </Field>
              <Field label="Gatilho para DESLIGAR a tomada" hint="Deixe vazio para não desligar ao sair.">
                <input type="text" maxLength={64} className={inputClasses} placeholder="tomada-desligar" value={triggers.plugOffDevice} onChange={(event) => setTriggers((current) => ({ ...current, plugOffDevice: event.target.value }))} />
              </Field>
              <div className="sm:col-span-2">
                <Button type="button" variant="secondary" loading={busy === "triggers"} onClick={() => action("triggers", triggers)}>Salvar gatilhos</Button>
              </div>
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              <p className="text-sm font-medium text-ink">Últimos eventos</p>
              {status.events?.length ? (
                <ul className="space-y-1 text-xs text-muted">
                  {status.events.map((item) => (
                    <li key={`${item.event}-${item.receivedAt}`}>
                      {formatDateTime(item.receivedAt)} · <span className="font-medium text-ink">{EVENT_LABEL[item.event] || item.event}</span>
                      {item.officeStatus ? ` · ${OFFICE_LABEL[item.officeStatus] || item.officeStatus}` : ""}
                      {item.plugStatus ? ` · ${plugLabel(item.plugStatus)}` : ""}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted">Nenhum evento recebido ainda.</p>}
            </div>

            <details className="border-t border-line pt-4 text-sm text-ink-2">
              <summary className="cursor-pointer font-medium text-ink">Como configurar no iPhone (Atalhos)</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Atalhos › Automação › Nova automação › <b>Wi-Fi</b> › escolha a rede da imobiliária › marque <b>Conectar</b> › <b>Executar imediatamente</b>.</li>
                <li>Ação <b>Obter conteúdo do URL</b>: cole a URL acima; Método <b>POST</b>.</li>
                <li>Cabeçalhos: <code>Authorization</code> = <code>Bearer</code> + espaço + a chave.</li>
                <li>Corpo da solicitação <b>JSON</b>: campo <code>event</code> (texto) = <code>arrive</code>.</li>
                <li>Repita criando outra automação com <b>Desconectar</b> e <code>event</code> = <code>leave</code>.</li>
              </ol>
            </details>
          </>
        )}
      </Card>
      {toastElement}
    </div>
  );
}
