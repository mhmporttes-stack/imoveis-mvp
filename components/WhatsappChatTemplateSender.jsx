"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";

// Janela de 24h fechada: a única forma de escrever é um MODELO aprovado pela
// Meta. Lista os aprovados, pede as variáveis ({{1}}, {{2}}…) e envia.
export default function WhatsappChatTemplateSender({ conversation, onSent }) {
  const [templates, setTemplates] = useState(null);
  const [templateId, setTemplateId] = useState("");
  const [params, setParams] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/whatsapp-chat/templates", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => { if (!cancelled) setTemplates(payload.templates || []); })
      .catch(() => { if (!cancelled) setTemplates([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setTemplateId("");
    setParams([]);
    setError("");
  }, [conversation.id]);

  const template = useMemo(() => (templates || []).find((item) => item.id === templateId) || null, [templates, templateId]);
  const firstName = String(conversation.client?.name || conversation.name || "").trim().split(/\s+/)[0] || "";

  function choose(id) {
    setTemplateId(id);
    const chosen = (templates || []).find((item) => item.id === id);
    // {{1}} costuma ser o nome do cliente: já vem preenchido.
    setParams(chosen ? Array.from({ length: chosen.variableCount }, (_, index) => (index === 0 ? firstName : "")) : []);
    setError("");
  }

  const preview = template ? template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, number) => params[Number(number) - 1] || `{{${number}}}`) : "";
  const ready = template && params.every((value) => String(value || "").trim());

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, params })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar o modelo.");
      setTemplateId("");
      setParams([]);
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
      onSent();
    }
  }

  return (
    <div className="border-t border-line bg-amber-50 px-4 py-3">
      <p className="text-sm font-extrabold text-amber-800">Janela de atendimento encerrada</p>
      <p className="mt-0.5 text-xs font-bold text-amber-700">
        Já passaram 24h desde a última mensagem deste contato (ou ele ainda não escreveu). Pela regra do WhatsApp, só é possível enviar um <b>modelo aprovado</b>. Quando o contato responder, a conversa livre volta.
      </p>

      {templates === null ? (
        <p className="mt-2 flex items-center gap-2 text-xs font-bold text-amber-800"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando modelos…</p>
      ) : !templates.length ? (
        <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs font-bold text-amber-800">
          Ainda não há nenhum modelo aprovado. Crie e envie um para aprovação em Automações › WhatsApp Master › Modelos (a Meta costuma responder em minutos ou horas).
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <select value={templateId} onChange={(event) => choose(event.target.value)} className="h-10 w-full rounded-xl border border-amber-200 bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand">
            <option value="">Escolha um modelo…</option>
            {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {template ? (
            <>
              {template.variableCount > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {params.map((value, index) => (
                    <input
                      key={index}
                      value={value}
                      onChange={(event) => setParams((current) => current.map((item, position) => (position === index ? event.target.value : item)))}
                      placeholder={`Variável {{${index + 1}}}`}
                      className="h-10 rounded-xl border border-amber-200 bg-white px-3 text-sm font-semibold text-navy outline-none focus:border-brand"
                    />
                  ))}
                </div>
              ) : null}
              <p className="whitespace-pre-line rounded-xl bg-white px-3 py-2 text-sm font-semibold text-navy">{preview}</p>
              <button type="button" onClick={send} disabled={!ready || sending} className="inline-flex h-10 items-center gap-2 rounded-full bg-navy px-5 text-sm font-extrabold text-white disabled:opacity-40">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar modelo
              </button>
            </>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
