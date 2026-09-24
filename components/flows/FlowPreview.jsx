"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, List, RotateCcw, X } from "lucide-react";
import { isWithinBusinessHours, runFlow } from "@/lib/whatsapp-flow-core.mjs";

// Simulador de conversa: roda o MESMO executor do servidor (runFlow), mas com
// envio/ações simulados — nada é enviado para ninguém nem grava no CRM.
const SAMPLE_VARS = {
  nome: "Cliente Teste",
  primeiro_nome: "Cliente",
  telefone: "+55 14 90000-0000",
  link_simulacao: "https://www.matheusmachadoimoveis.com.br/simulacao?ref=exemplo&jornada=simulacao",
  corretor: "Corretor Exemplo",
  cargo_corretor: "corretor",
  nosso_cargo: "nosso corretor",
  o_a: "o",
  ele_ela: "ele"
};

function initialSession() {
  return { currentNodeId: "start", pendingTarget: null, awaiting: null, vars: { ...SAMPLE_VARS }, retries: 0 };
}

export default function FlowPreview({ graph, flowId, onClose }) {
  const [bubbles, setBubbles] = useState([]);
  const [state, setState] = useState({ session: initialSession(), status: "idle", waitUntil: null, endReason: null });
  const [isClient, setIsClient] = useState(false);
  const [listOpen, setListOpen] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const isClientRef = useRef(false);
  isClientRef.current = isClient;

  const push = useCallback((bubble) => setBubbles((current) => [...current, { id: current.length + 1, ...bubble }]), []);

  const step = useCallback(async (session, input) => {
    setBusy(true);
    const local = [];
    const deps = {
      canSend: () => true,
      now: () => Date.now(),
      log: () => {},
      send: async (outgoing) => { local.push({ side: "bot", ...outgoing.display }); },
      evaluateCondition: async (data, vars = {}) => {
        if (data.kind === "has_name") return Boolean(vars.nome);
        if (data.kind === "business_hours") return isWithinBusinessHours(data);
        if (data.kind === "is_client" || data.kind === "has_broker") return isClientRef.current;
        return false;
      },
      runActions: async (actions) => {
        const vars = {};
        let handoff = false;
        let stop = false;
        for (const action of actions) {
          if (action.type === "roulette") { local.push({ side: "system", text: "Roleta: cliente criado e corretor definido (simulado)." }); vars.corretor = SAMPLE_VARS.corretor; }
          if (action.type === "tag") local.push({ side: "system", text: `Etiqueta "${action.tag || "?"}" aplicada (simulado).` });
          if (action.type === "finish") local.push({ side: "system", text: "Conversa marcada como finalizada (simulado)." });
          if (action.type === "handoff") { local.push({ side: "system", text: "Passou para um atendente — o fluxo termina aqui." }); handoff = true; break; }
          if (action.type === "stop") { stop = true; break; }
        }
        return { vars, handoff, stop };
      },
      onHandoff: async () => { local.push({ side: "system", text: "Resposta fora das opções — passaria para um atendente." }); }
    };
    try {
      const result = await runFlow({ graph, flowId: flowId || "preview", session, input, deps });
      if (!result.ignored) setState(result);
      local.forEach((bubble) => push(bubble));
      if (result.status !== "waiting" && !result.ignored) push({ side: "system", text: `Fluxo encerrado (${result.endReason || result.status}).` });
    } catch (error) {
      push({ side: "system", text: `Erro na simulação: ${error.message}` });
    } finally {
      setBusy(false);
    }
  }, [graph, flowId, push]);

  const restart = useCallback(() => {
    setBubbles([]);
    setListOpen(null);
    setState({ session: initialSession(), status: "idle", waitUntil: null, endReason: null });
    step(initialSession(), null);
  }, [step]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [bubbles, busy]);

  const awaitingType = state.session.awaiting?.type;
  const live = state.status === "waiting";

  function reply(label, replyId) {
    push({ side: "user", text: label });
    setListOpen(null);
    step(state.session, { kind: "reply", text: label, replyId });
  }

  function sendText(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value || !live) return;
    setText("");
    push({ side: "user", text: value });
    step(state.session, { kind: "reply", text: value, replyId: "" });
  }

  const lastBot = [...bubbles].reverse().find((bubble) => bubble.side === "bot");
  const activeButtons = live && awaitingType === "choice" && lastBot ? lastBot : null;

  // O id de resposta precisa bater com o gerado no envio: reconstrói pelo bloco.
  function replyIdFor(portIndex) {
    const node = graph.nodes.find((item) => item.id === state.session.awaiting?.nodeId);
    const option = (node?.data?.mode === "list" ? node.data.items : node?.data?.buttons || [])?.[portIndex];
    return option ? `fl:${flowId || "preview"}:${node.id}:${option.id}` : "";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex h-[min(720px,92dvh)] w-full max-w-[400px] flex-col overflow-hidden rounded-[28px] border border-line bg-white shadow-soft">
        <div className="flex items-center gap-3 bg-[#0b6b5b] px-4 py-3 text-white">
          <div className="flex-1">
            <p className="text-sm font-black">Pré-visualização</p>
            <p className="text-[11px] font-semibold opacity-80">Simulação — nada é enviado de verdade</p>
          </div>
          <button type="button" onClick={restart} title="Recomeçar" aria-label="Recomeçar" className="rounded-full p-2 hover:bg-white/15"><RotateCcw className="h-4 w-4" /></button>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-2 hover:bg-white/15"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-3">
          {bubbles.map((bubble) => {
            if (bubble.side === "system") {
              return <p key={bubble.id} className="mx-auto max-w-[90%] rounded-lg bg-amber-100 px-3 py-1.5 text-center text-[11px] font-bold text-amber-900">{bubble.text}</p>;
            }
            if (bubble.side === "user") {
              return <div key={bubble.id} className="flex justify-end"><p className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm font-medium text-slate-800 shadow-sm">{bubble.text}</p></div>;
            }
            return (
              <div key={bubble.id} className="flex flex-col items-start gap-1">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-slate-800 shadow-sm">
                  {bubble.imageUrl ? <img src={bubble.imageUrl} alt="" className="mb-2 max-h-40 w-full rounded-lg object-cover" /> : null}
                  <p className="whitespace-pre-line font-medium">{bubble.text}</p>
                  {bubble.footer ? <p className="mt-1 text-[11px] text-slate-500">{bubble.footer}</p> : null}
                  {bubble.link ? (
                    <a href={bubble.link.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center justify-center gap-1.5 border-t border-slate-200 pt-2 text-sm font-bold text-[#027eb5]"><ExternalLink className="h-3.5 w-3.5" />{bubble.link.label}</a>
                  ) : null}
                  {bubble.list ? (
                    <button type="button" disabled={bubble !== activeButtons} onClick={() => setListOpen(bubble.id)} className="mt-2 flex w-full items-center justify-center gap-1.5 border-t border-slate-200 pt-2 text-sm font-bold text-[#027eb5] disabled:opacity-50"><List className="h-3.5 w-3.5" />{bubble.list.button}</button>
                  ) : null}
                </div>
                {bubble.buttons?.map((title, index) => (
                  <button key={index} type="button" disabled={bubble !== activeButtons || busy} onClick={() => reply(title, replyIdFor(index))} className="w-[85%] rounded-2xl bg-white px-3 py-2 text-center text-sm font-bold text-[#027eb5] shadow-sm hover:bg-slate-50 disabled:opacity-50">{title}</button>
                ))}
              </div>
            );
          })}
          {busy ? <p className="text-center text-xs font-bold text-slate-500">…</p> : null}
          <div ref={endRef} />
        </div>

        {listOpen && activeButtons?.list ? (
          <div className="border-t border-line bg-white p-2">
            <p className="px-2 pb-1 text-xs font-black text-muted">{activeButtons.list.button}</p>
            {activeButtons.list.items.map((title, index) => (
              <button key={index} type="button" onClick={() => reply(title, replyIdFor(index))} className="block w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-navy hover:bg-mist">{title}</button>
            ))}
          </div>
        ) : null}

        {live && state.waitUntil ? (
          <div className="flex items-center gap-2 border-t border-line bg-mist px-3 py-2">
            <p className="flex-1 text-[11px] font-bold text-muted">{awaitingType ? "Prazo de \"se não responder\" configurado." : "Aguardando tempo de espera."}</p>
            <button type="button" disabled={busy} onClick={() => step(state.session, awaitingType ? { kind: "timeout" } : { kind: "resume" })} className="rounded-full bg-navy px-3 py-1.5 text-xs font-black text-white">Simular passagem do tempo</button>
          </div>
        ) : null}

        <form onSubmit={sendText} className="flex items-center gap-2 border-t border-line p-2">
          <input value={text} onChange={(event) => setText(event.target.value)} disabled={!live} placeholder={live ? "Digite como o cliente…" : "Conversa encerrada"} className="flex-1 rounded-full border border-line px-4 py-2 text-sm font-semibold text-navy outline-none disabled:bg-mist" />
          <button type="submit" disabled={!live || !text.trim()} className="rounded-full bg-[#0b6b5b] px-4 py-2 text-sm font-black text-white disabled:opacity-40">Enviar</button>
        </form>
        <label className="flex items-center gap-2 border-t border-line px-3 py-2 text-[11px] font-bold text-muted">
          <input type="checkbox" checked={isClient} onChange={(event) => setIsClient(event.target.checked)} className="h-3.5 w-3.5 accent-brand" />
          Simular contato que já é cliente cadastrado (para blocos de condição)
        </label>
      </div>
    </div>
  );
}
