import { BookOpen, CalendarClock, CircleCheck, MessageSquare, Play, Undo2 } from "lucide-react";
import { PHASES, getOutputPorts } from "@/lib/attendance-guide-core.mjs";
import { autoArrangeGuide, guideBodyHeight, guideInputPosition, guideNodeHeight, guidePortPosition } from "@/lib/attendance-guide-layout.mjs";

// Aparência e geometria dos cards do Guia de Atendimento — o canvas é o do editor de Fluxos (FlowCanvas),
// que recebe este "adapter". As cores (TONES) e o tamanho dos cards são os mesmos, para os dois editores parecerem um só.

export const GUIDE_NODE_META = {
  start: { label: "Início", icon: Play, tone: "emerald", hint: "Onde o guia começa" },
  card: { label: "Card", icon: MessageSquare, tone: "blue", hint: "Orientação, argumento, mensagem pronta e respostas" },
  followup: { label: "Definir retorno", icon: CalendarClock, tone: "amber", hint: "Próximo passo + data de retorno (agenda)" },
  ref: { label: "Abrir objeção", icon: BookOpen, tone: "violet", hint: "Usa uma objeção do Banco de Objeções" },
  end: { label: "Encerrar", icon: CircleCheck, tone: "slate", hint: "Fim do atendimento (ex.: comprou)" },
  return: { label: "Voltar ao atendimento", icon: Undo2, tone: "cyan", hint: "Só no Banco de Objeções: volta ao guia que abriu a objeção" }
};

export const PHASE_LABELS = Object.fromEntries(PHASES.map((phase) => [phase.key, phase.label]));

export function makeGuideAdapter({ libraryTitles = new Map(), isLibrary = false } = {}) {
  const addable = isLibrary ? ["card", "followup", "end", "return", "ref"] : ["card", "followup", "ref", "end"];
  return {
    getPorts: getOutputPorts,
    nodeHeight: guideNodeHeight,
    bodyHeight: guideBodyHeight,
    portPosition: guidePortPosition,
    inputPosition: guideInputPosition,
    autoArrange: autoArrangeGuide,
    meta: GUIDE_NODE_META,
    addable,
    addTitle: "Adicionar card",
    emptyHint: "Ligue o início ao primeiro card: arraste a bolinha “Começar” até um espaço vazio, ou clique em + para adicionar.",
    headerLabel: (node, meta) => (node.type === "card" && node.data?.entry ? `${meta.label} · entrada` : meta.label),
    renderBody: (node) => {
      const data = node.data || {};
      if (node.type === "start") return <p className="text-[13px] font-bold leading-5 text-navy">Ligue ao primeiro card do atendimento.</p>;
      if (node.type === "card") {
        return (
          <>
            <span className="inline-block rounded-full bg-mist px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate">{PHASE_LABELS[data.phase] || "Etapa"}</span>
            <p className="mt-0.5 line-clamp-2 text-[13px] font-black leading-[18px] text-navy">{data.title || "Toque para dar um título…"}</p>
          </>
        );
      }
      if (node.type === "followup") return <p className="line-clamp-3 text-[13px] font-bold leading-5 text-navy">{data.title || "Definir retorno"}</p>;
      if (node.type === "ref") {
        const title = libraryTitles.get(`${data.guideId}::${data.nodeId}`);
        return <p className="line-clamp-2 text-[13px] font-bold leading-5 text-navy">{title ? `Abre: ${title}` : data.guideId ? "Objeção não encontrada" : "Escolha a objeção…"}</p>;
      }
      if (node.type === "end") return <p className="line-clamp-2 text-[13px] font-bold leading-5 text-navy">{data.title || "Encerrar"}</p>;
      return <p className="text-[13px] font-semibold leading-5 text-slate">Volta ao guia que abriu esta objeção.</p>;
    }
  };
}
