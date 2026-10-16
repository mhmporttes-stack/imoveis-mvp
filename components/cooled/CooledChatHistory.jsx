"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import Button from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

// FUN-15g (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16): "o corretor que receber o cliente transferido recebe também o
// histórico de conversas caso haja no chat ... e indica que dali para trás as conversas foram feitas pela Jennyfer e
// agora ele irá assumir." Ficha do cliente transferido: conversa anterior SOMENTE LEITURA, por número, com o divisor
// no fim. Só lê (GET /api/admin/cooled-clients/handoff/history); nada aqui envia mensagem nem usa o número anterior.
// Estendido pelo dono em 2026-10-16 ("Sim"): também na transferência manual de responsável e no "Devolver para a roleta"
// fora do fluxo — o servidor escolhe o corte (loadTransferHistoryCut, lib/cooled-clients.js); este componente é o mesmo.

const MEDIA_LABEL = { image: "Foto", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha" };

function formatAt(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function MessageMedia({ message }) {
  const { media, type } = message;
  if (!media) return null;
  const label = MEDIA_LABEL[type] || "Arquivo";
  if (media.unavailable) return <p className="text-xs italic text-muted">[{label} não disponível no CRM]</p>;
  if (type === "audio") return <audio controls preload="none" src={media.url} className="mt-1 w-full max-w-[260px]" />;
  if (type === "image" || type === "sticker") {
    return (
      <a href={media.url} target="_blank" rel="noreferrer" className="mt-1 block">
        <img src={media.url} alt={label} loading="lazy" className="max-h-48 max-w-full rounded-control object-contain" />
      </a>
    );
  }
  if (type === "video") return <video controls preload="none" src={media.url} className="mt-1 max-h-48 max-w-full rounded-control" />;
  return <a href={media.url} target="_blank" rel="noreferrer" className="mt-1 block text-xs font-semibold text-brand underline">{media.name || label}</a>;
}

export default function CooledChatHistory({ clientId }) {
  const [state, setState] = useState({ loading: true, history: null });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!clientId) return undefined;
    let alive = true;
    setState({ loading: true, history: null });
    fetch(`/api/admin/cooled-clients/handoff/history?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (alive) setState({ loading: false, history: response.ok ? data.history || null : null });
      })
      .catch(() => { if (alive) setState({ loading: false, history: null }); });
    return () => { alive = false; };
  }, [clientId]);

  const { history } = state;
  if (state.loading || !history?.conversations?.length) return null;

  return (
    <div className="rounded-card border border-line bg-white p-3" data-cooled-chat-history="true">
      <Button size="sm" variant="ghost" className="w-full justify-between" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="flex items-center gap-1.5">
          <History className="h-4 w-4" aria-hidden="true" />
          Conversa anterior{history.previousBrokerName ? ` com ${history.previousBrokerName}` : ""} (somente leitura)
        </span>
        {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
      </Button>
      {open ? (
        <div className="mt-2 max-h-[420px] space-y-4 overflow-y-auto pr-1">
          {history.truncated ? <p className="text-xs text-muted">Mostrando as mensagens mais recentes antes da transferência.</p> : null}
          {history.conversations.map((conversation) => (
            <div key={conversation.id} className="space-y-1.5">
              <p className="text-xs font-semibold text-muted">Número {conversation.numberLabel}</p>
              {conversation.messages.map((message) => (
                <div key={message.id} className={cx("flex", message.direction === "inbound" ? "justify-start" : "justify-end")}>
                  <div className={cx("max-w-[85%] rounded-card px-3 py-2 text-[13px] leading-5", message.direction === "inbound" ? "bg-mist text-ink" : "bg-info-soft text-ink")}>
                    <p className="text-2xs font-semibold text-muted">{message.author} · {formatAt(message.at)}</p>
                    <MessageMedia message={message} />
                    {message.body ? <p className="whitespace-pre-line break-words">{message.body}</p> : null}
                    {message.transcript ? <p className="mt-1 text-xs italic text-ink-2">Transcrição: {message.transcript}</p> : null}
                  </div>
                </div>
              ))}
              <p className="rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-center text-xs font-semibold text-warning" data-transfer-divider="true">
                {conversation.divider}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
